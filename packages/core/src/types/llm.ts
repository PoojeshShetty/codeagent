import { ZodType } from 'zod'

export interface ToolDefinition {
  description: string
  parameters: ZodType<any>
  execute: (args: any) => Promise<string>
}

export interface CommonInput {
  providerID: string
  modelID: string
  apiKey: string
  baseURL?: string
  systemPrompt?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  tools?: Record<string, ToolDefinition>
  onStepFinish?: (step: { toolCalls: any[]; toolResults: any[]; text: string }) => void
}

export interface StreamInput extends CommonInput {
  onChunk: (chunk: string) => void
  onFinish?: (fullText: string) => void
}

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; tool: string; toolCallId: string; args: unknown }
  | { type: 'tool_result'; tool: string; toolCallId: string; result: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string }

export interface StreamAgentInput extends Omit<CommonInput, 'messages'> {
  messages: any[]
  onEvent: (event: AgentEvent) => void
}
