export interface SendMessageInput {
  sessionId: string
  directory: string
  message: string
  providerId: string
  modelId: string
  apiKey: string
}

export type StreamMessageInput = SendMessageInput
