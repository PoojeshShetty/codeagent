import { useState, useRef, useEffect } from "react"
import type { RecentProject } from "../types/Home"
import type { Session, Message, StreamingMessage, AgentEvent } from "../types/chat"
import { apiHeaders } from "../utils/api"
import ModelSelector from "./ModelSelector"
import { useModel } from "../context/ModelContext"
import "./ChatInterface.css"

interface ChatInterfaceProps {
  activeProject: RecentProject | null
}

const BASE = "http://localhost:4096"

function formatSessionTitle(session: Session, index: number): string {
  const date = new Date(session.created_at)
  return `Session ${index + 1} · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
}

export default function ChatInterface({ activeProject }: ChatInterfaceProps) {
  const { selectedModel } = useModel()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamingMessage])

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
    setStreamingMessage({ text: "", toolActivity: [] })

    try {
      const res = await fetch(`${BASE}/session/${activeSessionId}/stream`, {
        method: "POST",
        headers: apiHeaders(activeProject),
        body: JSON.stringify({
          message: sent,
          providerId: selectedModel?.providerId,
          modelId: selectedModel?.modelId,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`Stream request failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue
          let event: AgentEvent
          try {
            event = JSON.parse(chunk.slice(6))
          } catch {
            continue
          }

          switch (event.type) {
            case "text_delta":
              setStreamingMessage((prev) =>
                prev ? { ...prev, text: prev.text + event.content } : null
              )
              break

            case "tool_call":
              setStreamingMessage((prev) =>
                prev
                  ? {
                      ...prev,
                      toolActivity: [
                        ...prev.toolActivity,
                        { toolCallId: event.toolCallId, tool: event.tool, status: "calling" },
                      ],
                    }
                  : null
              )
              break

            case "tool_result":
              setStreamingMessage((prev) =>
                prev
                  ? {
                      ...prev,
                      toolActivity: prev.toolActivity.map((t) =>
                        t.toolCallId === event.toolCallId ? { ...t, status: "done" } : t
                      ),
                    }
                  : null
              )
              break

            case "done":
              setMessages((prev) => [
                ...prev,
                {
                  sender: "assistant",
                  text: event.fullText,
                  timestamp: new Date().toISOString(),
                },
              ])
              setStreamingMessage(null)
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === activeSessionId ? { ...s, updated_at: Date.now() } : s
                )
              )
              break

            case "error":
              setMessages((prev) => [
                ...prev,
                {
                  sender: "system",
                  text: `Error: ${event.message}`,
                  timestamp: new Date().toISOString(),
                },
              ])
              setStreamingMessage(null)
              break
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "system",
          text: `Failed to send message: ${e instanceof Error ? e.message : "unknown error"}`,
          timestamp: new Date().toISOString(),
        },
      ])
      setStreamingMessage(null)
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

  const isSessionActive = !!activeSessionId

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
          {loadingSessions && <p className="sessions-loading">Loading…</p>}

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

          {(messages.length > 0 || streamingMessage) && (
            <div className="messages-list">
              {messages.map((msg, i) => (
                <div key={i} className={`message message-${msg.sender}`}>
                  <div className="message-text">{msg.text}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {streamingMessage && (
                <div className="message message-assistant">
                  {streamingMessage.toolActivity.map((t) => (
                    <div key={t.toolCallId} className="tool-activity">
                      {t.status === "calling" ? `⟳ ${t.tool}…` : `✓ ${t.tool}`}
                    </div>
                  ))}
                  <div className="message-text">{streamingMessage.text || "…"}</div>
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
            <ModelSelector />
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
