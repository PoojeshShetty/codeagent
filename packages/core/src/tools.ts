import { z, ZodTypeAny } from 'zod'
import { $ } from 'bun'
import { resolve, isAbsolute } from 'path'
import { stat, readdir } from 'fs/promises'
import { saveToolCall, updateToolOutput } from './db'

export interface ToolDefinition<T extends ZodTypeAny> {
  name: string
  description: string
  parameters: T
  execute: (args: z.infer<T>, context?: ToolContext) => Promise<string>
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

const MAX_FILE_SIZE = 50 * 1024 // 50KB

const readFileSchema = z.object({
  filePath: z.string().describe('Absolute or relative path to the file to read')
})

export const readFileTool: ToolDefinition<typeof readFileSchema> = {
  name: 'read_file',
  description:
    'Read the contents of a file at the given path. ' +
    'Use this when the user asks about the contents of a file, ' +
    'wants to understand what a file does, or references a specific file path. ' +
    'Returns the full file content as text.',
  parameters: readFileSchema,
  execute: async ({ filePath }, _ctx) => {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
    const file = Bun.file(absolutePath)
    const exists = await file.exists()
    if (!exists) {
      return `File not found: ${absolutePath}`
    }
    const content = await file.text()
    if (content.length > MAX_FILE_SIZE) {
      const sizeKB = Math.round(content.length / 1024)
      return content.slice(0, MAX_FILE_SIZE) + `\n\n(truncated — showing first 50KB of ${sizeKB}KB file)`
    }
    return content
  }
}

const listDirectorySchema = z.object({
  path: z.string().optional().describe('Absolute or relative path to the directory to list. Defaults to current working directory if not provided.')
})

export const listDirectoryTool: ToolDefinition<typeof listDirectorySchema> = {
  name: 'list_directory',
  description:
    'List the files and folders in a directory. ' +
    'Use this when the user asks what files are in a folder, wants to explore a directory, ' +
    'or needs to know what exists at a given path. ' +
    'Folders are shown with a trailing /. Returns a newline-separated list.',
  parameters: listDirectorySchema,
  execute: async ({ path: dirPath }) => {
    const targetPath = dirPath
      ? (isAbsolute(dirPath) ? dirPath : resolve(process.cwd(), dirPath))
      : process.cwd()

    try {
      const s = await stat(targetPath)
      if (!s.isDirectory()) return `Not a directory: ${targetPath}`
    } catch {
      return `Directory not found: ${targetPath}`
    }

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      if (entries.length === 0) {
        return `(empty directory: ${targetPath})`
      }
      return entries
        .map(e => e.isDirectory() ? `${e.name}/` : e.name)
        .join('\n')
    } catch (error) {
      return `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// Tools map for use with generateResponse
export const tools = {
  read_file: readFileTool,
  list_directory: listDirectoryTool
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