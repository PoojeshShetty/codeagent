import { v4 as uuidv4 } from 'uuid'
import { ZodType } from 'zod'
import {
  createSession,
  getSessionMessages,
  getSessionsByDirectory,
  saveMessage,
  savePart,
  updatePartData,
  updateMessageContent,
  getLastMessages
} from '../db'
import { generateResponse, streamAgentResponse } from '../llm'
import { tools, type ToolContext, type ToolDefinition } from '../tools'
import type { SendMessageInput, StreamMessageInput } from '../types/session'

function bindToolsToDirectory(
  rawTools: Record<string, ToolDefinition<ZodType>>,
  directory: string,
  sessionId: string
): Record<string, { description: string; parameters: any; execute: (args: any) => Promise<string> }> {
  const bound: Record<string, any> = {}
  for (const [name, tool] of Object.entries(rawTools)) {
    bound[name] = {
      description: tool.description,
      parameters: tool.parameters,
      execute: (args: any) => {
        const ctx: ToolContext = { directory, sessionId, toolId: uuidv4() }
        return tool.execute(args, ctx)
      }
    }
  }
  return bound
}

function buildSystemPrompt(directory: string, includeSummaryHint = false): string {
  const base =
    `You are a helpful coding assistant. ` +
    `The user's project is located at: ${directory}. ` +
    `When working with files, always resolve paths relative to that directory.`
  return includeSummaryHint
    ? base + ` When you use tools, summarize the results clearly in your final response.`
    : base
}

export function listSessions(directory: string) {
  return getSessionsByDirectory(directory)
}

export function createNewSession(directory: string): string {
  const sessionId = uuidv4()
  createSession(sessionId, directory)
  return sessionId
}

export function listMessages(sessionId: string) {
  return getSessionMessages(sessionId)
}

export async function sendMessage(input: SendMessageInput) {
  const { sessionId, directory, message, providerId, modelId, apiKey } = input

  saveMessage(sessionId, uuidv4(), 'user', message)

  const history = getSessionMessages(sessionId)
  const messages = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  const boundTools = bindToolsToDirectory(tools, directory, sessionId)

  const result = await generateResponse({
    providerID: providerId,
    modelID: modelId,
    apiKey,
    systemPrompt: buildSystemPrompt(directory, true),
    messages,
    tools: boundTools
  })

  if (result?.text) saveMessage(sessionId, uuidv4(), 'assistant', result.text)
  return result
}

export function streamMessage(input: StreamMessageInput): ReadableStream {
  const { sessionId, directory, message, providerId, modelId, apiKey } = input

  const userMsgId = uuidv4()
  const assistantMsgId = uuidv4()
  saveMessage(sessionId, userMsgId, 'user', message)
  saveMessage(sessionId, assistantMsgId, 'assistant', '')

  const history = getLastMessages(sessionId, assistantMsgId)
  const boundTools = bindToolsToDirectory(tools, directory, sessionId)

  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const toolCallPartIds = new Map<string, string>()

      try {
        await streamAgentResponse({
          providerID: providerId,
          modelID: modelId,
          apiKey,
          systemPrompt: buildSystemPrompt(directory),
          messages: history,
          tools: boundTools,
          onEvent: (event) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

            switch (event.type) {
              case 'tool_call': {
                const partId = uuidv4()
                toolCallPartIds.set(event.toolCallId, partId)
                savePart(partId, assistantMsgId, sessionId, {
                  type: 'tool_call',
                  tool_id: event.toolCallId,
                  tool_name: event.tool,
                  args: event.args as Record<string, unknown>
                })
                break
              }

              case 'tool_result': {
                const existingPartId = toolCallPartIds.get(event.toolCallId)
                if (existingPartId) {
                  updatePartData(existingPartId, {
                    type: 'tool_call',
                    tool_id: event.toolCallId,
                    tool_name: event.tool,
                    args: {},
                    result: event.result
                  })
                }
                break
              }

              case 'done':
                savePart(uuidv4(), assistantMsgId, sessionId, {
                  type: 'text',
                  content: event.fullText
                })
                updateMessageContent(assistantMsgId, event.fullText)
                break
            }
          }
        })
      } finally {
        controller.close()
      }
    }
  })
}
