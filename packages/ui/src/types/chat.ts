export interface Session {
  id: string
  directory: string | null
  created_at: number
  updated_at: number
  status: string
}

export interface Message {
  sender: string
  text: string
  timestamp: string
}

export interface ToolActivity {
  toolCallId: string
  tool: string
  status: 'calling' | 'done'
}

export interface StreamingMessage {
  text: string
  toolActivity: ToolActivity[]
}

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; tool: string; toolCallId: string; args: unknown }
  | { type: 'tool_result'; tool: string; toolCallId: string; result: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string }
