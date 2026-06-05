import { z, ZodType } from 'zod'
import { resolve, isAbsolute, sep } from 'path'
import { writeFile, readFile, mkdir, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'

// changing to any for now
export interface ToolDefinition<T extends any> {
  name: string
  description: string
  parameters: T
  execute: (args: z.infer<T>, context?: ToolContext) => Promise<string>
}

export interface ToolContext {
  sessionId: string
  toolId: string
  /** Absolute path of the open project — all relative paths resolve against this */
  directory: string
  signal?: AbortSignal
}

export function resolvePath(filePath: string, ctx?: ToolContext): string {
  if (isAbsolute(filePath)) return filePath
  const base = ctx?.directory ?? process.cwd()
  return resolve(base, filePath)
}

export function assertWithinDirectory(absolutePath: string, ctx?: ToolContext): void {
  const dir = resolve(ctx?.directory ?? process.cwd())
  const normalized = resolve(absolutePath)
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  if (normalized !== dir && !normalized.startsWith(prefix)) {
    throw new Error(`Access denied: path is outside the project directory "${dir}"`)
  }
}

const MAX_FILE_SIZE = 50 * 1024 // 50 KB

const readSchema = z.object({
  path: z.string().describe('Absolute or relative path to a file or directory')
})

export const readFileTool: ToolDefinition<typeof readSchema> = {
  name: 'read_file',
  description:
    'Read a file or list a directory at the given path. ' +
    'For files, returns the full content as text, truncated at 50KB. ' +
    'For directories, returns a listing of entries with type (file/dir) and name.',
  parameters: readSchema,
  execute: async ({ path: filePath }, ctx) => {
    const absolutePath = resolvePath(filePath, ctx)
    assertWithinDirectory(absolutePath, ctx)

    let info
    try { info = await stat(absolutePath) } catch { return `Path not found: ${absolutePath}` }

    if (info.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true })
      if (entries.length === 0) return `Directory is empty: ${absolutePath}`
      const lines = entries.map(e => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`)
      return `Contents of ${absolutePath}:\n${lines.join('\n')}`
    }

    const file = Bun.file(absolutePath)
    const content = await file.text()
    if (content.length > MAX_FILE_SIZE) {
      const sizeKB = Math.round(content.length / 1024)
      return content.slice(0, MAX_FILE_SIZE) + `\n\n(truncated — showing first 50KB of ${sizeKB}KB file)`
    }
    return content
  }
}

const createFileSchema = z.object({
  path: z.string().describe('Path for the new file (relative to project directory)'),
  content: z.string().describe('Full content to write into the file')
})

export const createFileTool: ToolDefinition<typeof createFileSchema> = {
  name: 'create_file',
  description:
    'Create a new file with the given content. Also creates any missing parent directories. ' +
    'Fails if the file already exists — use update_file to modify an existing file.',
  parameters: createFileSchema,
  execute: async ({ path: filePath, content }, ctx) => {
    const abs = resolvePath(filePath, ctx)
    assertWithinDirectory(abs, ctx)
    if (existsSync(abs)) return `Error: file already exists at ${abs}. Use update_file to modify it.`
    await mkdir(resolve(abs, '..'), { recursive: true })
    await writeFile(abs, content, 'utf8')
    return `Created ${abs} (${content.length} chars)`
  }
}

const updateFileSchema = z.object({
  path: z.string().describe('Path to the file to update (relative to project directory)'),
  old_content: z.string().describe('Exact string to find in the file (must match verbatim)'),
  new_content: z.string().describe('Replacement string')
})

export const updateFileTool: ToolDefinition<typeof updateFileSchema> = {
  name: 'update_file',
  description:
    'Replace the first occurrence of old_content with new_content in an existing file. ' +
    'Fails if old_content is not found verbatim. Use create_file for new files.',
  parameters: updateFileSchema,
  execute: async ({ path: filePath, old_content, new_content }, ctx) => {
    const abs = resolvePath(filePath, ctx)
    assertWithinDirectory(abs, ctx)
    const current = await readFile(abs, 'utf8').catch(() => null)
    if (current === null) return `Error: file not found at ${abs}`
    if (!current.includes(old_content)) return `Error: old_content not found verbatim in ${abs}`
    await writeFile(abs, current.replace(old_content, new_content), 'utf8')
    return `Updated ${abs}`
  }
}

export const tools = {
  read_file: readFileTool,
  create_file: createFileTool,
  update_file: updateFileTool
}
