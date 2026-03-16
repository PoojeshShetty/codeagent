const server = Bun.serve({
  port: 4096,
  fetch(req) {
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

    return new Response("Not found", { status: 404 })
  }
})

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
}


console.log(`Server running at http://localhost:${server.port}`)