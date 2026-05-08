import { useEffect, useRef, useState } from "react"
import { useModel } from "../context/ModelContext"
import "./ProviderSettings.css"

const PROVIDER_DISPLAY: Record<string, { icon: string; description: string }> = {
  anthropic:  { icon: "A\\", description: "Direct access to Claude models, including Pro and Max" },
  openai:     { icon: "⊙",  description: "GPT models for fast, capable general AI tasks" },
  mistral:    { icon: "⚡", description: "Open-weight models for fast, efficient inference" },
  google:     { icon: "✦",  description: "Gemini models for fast, structured responses" },
  openrouter: { icon: "⊲",  description: "Access hundreds of models via one API key" },
}

interface Props {
  onClose: () => void
}

export default function ProviderSettings({ onClose }: Props) {
  const { providers } = useModel()
  const [connectedIds, setConnectedIds] = useState<string[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchConnected()
  }, [])

  async function fetchConnected() {
    try {
      const res = await fetch("http://localhost:4096/provider/register")
      const data = await res.json()
      setConnectedIds(data.providerIds ?? [])
    } catch {
      setConnectedIds([])
    }
  }

  async function handleConnect(providerId: string) {
    if (!apiKeyInput.trim()) {
      setError("API key cannot be empty")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("http://localhost:4096/provider/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, apiKey: apiKeyInput.trim() }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? "Failed to save API key")
        return
      }
      setConnecting(null)
      setApiKeyInput("")
      await fetchConnected()
    } catch {
      setError("Could not reach backend")
    } finally {
      setSaving(false)
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  const allProviders = Object.values(providers).map(p => ({
    id: p.id,
    name: p.name,
    icon: PROVIDER_DISPLAY[p.id]?.icon ?? p.name[0].toUpperCase(),
    description: PROVIDER_DISPLAY[p.id]?.description ?? "",
  }))

  const connectedProviders = allProviders.filter(p => connectedIds.includes(p.id))
  const availableProviders = allProviders.filter(p => !connectedIds.includes(p.id))

  return (
    <div className="ps-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="ps-modal">
        <div className="ps-header">
          <span className="ps-title">Providers</span>
          <button className="ps-close" onClick={onClose}>✕</button>
        </div>

        <div className="ps-body">
          {connectedProviders.length > 0 && (
            <section className="ps-section">
              <div className="ps-section-label">Connected providers</div>
              <div className="ps-card">
                {connectedProviders.map((p, i) => (
                  <div key={p.id} className={`ps-row${i < connectedProviders.length - 1 ? " ps-row-divider" : ""}`}>
                    <span className="ps-provider-icon">{p.icon}</span>
                    <span className="ps-provider-name">{p.name}</span>
                    <span className="ps-badge">API key</span>
                    <button
                      className="ps-disconnect"
                      onClick={() => {
                        setConnectedIds(ids => ids.filter(id => id !== p.id))
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="ps-section">
            <div className="ps-section-label">Popular providers</div>
            <div className="ps-card">
              {availableProviders.map((p, i) => (
                <div key={p.id} className="ps-provider-block">
                  <div className={`ps-row${i < availableProviders.length - 1 || connecting === p.id ? " ps-row-divider" : ""}`}>
                    <span className="ps-provider-icon">{p.icon}</span>
                    <div className="ps-provider-info">
                      <span className="ps-provider-name">{p.name}</span>
                      <span className="ps-provider-desc">{p.description}</span>
                    </div>
                    <button
                      className="ps-connect-btn"
                      onClick={() => {
                        setConnecting(connecting === p.id ? null : p.id)
                        setApiKeyInput("")
                        setError(null)
                      }}
                    >
                      {connecting === p.id ? "Cancel" : "+ Connect"}
                    </button>
                  </div>
                  {connecting === p.id && (
                    <div className="ps-key-form">
                      <input
                        className="ps-key-input"
                        type="password"
                        placeholder={`Enter ${p.name} API key`}
                        value={apiKeyInput}
                        onChange={e => { setApiKeyInput(e.target.value); setError(null) }}
                        onKeyDown={e => { if (e.key === "Enter") handleConnect(p.id) }}
                        autoFocus
                      />
                      {error && <span className="ps-error">{error}</span>}
                      <button
                        className="ps-save-btn"
                        onClick={() => handleConnect(p.id)}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {availableProviders.length === 0 && (
                <p className="ps-all-connected">All providers connected</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
