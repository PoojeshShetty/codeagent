import { z, ZodTypeAny } from 'zod'
import { $ } from 'bun'
import { saveToolCall, updateToolOutput } from './db'

export interface ToolDefinition<T extends ZodTypeAny> {
  name: string
  description: string
  parameters: T
  execute: (args: z.infer<T>, context: ToolContext) => Promise<string>
}

export interface ToolContext {
  sessionId: string
  toolId: string
  signal?: AbortSignal
}

// Define schemas
const bashSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  description: z.string().optional().describe('Why this command is needed')
})

const readSchema = z.object({
  path: z.string().describe('Path to the file to read')
})

// Bash tool
export const bashTool: ToolDefinition<typeof bashSchema> = {
  name: 'bash',
  description: 'Execute shell commands on the local machine',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    description: z.string().optional().describe('Why this command is needed')
  }),
  execute: async ({ command }, ctx) => {
    // Save tool call to database
    saveToolCall(ctx.sessionId, ctx.toolId, 'bash', command, null, 'executing')
    
    try {
      // Execute command
      const result = await $`${command}`.text()
      
      // Update tool output
      updateToolOutput(ctx.toolId, result, 'completed')
      
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      updateToolOutput(ctx.toolId, errorMessage, 'failed')
      throw new Error(`Command failed: ${errorMessage}`)
    }
  }
}

// Read file tool
export const readTool: ToolDefinition<typeof readSchema> = {
  name: 'read',
  description: 'Read contents of a file',
  parameters: z.object({
    path: z.string().describe('Path to the file to read')
  }),
  execute: async ({ path }, ctx) => {
    // Save tool call to database
    saveToolCall(ctx.sessionId, ctx.toolId, 'read', path, null, 'executing')
    
    try {
      // Read file
      const content = await Bun.file(path).text()
      
      // Update tool output
      updateToolOutput(ctx.toolId, content, 'completed')
      
      return content
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      updateToolOutput(ctx.toolId, errorMessage, 'failed')
      throw new Error(`Failed to read file: ${errorMessage}`)
    }
  }
}

// Available tools
export const availableTools = [bashTool, readTool]

// Get tool by name
export function getToolByName(name: string) {
  return availableTools.find(tool => tool.name === name)
}

// Convert tools to LLM tool format
export function getToolsForLLM() {
  return availableTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}