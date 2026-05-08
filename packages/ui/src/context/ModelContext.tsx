import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export interface ModelEntry {
  id: string
  name: string
  [key: string]: unknown
}

export interface ProviderEntry {
  id: string
  name: string
  api?: string
  models: Record<string, ModelEntry>
}

export interface SelectedModel {
  modelId: string
  providerId: string
}

interface ModelContextValue {
  providers: Record<string, ProviderEntry>
  loading: boolean
  selectedModel: SelectedModel | null
  selectModel: (providerId: string, modelId: string) => void
}

const STORAGE_KEY = "model_selected"
const BASE = "http://localhost:4096"

function readStorage(): SelectedModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const ModelContext = createContext<ModelContextValue | null>(null)

export function ModelProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({})
  const [loading, setLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(readStorage)

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch(`${BASE}/providers`)
        if (res.ok) setProviders(await res.json())
      } catch (e) {
        console.error("Failed to fetch providers:", e)
      } finally {
        setLoading(false)
      }
    }
    fetchProviders()
  }, [])

  function selectModel(providerId: string, modelId: string) {
    const selection: SelectedModel = { providerId, modelId }
    setSelectedModel(selection)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  }

  return (
    <ModelContext.Provider value={{ providers, loading, selectedModel, selectModel }}>
      {children}
    </ModelContext.Provider>
  )
}

export function useModel(): ModelContextValue {
  const ctx = useContext(ModelContext)
  if (!ctx) throw new Error("useModel must be used within a <ModelProvider>")
  return ctx
}
