import { createContext, useContext, useMemo, type ReactNode } from "react"

interface TauriContextValue {
  /** True when the UI is running inside the Tauri desktop shell */
  isTauri: boolean
}

const TauriContext = createContext<TauriContextValue | null>(null)

function detectTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function TauriProvider({ children }: { children: ReactNode }) {
  // Evaluated once at mount — the Tauri flag never changes at runtime
  const value = useMemo<TauriContextValue>(() => ({ isTauri: detectTauri() }), [])

  return <TauriContext.Provider value={value}>{children}</TauriContext.Provider>
}

/** Hook — throws if used outside <TauriProvider> */
export function useTauri(): TauriContextValue {
  const ctx = useContext(TauriContext)
  if (!ctx) throw new Error("useTauri must be used within a <TauriProvider>")
  return ctx
}
