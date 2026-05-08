import { useEffect, useState } from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import ProjectRail from "./components/ProjectRail"
import ChatInterface from "./components/ChatInterface"
import ProviderSettings from "./components/ProviderSettings"
import { getRecentProjects } from "./components/Home"
import type { RecentProject } from "./types/Home"
import { useTauri } from "./context/TauriContext"

const STORAGE_KEY = "recentProjects"

function saveProject(project: RecentProject, existing: RecentProject[]): RecentProject[] {
  const updated = [project, ...existing.filter((p) => p.path !== project.path)].slice(0, 10)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}

function App() {
  const { isTauri } = useTauri()
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [activeProject, setActiveProject] = useState<RecentProject | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    fetch("http://localhost:4096/hello_world")
      .then((r) => r.json())
      .then((d) => console.log("Backend:", d.message))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const saved = getRecentProjects()
    setProjects(saved)
    if (saved.length > 0) setActiveProject(saved[0])
  }, [])

  function handleProjectSelect(project: RecentProject) {
    setActiveProject(project)
    setProjects((prev) => saveProject(project, prev))
  }

  async function handleAddProject() {
    let folderPath: string | null = null

    if (isTauri) {
      // Native OS folder picker
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Open Project Folder",
      })
      // result is string | string[] | null depending on `multiple`
      folderPath = typeof result === "string" ? result : null
    } else {
      // Browser dev fallback — prompt so the flow is still testable
      folderPath = window.prompt("Enter project path (browser fallback):", "/Users/me/my-project")
    }

    if (!folderPath) return

    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath
    handleProjectSelect({ path: folderPath, name, openedAt: Date.now() })
  }

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <ProjectRail
        projects={projects}
        activeProject={activeProject}
        onProjectSelect={handleProjectSelect}
        onAddProject={handleAddProject}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatInterface activeProject={activeProject} />
      {settingsOpen && <ProviderSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
