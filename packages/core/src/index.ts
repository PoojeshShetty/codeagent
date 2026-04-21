import { generateResponse } from './llm'
import { createSession, getSessionMessages } from './db'
import { tools } from './tools'
import { v4 as uuidv4 } from 'uuid'

const server = Bun.serve({
  port: 4096,
  async fetch(req) {
    const url = new URL(req.url)

    // handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      })
    }

   if (url.pathname === "/hello_world") {
      return Response.json(
        { message: "Hello from code-agent core!" },
        { headers: corsHeaders }
      )
    }

    // Create new session
    if (req.method === "POST" && url.pathname === "/session") {
      const sessionId = uuidv4()
      createSession(sessionId)
      return Response.json(
        { sessionId },
        { headers: corsHeaders }
      )
    }

    // Send message to session
    if (req.method === "POST" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/")[2]
      
      try {
        let body
        try {
          body = await req.json()
          console.log("Received body:", body)
        } catch (parseError) {
          console.error("JSON parse error:", parseError)
          return new Response("Invalid JSON", { status: 400, headers: corsHeaders })
        }
        
        if (!body || typeof body.message !== 'string') {
          console.log("Invalid body format:", body)
          return new Response("Invalid request body format", { status: 400, headers: corsHeaders })
        }
        
        console.log("generating response through mistral")
        try {
          const result = await generateResponse({
            providerID: 'mistral',
            modelID: 'devstral-2512',
            apiKey: '0wn4jD3G75yfANRGSK7lg5nv6P4BkHzu',
            messages: [{ role: 'user' as const, content: body.message }],
            tools
          })
          return Response.json(result, { headers: corsHeaders })
        } catch (error) {
          console.error("LLM error:", error)
          // Fallback response if LLM fails
          const fallbackResponse = {
            text: `I'm currently unable to process your request: ${error instanceof Error ? error.message : 'Unknown error'}`,
            usage: { inputTokens: 0, outputTokens: 0 }
          }
          return Response.json(fallbackResponse, { headers: corsHeaders })
        }
      } catch (error) {
        console.error("Error processing message:", error)
        return new Response("Error processing message", { status: 500, headers: corsHeaders })
      }
    }

    // Get session messages
    if (req.method === "GET" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/")[2]
      const messages = getSessionMessages(sessionId)
      return Response.json(messages, { headers: corsHeaders })
    }

    return new Response("Not found", { status: 404 })
  }
})

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
}

console.log(`Server running at http://localhost:${server.port}`)