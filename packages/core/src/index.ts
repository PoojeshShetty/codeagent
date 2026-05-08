import { generateResponse } from './llm'
import { createSession, getSessionMessages, getSessionsByDirectory, saveMessage } from './db'
import { tools, type ToolContext, type ToolDefinition } from './tools'
import { v4 as uuidv4 } from 'uuid'
import { ZodTypeAny } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

// ─── Provider config helpers ──────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.local', 'share', 'codeagent')
const PROVIDERS_FILE = join(CONFIG_DIR, 'providers.json')

type ProvidersConfig = Record<string, { apiKey: string }>

function readProvidersConfig(): ProvidersConfig {
  if (!existsSync(PROVIDERS_FILE)) return {}
  try {
    return JSON.parse(readFileSync(PROVIDERS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeProvidersConfig(config: ProvidersConfig) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(PROVIDERS_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, directory"
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function err(message: string, status: number) {
  return json({ error: message }, status)
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Reads the `directory` request header. Returns the path or a 400 Response. */
function requireDirectory(req: Request): string | Response {
  const directory = req.headers.get("directory")
  if (!directory?.trim()) {
    return err("Missing required header: 'directory' (absolute path of the open project)", 400)
  }
  return directory.trim()
}

// ─── Tool binding ─────────────────────────────────────────────────────────────

/**
 * Wraps each tool's execute in a closure that injects ToolContext
 * so llm.ts stays unaware of the directory concept.
 */
function bindToolsToDirectory(
  rawTools: Record<string, ToolDefinition<ZodTypeAny>>,
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

// ─── Server ───────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 4096,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (url.pathname === "/hello_world") {
      return json({ message: "Hello from code-agent core!" })
    }

    // ── GET /providers — model list filtered to master provider list ──────────
    if (req.method === "GET" && url.pathname === "/providers") {
      try {
        const res = await fetch("https://models.dev/api.json")
        if (!res.ok) return err("Failed to fetch model registry", 502)
        const data = await res.json() as Record<string, unknown>

        const masterList = ["mistral", "anthropic", "openai"]
        const result: Record<string, unknown> = {}
        for (const provider of masterList) {
          if (data[provider]) result[provider] = data[provider]
        }

        return json(result)
      } catch {
        return err("Failed to fetch providers", 500)
      }
    }

    // ── POST /sessions — get all sessions for a project directory ─────────────
    // Body: { directory: string }
    if (req.method === "POST" && url.pathname === "/sessions") {
      let body: { directory?: string }
      try {
        body = await req.json()
      } catch {
        return err("Invalid JSON body", 400)
      }

      const directory = body.directory?.trim()
      if (!directory) {
        return err("Body must contain { directory: string }", 400)
      }

      const sessions = getSessionsByDirectory(directory)
      return json(sessions)
    }

    // ── POST /session — create a new session ──────────────────────────────────
    if (req.method === "POST" && url.pathname === "/session") {
      const directoryOrResponse = requireDirectory(req)
      if (directoryOrResponse instanceof Response) return directoryOrResponse
      const directory = directoryOrResponse

      const sessionId = uuidv4()
      createSession(sessionId, directory)
      return json({ sessionId })
    }

    // ── POST /session/:id — send a message ────────────────────────────────────
    if (req.method === "POST" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/")[2]

      const directoryOrResponse = requireDirectory(req)
      if (directoryOrResponse instanceof Response) return directoryOrResponse
      const directory = directoryOrResponse

      let body: { message?: string; providerId?: string; modelId?: string }
      try {
        body = await req.json()
      } catch {
        return err("Invalid JSON body", 400)
      }

      if (!body || typeof body.message !== "string") {
        return err("Request body must be { message: string }", 400)
      }

      const providerId = body.providerId?.trim()
      const modelId = body.modelId?.trim()

      if (!providerId || !modelId) {
        return err("Request body must include providerId and modelId", 400)
      }

      const savedConfig = readProvidersConfig()
      const savedApiKey = savedConfig[providerId]?.apiKey
      if (!savedApiKey) {
        return err(`No API key configured for provider "${providerId}". Add it via Provider Settings.`, 400)
      }

      console.log(`[session:${sessionId}] dir="${directory}" provider="${providerId}" model="${modelId}" msg="${body.message.slice(0, 80)}"`)

      try {
        saveMessage(sessionId, uuidv4(), "user", body.message)

        const history = getSessionMessages(sessionId)
        const messages = history.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content
        }))

        const boundTools = bindToolsToDirectory(tools, directory, sessionId)

        const result = await generateResponse({
          providerID: providerId,
          modelID: modelId,
          apiKey: savedApiKey,
          systemPrompt:
            `You are a helpful coding assistant. ` +
            `The user's project is located at: ${directory}. ` +
            `When working with files, always resolve paths relative to that directory. ` +
            `When you use tools, summarize the results clearly in your final response.`,
          messages,
          tools: boundTools
        })

        if (result?.text) saveMessage(sessionId, uuidv4(), "assistant", result.text)

        return json(result)
      } catch (error) {
        console.error("LLM error:", error)
        return json({
          text: `Unable to process request: ${error instanceof Error ? error.message : "Unknown error"}`,
          usage: { inputTokens: 0, outputTokens: 0 }
        })
      }
    }

    // ── GET /session/:id — fetch message history ──────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/")[2]
      const messages = getSessionMessages(sessionId)
      return json(messages)
    }

    // ── POST /provider/register — save provider API key ───────────────────────
    if (req.method === "POST" && url.pathname === "/provider/register") {
      let body: { providerId?: string; apiKey?: string }
      try {
        body = await req.json()
      } catch {
        return err("Invalid JSON body", 400)
      }

      const { providerId, apiKey } = body
      if (!providerId?.trim() || !apiKey?.trim()) {
        return err("Body must contain { providerId: string, apiKey: string }", 400)
      }

      const config = readProvidersConfig()
      config[providerId.trim()] = { apiKey: apiKey.trim() }
      writeProvidersConfig(config)

      return json({ success: true, providerId: providerId.trim() })
    }

    // ── GET /provider/register — list providers with saved API keys ───────────
    if (req.method === "GET" && url.pathname === "/provider/register") {
      const config = readProvidersConfig()
      return json({ providerIds: Object.keys(config) })
    }

    return new Response("Not found", { status: 404 })
  }
})

console.log(`Server running at http://localhost:${server.port}`)
