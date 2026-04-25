import { useState, useEffect } from "react"
import "./Home.css"

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

const STORAGE_KEY = "recentProjects"

export function getRecentProjects(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

interface HomeProps {
  onProjectSelected: (project: RecentProject) => void
}

export default function Home({ onProjectSelected }: HomeProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])

  useEffect(() => {
    setRecentProjects(getRecentProjects())
  }, [])

  function chooseProject() {
    // Tauri dialog integration comes in a later step.
    // For now, simulate a selection so the UI flow is testable.
    const mockPath = "/Users/demo/my-project"
    const mockName = mockPath.split("/").pop() ?? mockPath

    const project: RecentProject = {
      path: mockPath,
      name: mockName,
      openedAt: Date.now(),
    }

    saveProject(project)
    onProjectSelected(project)
  }

  function openRecent(project: RecentProject) {
    saveProject(project)
    onProjectSelected(project)
  }

  function saveProject(project: RecentProject) {
    const existing = getRecentProjects().filter((p) => p.path !== project.path)
    const updated = [project, ...existing].slice(0, 10)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setRecentProjects(updated)
  }

  return (
    <div className="home">
      <div className="home-center">
        <h1 className="home-title">code-agent</h1>
        <p className="home-subtitle">AI-powered coding assistant</p>

        <button className="open-project-btn" onClick={chooseProject}>
          Open Project
        </button>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <p className="recent-label">Recent</p>
            <ul className="recent-list">
              {recentProjects.map((project) => (
                <li key={project.path}>
                  <button
                    className="recent-item"
                    onClick={() => openRecent(project)}
                    title={project.path}
                  >
                    <span className="recent-name">{project.name}</span>
                    <span className="recent-path">{project.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
