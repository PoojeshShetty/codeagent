import { useEffect, useState } from "react"
import ProjectRail from "./components/ProjectRail"
import ChatInterface from "./components/ChatInterface"
import { getRecentProjects, type RecentProject } from "./components/Home"

const STORAGE_KEY = "recentProjects"

function saveProject(project: RecentProject, existing: RecentProject[]): RecentProject[] {
  const updated = [project, ...existing.filter((p) => p.path !== project.path)].slice(0, 10)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}

function App() {
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [activeProject, setActiveProject] = useState<RecentProject | null>(null)

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

  function handleAddProject() {
    // Tauri file-dialog integration comes in Step 2.
    // For now, mock a project so the full flow is testable end-to-end.
    const mockPath = "C:/Users/demo/my-project"
    const mockName = mockPath.split(/[\\/]/).pop() ?? mockPath
    const project: RecentProject = { path: mockPath, name: mockName, openedAt: Date.now() }
    handleProjectSelect(project)
  }

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <ProjectRail
        projects={projects}
        activeProject={activeProject}
        onProjectSelect={handleProjectSelect}
        onAddProject={handleAddProject}
      />
      <ChatInterface activeProject={activeProject} />
    </div>
  )
}

export default App
