import { generateText, streamText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createMistral } from "@ai-sdk/mistral"
import { z, ZodSchema } from "zod"

interface ToolDefinition {
  description: string
  parameters: ZodSchema<any>
  execute: (args: any) => Promise<string>
}

interface CommonInput {
  providerID: string
  modelID: string
  apiKey: string
  baseURL?: string
  systemPrompt?: string
  messages: { role: "user" | "assistant"; content: string }[]
  tools?: Record<string, ToolDefinition>
  onStepFinish?: (step: { toolCalls: any[], toolResults: any[], text: string }) => void
}

interface StreamInput extends CommonInput {
  onChunk: (chunk: string) => void
  onFinish?: (fullText: string) => void
}

function getProviderModel(input: { providerID: string; modelID: string; apiKey: string; baseURL?: string }) {
  const { providerID, modelID, apiKey, baseURL } = input

  if (!apiKey) {
    throw new Error(`Empty API key for provider ${providerID} and model ${modelID}`)
  }

  switch (providerID.toLowerCase()) {
    case "anthropic":
      const anthropic = createAnthropic({ apiKey, baseURL })
      return anthropic(modelID)
    case "openai":
      const openai = createOpenAI({ apiKey, baseURL })
      return openai(modelID)
    case "mistral":
      const mistral = createMistral({ apiKey, baseURL })
      return mistral(modelID)
    default:
      throw new Error(`Unsupported provider: ${providerID}`)
  }
}

function convertToolsToAISDKFormat(tools: Record<string, ToolDefinition> | undefined) {
  if (!tools) return undefined

  const toolSet: Record<string, {
    description: string
    parameters: ZodSchema<any>
    execute: (args: any) => Promise<string>
  }> = {}

  for (const [name, tool] of Object.entries(tools)) {
    toolSet[name] = {
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute
    }
  }

  return toolSet as any // Cast to any to handle the complex ToolSet type
}

export async function generateResponse(input: CommonInput): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const { providerID, modelID, apiKey, baseURL, systemPrompt, messages, tools } = input

  try {
    const model = getProviderModel({ providerID, modelID, apiKey, baseURL })
    const aiTools = convertToolsToAISDKFormat(tools)

    // Manual multi-step implementation since maxSteps is not available in current SDK
    let fullText = ""
    let totalUsage = { inputTokens: 0, outputTokens: 0 }
    let stepCount = 0
    const maxSteps = 10
    
    while (stepCount < maxSteps) {
      stepCount++
      
      const { text, usage, toolCalls, toolResults } = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: aiTools
      })
      
      if (text) {
        fullText += text
      }
      
      if (usage) {
        totalUsage.inputTokens += usage.inputTokens || 0
        totalUsage.outputTokens += usage.outputTokens || 0
      }
      
      if (input.onStepFinish && (toolCalls || toolResults || text)) {
        input.onStepFinish({ toolCalls: toolCalls || [], toolResults: toolResults || [], text: text || "" })
      }
      
      // If there are no tool calls, we're done
      if (!toolCalls || toolCalls.length === 0) {
        break
      }
      
      // If we have tool results, add them to messages for next iteration
      if (toolResults && toolResults.length > 0) {
        messages.push(...toolResults.map(result => ({
          role: "assistant" as const,
          content: `Tool result: ${JSON.stringify(result)}`
        })))
      }
    }
    
    const usage = totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0 
      ? totalUsage 
      : undefined
    
    if (usage) {
      console.log(`Token usage - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}`)
    }
    
    return {
      text: fullText,
      usage: usage
    }
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : `Unknown error from ${providerID} ${modelID}`
    throw new Error(`LLM call failed (${providerID} ${modelID}): ${errorMessage}`)
  }
}

export async function streamResponse(input: StreamInput): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const { providerID, modelID, apiKey, baseURL, systemPrompt, messages, tools, onChunk, onFinish } = input

  try {
    const model = getProviderModel({ providerID, modelID, apiKey, baseURL })
    const aiTools = convertToolsToAISDKFormat(tools)

    // For now, use simple streaming without multi-step
    // The current AI SDK version doesn't support streaming with tool calls easily
    let fullText = ""
    
    const result = await streamText({
      model,
      system: systemPrompt,
      messages,
      tools: aiTools,
      onFinish: ({ text, usage }) => {
        fullText = text
        if (usage) {
          console.log(`Token usage - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}`)
        }
        if (onFinish) {
          onFinish(text)
        }
      }
    })
    
    // Stream chunks to the callback
    for await (const chunk of result.textStream) {
      fullText += chunk
      onChunk(chunk)
    }

    // Stream chunks to the callback
    for await (const chunk of result.textStream) {
      fullText += chunk
      onChunk(chunk)
    }

    return {
      text: fullText,
      usage: undefined // Usage will be logged in onFinish callback
    }
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : `Unknown error from ${providerID} ${modelID}`
    throw new Error(`LLM streaming failed (${providerID} ${modelID}): ${errorMessage}`)
  }
}

