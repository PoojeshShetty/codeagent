import { useState, useRef, useEffect } from "react"
import type { RecentProject } from "./Home"
import "./ChatInterface.css"
import { apiHeaders } from "../utils/api"

interface ChatInterfaceProps {
  activeProject: RecentProject | null
}

export default function ChatInterface({ activeProject }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<{ sender: string; text: string; timestamp: string }[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<{ id: string; title: string; active: boolean }[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const startSession = async () => {
    try {
      const response = await fetch("http://localhost:4096/session", {
        method: "POST",
        headers: apiHeaders(activeProject),
      })
      if (response.ok) {
        const data = await response.json()
        const newSessionId = data.sessionId
        setSessionId(newSessionId)
        setIsSessionActive(true)
        setSessions((prev) => [
          ...prev.map((s) => ({ ...s, active: false })),
          { id: newSessionId, title: `Session ${prev.length + 1}`, active: true },
        ])
        setMessages([
          { sender: "system", text: "Session started. How can I help you today?", timestamp: new Date().toISOString() },
        ])
      }
    } catch {
      setMessages([{ sender: "system", text: "Failed to start session. Please try again.", timestamp: new Date().toISOString() }])
    }
  }

  const endSession = () => {
    setIsSessionActive(false)
    setSessionId(null)
    setSessions((prev) => prev.map((s) => ({ ...s, active: false })))
    setMessages([{ sender: "system", text: "Session ended.", timestamp: new Date().toISOString() }])
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !isSessionActive || !sessionId) return
    const userMessage = { sender: "user", text: inputValue, timestamp: new Date().toISOString() }
    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    try {
      const response = await fetch(`http://localhost:4096/session/${sessionId}`, {
        method: "POST",
        headers: apiHeaders(activeProject),
        body: JSON.stringify({ message: inputValue }),
      })
      if (response.ok) {
        const data = await response.json()
        setMessages((prev) => [...prev, { sender: "bot", text: data.text, timestamp: new Date().toISOString() }])
      }
    } catch {
      setMessages((prev) => [...prev, { sender: "system", text: "Failed to send message.", timestamp: new Date().toISOString() }])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`http://localhost:4096/session/${sessionId}`)
        if (res.ok) {
          const data = await res.json()
          setMessages(data.map((m: any) => ({ sender: m.role, text: m.content, timestamp: new Date(m.created_at).toISOString() })))
        }
      } catch (err) {
        console.log("Err in poll ", ErrorEvent)
      }
    }
    if (!sessionId || !isSessionActive) return
    poll()
  }, [sessionId, isSessionActive])

  return (
    <div className="chat-layout">
      {/* ── Session Sidebar ── */}
      <div className="session-sidebar">
        <div className="sidebar-header">
          {activeProject ? (
            <>
              <span className="sidebar-project-name">{activeProject.name}</span>
              <span className="sidebar-project-path">{activeProject.path}</span>
            </>
          ) : (
            <span className="sidebar-project-name">No project</span>
          )}
        </div>

        <button onClick={startSession} className="new-session-btn">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New session
        </button>

        <div className="sessions-list">
          {sessions.map((session) => (
            <div key={session.id} className={`session-item ${session.active ? "active" : ""}`}>
              <span className="session-title">{session.title}</span>
              {session.active && (
                <button onClick={endSession} className="end-session-btn" title="End session">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="main-area">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              {activeProject ? (
                <p>{isSessionActive ? "Session active — enter a prompt below" : "Click \"New session\" to start"}</p>
              ) : (
                <p>Open a project to get started</p>
              )}
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((msg, i) => (
                <div key={i} className={`message message-${msg.sender}`}>
                  <div className="message-text">{msg.text}</div>
                  <div className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</div>
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
            onKeyDown={handleKeyDown}
            placeholder={
              !activeProject
                ? "Open a project first…"
                : isSessionActive
                ? 'Ask anything… "Find and fix security vulnerabilities"'
                : "Start a session to begin…"
            }
            disabled={!isSessionActive}
            className="message-input"
            rows={3}
          />
          <div className="input-footer">
            <button onClick={handleSendMessage} disabled={!inputValue.trim() || !isSessionActive} className="send-btn">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
