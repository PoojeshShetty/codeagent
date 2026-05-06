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

interface ModelEntry {
  id: string
  name: string
  [key: string]: unknown
}

interface ProviderEntry {
  id: string
  name: string
  api?: string
  models: Record<string, ModelEntry>
}

interface SelectedModel {
  modelId: string
  providerId: string
}

interface ChatInterfaceProps {
  activeProject: RecentProject | null
}

const BASE = "http://localhost:4096"
const MODEL_STORAGE_KEY = "model_selected"

function loadSelectedModel(): SelectedModel | null {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSelectedModel(model: SelectedModel) {
  localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model))
}

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

  // Model selector state
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({})
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(loadSelectedModel)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState("")
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Fetch provider/model list once on mount
  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch(`${BASE}/providers`)
        if (res.ok) {
          const data: Record<string, ModelEntry[]> = await res.json()
          setProviders(data)
        }
      } catch (e) {
        console.error("Failed to fetch providers:", e)
      }
    }
    fetchProviders()
  }, [])

  // Close model selector on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setModelSelectorOpen(false)
      }
    }
    if (modelSelectorOpen) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [modelSelectorOpen])

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

  function handleSelectModel(providerId: string, modelId: string) {
    const selection: SelectedModel = { modelId, providerId }
    setSelectedModel(selection)
    saveSelectedModel(selection)
    setModelSelectorOpen(false)
    setModelSearch("")
  }

  // ─── Derived state ───────────────────────────────────────────────────────────

  const isSessionActive = !!activeSessionId

  const filteredProviders = Object.values(providers).reduce<ProviderEntry[]>((acc, provider) => {
    const q = modelSearch.toLowerCase()
    const allModels = Object.values(provider.models)
    const filtered = q
      ? allModels.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      : allModels
    if (filtered.length) acc.push({ ...provider, models: Object.fromEntries(filtered.map(m => [m.id, m])) })
    return acc
  }, [])

  const selectedModelName = selectedModel
    ? providers[selectedModel.providerId]?.models[selectedModel.modelId]?.name ?? selectedModel.modelId
    : null

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
            {/* Model selector */}
            <div className="model-selector-wrap" ref={modelSelectorRef}>
              <button
                className="model-selector-btn"
                onClick={() => setModelSelectorOpen(o => !o)}
                title="Select model"
              >
                <span className="model-selector-icon">⊞</span>
                <span className="model-selector-label">
                  {selectedModelName ?? "Select model"}
                </span>
                <span className="model-selector-chevron">▾</span>
              </button>

              {modelSelectorOpen && (
                <div className="model-dropdown">
                  <div className="model-search-wrap">
                    <span className="model-search-icon">⌕</span>
                    <input
                      className="model-search-input"
                      placeholder="Search models"
                      value={modelSearch}
                      onChange={e => setModelSearch(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="model-list">
                    {filteredProviders.map(provider => (
                      <div key={provider.id} className="model-group">
                        <div className="model-group-header">{provider.name}</div>
                        {Object.values(provider.models).map(model => {
                          const isFree = (model.input === 0 && model.output === 0) || model.free === true
                          const isSelected =
                            selectedModel?.providerId === provider.id &&
                            selectedModel?.modelId === model.id
                          return (
                            <button
                              key={model.id}
                              className={`model-item ${isSelected ? "selected" : ""}`}
                              onClick={() => handleSelectModel(provider.id, model.id)}
                            >
                              <span className="model-item-name">{model.name}</span>
                              {isFree && <span className="model-free-badge">Free</span>}
                              {isSelected && <span className="model-check">✓</span>}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                    {filteredProviders.length === 0 && (
                      <p className="model-empty">No models found</p>
                    )}
                  </div>
                </div>
              )}
            </div>

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
