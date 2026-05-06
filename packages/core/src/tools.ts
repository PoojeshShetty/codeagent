import { z, ZodTypeAny } from 'zod'
import { $ } from 'bun'
import { resolve, isAbsolute, sep } from 'path'
import { stat, readdir, writeFile, readFile, mkdir } from 'fs/promises'
import { saveToolCall, updateToolOutput } from './db'

export interface ToolDefinition<T extends ZodTypeAny = ZodTypeAny> {
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function resolvePath(filePath: string, ctx?: ToolContext): string {
  if (isAbsolute(filePath)) return filePath
  const base = ctx?.directory ?? process.cwd()
  return resolve(base, filePath)
}

function assertWithinDirectory(absolutePath: string, ctx?: ToolContext): void {
  const dir = resolve(ctx?.directory ?? process.cwd())
  const normalized = resolve(absolutePath)
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  if (normalized !== dir && !normalized.startsWith(prefix)) {
    throw new Error(`Access denied: path is outside the project directory "${dir}"`)
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      results.push(...await walkFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

// ─── bash ─────────────────────────────────────────────────────────────────────

const bashSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  description: z.string().optional().describe('Why this command is needed')
})

export const bashTool: ToolDefinition<typeof bashSchema> = {
  name: 'bash',
  description: 'Execute shell commands on the local machine',
  parameters: bashSchema,
  execute: async ({ command }, ctx) => {
    saveToolCall(ctx!.sessionId, ctx!.toolId, 'bash', command, null, 'executing')
    try {
      const result = await $`${command}`.cwd(ctx?.directory ?? process.cwd()).text()
      updateToolOutput(ctx!.toolId, result, 'completed')
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      updateToolOutput(ctx!.toolId, msg, 'failed')
      throw new Error(`Command failed: ${msg}`)
    }
  }
}

// ─── read_file ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 50 * 1024 // 50 KB

const readFileSchema = z.object({
  path: z.string().describe('Absolute or relative path to the file to read')
})

export const readFileTool: ToolDefinition<typeof readFileSchema> = {
  name: 'read_file',
  description:
    'Read the contents of a file at the given path. ' +
    'Use this when the user asks about the contents of a file, ' +
    'wants to understand what a file does, or references a specific file path. ' +
    'Returns the full file content as text.',
  parameters: readFileSchema,
  execute: async ({ path: filePath }, ctx) => {
    const absolutePath = resolvePath(filePath, ctx)
    assertWithinDirectory(absolutePath, ctx)
    const file = Bun.file(absolutePath)
    let exists = false
    try { exists = await file.exists() } catch { /* fall through */ }
    if (!exists) return `File not found: ${absolutePath}`

    const content = await file.text()
    if (content.length > MAX_FILE_SIZE) {
      const sizeKB = Math.round(content.length / 1024)
      return content.slice(0, MAX_FILE_SIZE) + `\n\n(truncated — showing first 50KB of ${sizeKB}KB file)`
    }
    return content
  }
}

// ─── list_directory ───────────────────────────────────────────────────────────

const listDirectorySchema = z.object({
  path: z.string().optional().describe(
    'Absolute or relative path to list. Defaults to the open project directory.'
  )
})

export const listDirectoryTool: ToolDefinition<typeof listDirectorySchema> = {
  name: 'list_directory',
  description:
    'List the files and folders in a directory. ' +
    'Use this when the user asks what files are in a folder, wants to explore a directory, ' +
    'or needs to know what exists at a given path. ' +
    'Folders are shown with a trailing /. Returns a newline-separated list.',
  parameters: listDirectorySchema,
  execute: async ({ path: dirPath }, ctx) => {
    const targetPath = dirPath ? resolvePath(dirPath, ctx) : (ctx?.directory ?? process.cwd())
    assertWithinDirectory(targetPath, ctx)

    try {
      const s = await stat(targetPath)
      if (!s.isDirectory()) return `Not a directory: ${targetPath}`
    } catch {
      return `Directory not found: ${targetPath}`
    }

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      if (entries.length === 0) return `(empty directory: ${targetPath})`
      return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n')
    } catch (error) {
      return `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ─── insert_file ─────────────────────────────────────────────────────────────

const insertFileSchema = z.object({
  path: z.string().describe('Relative path (within the project) for the new file'),
  content: z.string().describe('Full content to write into the file'),
  overwrite: z.boolean().optional().describe('Allow overwriting an existing file (default: false)')
})

export const insertFileTool: ToolDefinition<typeof insertFileSchema> = {
  name: 'insert_file',
  description:
    'Create a new file with the given content inside the project directory. ' +
    'Fails if the file already exists unless overwrite is true. ' +
    'Parent directories are created automatically.',
  parameters: insertFileSchema,
  execute: async ({ path: filePath, content, overwrite = false }, ctx) => {
    const absolutePath = resolvePath(filePath, ctx)
    assertWithinDirectory(absolutePath, ctx)

    const file = Bun.file(absolutePath)
    const exists = await file.exists()
    if (exists && !overwrite) {
      return `Error: file already exists at "${absolutePath}". Use overwrite: true to replace it.`
    }

    try {
      await mkdir(resolve(absolutePath, '..'), { recursive: true })
      await writeFile(absolutePath, content, 'utf8')
      return `File written: ${absolutePath} (${content.length} chars)`
    } catch (error) {
      return `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ─── update_file ─────────────────────────────────────────────────────────────

const updateFileSchema = z.object({
  path: z.string().describe('Relative path (within the project) to the file to update'),
  old_content: z.string().describe('Exact string to find in the file'),
  new_content: z.string().describe('Replacement string'),
  replace_all: z.boolean().optional().describe('Replace every occurrence (default: false — only replaces first)')
})

export const updateFileTool: ToolDefinition<typeof updateFileSchema> = {
  name: 'update_file',
  description:
    'Edit an existing file inside the project directory by replacing a specific string with new content. ' +
    'The file must exist and old_content must be present in the file.',
  parameters: updateFileSchema,
  execute: async ({ path: filePath, old_content, new_content, replace_all = false }, ctx) => {
    const absolutePath = resolvePath(filePath, ctx)
    assertWithinDirectory(absolutePath, ctx)

    const file = Bun.file(absolutePath)
    const exists = await file.exists()
    if (!exists) return `Error: file not found at "${absolutePath}"`

    const original = await file.text()
    if (!original.includes(old_content)) {
      return `Error: old_content not found in "${absolutePath}"`
    }

    const updated = replace_all
      ? original.split(old_content).join(new_content)
      : original.replace(old_content, new_content)

    try {
      await writeFile(absolutePath, updated, 'utf8')
      const count = replace_all
        ? (original.split(old_content).length - 1)
        : 1
      return `Updated ${count} occurrence(s) in "${absolutePath}"`
    } catch (error) {
      return `Failed to update file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ─── search_file ─────────────────────────────────────────────────────────────

const MAX_SEARCH_RESULTS = 100

const searchFileSchema = z.object({
  pattern: z.string().describe('Text or regex pattern to search for'),
  path: z.string().optional().describe('Subdirectory to search in (defaults to project root)'),
  case_sensitive: z.boolean().optional().describe('Case-sensitive search (default: true)'),
  is_regex: z.boolean().optional().describe('Treat pattern as a regular expression (default: false)')
})

export const searchFileTool: ToolDefinition<typeof searchFileSchema> = {
  name: 'search_file',
  description:
    'Recursively search for a text pattern across files in the project directory. ' +
    'Returns matching file paths with line numbers and the matched line content. ' +
    'node_modules and .git are skipped automatically.',
  parameters: searchFileSchema,
  execute: async ({ pattern, path: searchPath, case_sensitive = true, is_regex = false }, ctx) => {
    const rootDir = searchPath ? resolvePath(searchPath, ctx) : (ctx?.directory ?? process.cwd())
    assertWithinDirectory(rootDir, ctx)

    let regex: RegExp
    try {
      const flags = case_sensitive ? '' : 'i'
      regex = is_regex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    } catch (error) {
      return `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`
    }

    let files: string[]
    try {
      files = await walkFiles(rootDir)
    } catch {
      return `Directory not found: ${rootDir}`
    }

    const matches: string[] = []
    for (const file of files) {
      if (matches.length >= MAX_SEARCH_RESULTS) break
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const rel = file.startsWith(rootDir) ? file.slice(rootDir.length).replace(/^[\\/]/, '') : file
          matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`)
          if (matches.length >= MAX_SEARCH_RESULTS) break
        }
      }
    }

    if (matches.length === 0) return `No matches found for "${pattern}"`
    const header = matches.length === MAX_SEARCH_RESULTS ? `(showing first ${MAX_SEARCH_RESULTS} results)\n` : ''
    return header + matches.join('\n')
  }
}

// ─── exports ──────────────────────────────────────────────────────────────────

/** Tools passed to generateResponse / the LLM */
export const tools = {
  read_file: readFileTool,
  list_directory: listDirectoryTool,
  insert_file: insertFileTool,
  update_file: updateFileTool,
  search_file: searchFileTool
}
