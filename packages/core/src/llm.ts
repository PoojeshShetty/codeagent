import { getToolByName, bashTool, readTool } from './tools'
import { saveMessage, getSessionMessages } from './db'
import { v4 as uuidv4 } from 'uuid'

// Simple LLM simulation for basic functionality
async function simulateLLMResponse(messages: any[]) {
  const lastMessage = messages[messages.length - 1]
  
  // Simple logic to determine response
  if (lastMessage.content.toLowerCase().includes('read file')) {
    // Extract filename if possible
    const filenameMatch = lastMessage.content.match(/read file "?([^"]+)"?/i)
    if (filenameMatch) {
      const filename = filenameMatch[1]
      return `I need to read the file ${filename} to answer your question. Let me do that now.`
    }
  } else if (lastMessage.content.toLowerCase().includes('list files')) {
    return "I can list files in the current directory. Would you like me to do that?"
  }
  
  return "I understand your request. Let me process it and see what tools I need to use."
}

export async function processUserMessage(sessionId: string, userMessage: string) {
  // Save user message to database
  const userMessageId = uuidv4()
  saveMessage(sessionId, userMessageId, 'user', userMessage)
  
  // Get conversation history
  const messages = getSessionMessages(sessionId)
  
  // Convert to LLM message format
  const llmMessages = messages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content
  }))
  
  // Add system message if this is the first message
  if (messages.length === 1) {
    llmMessages.unshift({
      role: 'system' as const,
      content: 'You are a helpful coding assistant. You can use tools to read files and execute commands.'
    })
  }
  
  // Generate assistant message ID
  const assistantMessageId = uuidv4()
  
  // Simulate LLM response
  const simulatedResponse = await simulateLLMResponse(llmMessages)
  saveMessage(sessionId, assistantMessageId, 'assistant', simulatedResponse)
  
  // Check if we need to use tools based on the response
  if (simulatedResponse.includes('read the file')) {
    // Extract filename
    const filenameMatch = simulatedResponse.match(/read the file ([^ .]+)/)
    if (filenameMatch) {
      const filename = filenameMatch[1]
      
      try {
        // Try different possible paths
        const pathsToTry = [
          filename,
          `packages/core/${filename}`,
          `packages/ui/${filename}`,
          `packages/desktop/${filename}`
        ]
        
        let fileContent = ''
        let foundPath = ''
        
        for (const path of pathsToTry) {
          try {
            // Check if file exists
            await Bun.file(path).text()
            foundPath = path
            break
          } catch {
            // File doesn't exist, try next path
          }
        }
        
        if (foundPath) {
          // Use read tool
          const toolId = uuidv4()
          fileContent = await readTool.execute({ path: foundPath }, {
            sessionId,
            toolId,
            signal: new AbortController().signal
          })
        } else {
          fileContent = `File ${filename} not found in any of the expected locations.`
        }
        
        // Update assistant message with file content
        const updatedResponse = simulatedResponse + '\n\nFile content:\n```\n' + fileContent + '\n```'
        saveMessage(sessionId, assistantMessageId, 'assistant', updatedResponse)
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const updatedResponse = simulatedResponse + '\n\nError reading file: ' + errorMessage
        saveMessage(sessionId, assistantMessageId, 'assistant', updatedResponse)
      }
    }
  }
  
  return {
    sessionId,
    messageId: assistantMessageId,
    content: getSessionMessages(sessionId).find(m => m.id === assistantMessageId)?.content || ''
  }
}