import { useState, useRef, useEffect } from "react"
import type { RecentProject } from "../types/Home"
import { apiHeaders } from "../utils/api"
import "./ChatInterface.css"

interface Session {
  id: string
  directory: string | null
  created_at: number
  updated_at: number
  status: string
}

interface Message {
  sender: string
  text: string
  timestamp: string
}

interface ChatInterfaceProps {
  activeProject: RecentProject | null
}

const BASE = "http://localhost:4096"

function formatSessionTitle(session: Session, index: number): string {
  const date = new Date(session.created_at)
  return `Session ${index + 1} · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatInterface({ activeProject }: ChatInterfaceProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // ── Effect 1: load sessions whenever the active project changes ──────────────
  useEffect(() => {
    if (!activeProject) {
      setSessions([])
      setActiveSessionId(null)
      setMessages([])
      return
    }

    async function fetchSessions() {
      setLoadingSessions(true)
      try {
        const res = await fetch(`${BASE}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directory: activeProject!.path }),
        })
        if (res.ok) {
          const data: Session[] = await res.json()
          setSessions(data)
          // Don't auto-select — let the user pick or create a new one
          setActiveSessionId(null)
          setMessages([])
        }
      } catch (e) {
        console.error("Failed to fetch sessions:", e)
      } finally {
        setLoadingSessions(false)
      }
    }

    fetchSessions()
  }, [activeProject?.path])

  // ── Effect 2: load messages whenever the active session changes ───────────────
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      return
    }

    async function fetchMessages() {
      setLoadingMessages(true)
      try {
        const res = await fetch(`${BASE}/session/${activeSessionId}`)
        if (res.ok) {
          const data = await res.json()
          setMessages(
            data.map((m: any) => ({
              sender: m.role,
              text: m.content,
              timestamp: new Date(m.created_at).toISOString(),
            }))
          )
        }
      } catch (e) {
        console.error("Failed to fetch messages:", e)
      } finally {
        setLoadingMessages(false)
      }
    }

    fetchMessages()
  }, [activeSessionId])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  async function startSession() {
    if (!activeProject) return
    try {
      const res = await fetch(`${BASE}/session`, {
        method: "POST",
        headers: apiHeaders(activeProject),
      })
      if (res.ok) {
        const data = await res.json()
        const newSession: Session = {
          id: data.sessionId,
          directory: activeProject.path,
          created_at: Date.now(),
          updated_at: Date.now(),
          status: "active",
        }
        // Prepend to list (newest first) and activate it
        setSessions((prev) => [newSession, ...prev])
        setActiveSessionId(newSession.id)
        setMessages([])
      }
    } catch (e) {
      console.error("Failed to create session:", e)
    }
  }

  async function handleSendMessage() {
    if (!inputValue.trim() || !activeSessionId || !activeProject) return

    const optimisticMsg: Message = {
      sender: "user",
      text: inputValue,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])
    const sent = inputValue
    setInputValue("")
    setSending(true)

    try {
      const res = await fetch(`${BASE}/session/${activeSessionId}`, {
        method: "POST",
        headers: apiHeaders(activeProject),
        body: JSON.stringify({ message: sent }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [
          ...prev,
          { sender: "assistant", text: data.text, timestamp: new Date().toISOString() },
        ])
        // Bump updated_at in local state so the sidebar reflects recent activity
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, updated_at: Date.now() } : s
          )
        )
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: "system", text: "Failed to send message.", timestamp: new Date().toISOString() },
      ])
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // ─── Derived state ───────────────────────────────────────────────────────────

  const isSessionActive = !!activeSessionId

  // ─── Render ──────────────────────────────────────────────────────────────────

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
            <span className="sidebar-project-name">No project open</span>
          )}
        </div>

        <button
          onClick={startSession}
          disabled={!activeProject}
          className="new-session-btn"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New session
        </button>

        <div className="sessions-list">
          {loadingSessions && (
            <p className="sessions-loading">Loading…</p>
          )}

          {!loadingSessions && sessions.length === 0 && activeProject && (
            <p className="sessions-empty">No sessions yet</p>
          )}

          {sessions.map((session, index) => {
            const isActive = session.id === activeSessionId
            return (
              <button
                key={session.id}
                className={`session-item ${isActive ? "active" : ""}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="session-title">{formatSessionTitle(session, index)}</span>
                <span className="session-date">
                  {new Date(session.updated_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="main-area">
        <div className="messages-container">
          {!activeProject && (
            <div className="empty-state">
              <p>Open a project from the sidebar to get started</p>
            </div>
          )}

          {activeProject && !isSessionActive && !loadingMessages && (
            <div className="empty-state">
              <p>Select a session or click "New session" to begin</p>
            </div>
          )}

          {loadingMessages && (
            <div className="empty-state">
              <p>Loading messages…</p>
            </div>
          )}

          {isSessionActive && !loadingMessages && messages.length === 0 && (
            <div className="empty-state">
              <p>Session ready — enter a prompt below</p>
            </div>
          )}

          {messages.length > 0 && (
            <div className="messages-list">
              {messages.map((msg, i) => (
                <div key={i} className={`message message-${msg.sender}`}>
                  <div className="message-text">{msg.text}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="message message-system">
                  <div className="message-text typing">Thinking…</div>
                </div>
              )}
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
                : !isSessionActive
                ? "Start or select a session to begin…"
                : 'Ask anything… e.g. "List all files in src/"'
            }
            disabled={!isSessionActive || sending}
            className="message-input"
            rows={3}
          />
          <div className="input-footer">
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || !isSessionActive || sending}
              className="send-btn"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
