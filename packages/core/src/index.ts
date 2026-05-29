import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import {
  listSessions,
  createNewSession,
  listMessages,
  sendMessage,
  streamMessage
} from './services/session'

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

function requireDirectory(req: Request): string | Response {
  const directory = req.headers.get("directory")
  if (!directory?.trim()) {
    return err("Missing required header: 'directory' (absolute path of the open project)", 400)
  }
  return directory.trim()
}

function requireApiKey(providerId: string): { apiKey: string } | Response {
  const savedConfig = readProvidersConfig()
  const apiKey = savedConfig[providerId]?.apiKey
  if (!apiKey) {
    return err(`No API key configured for provider "${providerId}". Add it via Provider Settings.`, 400)
  }
  return { apiKey }
}

const server = Bun.serve({
  port: 4096,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === "/hello_world") {
      return json({ message: "Hello from code-agent core!" })
    }

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

    if (req.method === "POST" && url.pathname === "/sessions") {
      let body: { directory?: string }
      try {
        body = await req.json()
      } catch {
        return err("Invalid JSON body", 400)
      }

      const directory = body.directory?.trim()
      if (!directory) return err("Body must contain { directory: string }", 400)

      return json(listSessions(directory))
    }

    if (req.method === "POST" && url.pathname === "/session") {
      const directoryOrResponse = requireDirectory(req)
      if (directoryOrResponse instanceof Response) return directoryOrResponse

      const sessionId = createNewSession(directoryOrResponse)
      return json({ sessionId })
    }

    if (req.method === "POST" && url.pathname.match(/^\/session\/[^/]+\/stream$/)) {
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

      const apiKeyOrResponse = requireApiKey(providerId)
      if (apiKeyOrResponse instanceof Response) return apiKeyOrResponse

      const stream = streamMessage({
        sessionId,
        directory,
        message: body.message,
        providerId,
        modelId,
        apiKey: apiKeyOrResponse.apiKey
      })

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no"
        }
      })
    }

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

      const apiKeyOrResponse = requireApiKey(providerId)
      if (apiKeyOrResponse instanceof Response) return apiKeyOrResponse

      console.log(`[session:${sessionId}] dir="${directory}" provider="${providerId}" model="${modelId}" msg="${body.message.slice(0, 80)}"`)

      try {
        const result = await sendMessage({
          sessionId,
          directory,
          message: body.message,
          providerId,
          modelId,
          apiKey: apiKeyOrResponse.apiKey
        })
        return json(result)
      } catch (error) {
        console.error("LLM error:", error)
        return json({
          text: `Unable to process request: ${error instanceof Error ? error.message : "Unknown error"}`,
          usage: { inputTokens: 0, outputTokens: 0 }
        })
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/")[2]
      return json(listMessages(sessionId))
    }

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

    if (req.method === "GET" && url.pathname === "/provider/register") {
      const config = readProvidersConfig()
      return json({ providerIds: Object.keys(config) })
    }

    return new Response("Not found", { status: 404 })
  }
})

console.log(`Server running at http://localhost:${server.port}`)
