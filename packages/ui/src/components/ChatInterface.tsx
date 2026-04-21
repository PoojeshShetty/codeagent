import { useState, useRef, useEffect } from "react"

export default function ChatInterface() {
  const [messages, setMessages] = useState<{sender: string, text: string, timestamp: string}[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<{id: string, title: string, active: boolean}[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const startSession = async () => {
    try {
      const response = await fetch("http://localhost:4096/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        const newSessionId = data.sessionId
        setSessionId(newSessionId)
        setIsSessionActive(true)
        
        // Add to sessions list
        setSessions(prev => [
          ...prev.map(s => ({...s, active: false})),
          {id: newSessionId, title: `Session ${prev.length + 1}`, active: true}
        ])
        
        setMessages([
          {
            sender: "system",
            text: "Session started. How can I help you today?",
            timestamp: new Date().toISOString()
          }
        ])
      }
    } catch (error) {
      console.error("Failed to start session:", error)
      setMessages([
        {
          sender: "system",
          text: "Failed to start session. Please try again.",
          timestamp: new Date().toISOString()
        }
      ])
    }
  }

  const endSession = () => {
    setIsSessionActive(false)
    setSessionId(null)
    setSessions(prev => prev.map(s => ({...s, active: false})))
    setMessages([
      {
        sender: "system",
        text: "Session ended.",
        timestamp: new Date().toISOString()
      }
    ])
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !isSessionActive || !sessionId) return

    const userMessage = {
      sender: "user",
      text: inputValue,
      timestamp: new Date().toISOString()
    }

    // Add user message to chat
    setMessages(prev => [...prev, userMessage])
    setInputValue("")

    try {
      // Send message to backend
      const response = await fetch(`http://localhost:4096/session/${sessionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: inputValue
        })
      })

      if (response.ok) {
        const data = await response.json()
        const botMessage = {
          sender: "bot",
          text: data.text,
          timestamp: new Date().toISOString()
        }
        setMessages(prev => [...prev, botMessage])
      }
    } catch (error) {
      console.error("Failed to send message:", error)
      const errorMessage = {
        sender: "system",
        text: "Failed to send message. Please try again.",
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Poll for message updates
  useEffect(() => {
    async function getSessionMessages() {
      try {
        const response = await fetch(`http://localhost:4096/session/${sessionId}`)
        if (response.ok) {
          const messages = await response.json()
          // Simple approach: replace all messages with server state
          setMessages(messages.map((m: any) => ({
            sender: m.role,
            text: m.content,
            timestamp: new Date(m.created_at).toISOString()
          })))
        }
      } catch (error) {
        console.error("Failed to poll messages:", error)
      }
    }
    if (!sessionId || !isSessionActive) return

    getSessionMessages();
    
  }, [sessionId, isSessionActive])

  return (
    <div className="chat-interface">
      <div className="sidebar">
        <button onClick={startSession} className="new-session-btn" title="New Session">
          +
        </button>
        <div className="sessions-list">
          {sessions.map((session) => (
            <div key={session.id} className={`session-item ${session.active ? 'active' : ''}`}>
              {session.title}
              {session.active && (
                <button onClick={endSession} className="end-session-icon" title="End Session">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="main-content">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              {!isSessionActive ? (
                <p>Click "+" to start a new session</p>
              ) : (
                <p>Session active. Enter your prompt below...</p>
              )}
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((message, index) => (
                <div key={index} className={`message ${message.sender}`}>
                  <div className="message-content">
                    {message.text}
                  </div>
                  <div className="message-meta">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="input-area">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={isSessionActive ? "Enter your prompt..." : "Start a session to begin"}
            
            className="message-input"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || !isSessionActive}
            className="send-button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}