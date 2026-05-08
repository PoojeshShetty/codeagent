import { useEffect, useRef, useState } from "react"
import { useModel, type ProviderEntry } from "../context/ModelContext"
import "./ModelSelector.css"

export default function ModelSelector() {
  const { providers, loading, selectedModel, selectModel } = useModel()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onOutsideClick)
    return () => document.removeEventListener("mousedown", onOutsideClick)
  }, [open])

  const selectedModelName = selectedModel
    ? (providers[selectedModel.providerId]?.models[selectedModel.modelId]?.name ?? selectedModel.modelId)
    : null

  const filteredProviders = Object.values(providers).reduce<ProviderEntry[]>((acc, provider) => {
    const q = search.toLowerCase()
    const allModels = Object.values(provider.models)
    const filtered = q
      ? allModels.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      : allModels
    if (filtered.length) acc.push({ ...provider, models: Object.fromEntries(filtered.map(m => [m.id, m])) })
    return acc
  }, [])

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button
        className="ms-trigger"
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        title="Select model"
      >
        <span className="ms-icon">⊞</span>
        <span className="ms-label">{loading ? "Loading…" : (selectedModelName ?? "Select model")}</span>
        <span className="ms-chevron">▾</span>
      </button>

      {open && (
        <div className="ms-dropdown">
          <div className="ms-search-row">
            <span className="ms-search-icon">⌕</span>
            <input
              className="ms-search-input"
              placeholder="Search models"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="ms-list">
            {filteredProviders.map(provider => (
              <div key={provider.id} className="ms-group">
                <div className="ms-group-header">{provider.name}</div>
                {Object.values(provider.models).map(model => {
                  const isFree = (model.input === 0 && model.output === 0) || model.free === true
                  const isSelected =
                    selectedModel?.providerId === provider.id && selectedModel?.modelId === model.id
                  return (
                    <button
                      key={model.id}
                      className={`ms-item${isSelected ? " selected" : ""}`}
                      onClick={() => { selectModel(provider.id, model.id); setOpen(false); setSearch("") }}
                    >
                      <span className="ms-item-name">{model.name}</span>
                      {isFree && <span className="ms-free-badge">Free</span>}
                      {isSelected && <span className="ms-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
            {filteredProviders.length === 0 && (
              <p className="ms-empty">No models found</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
