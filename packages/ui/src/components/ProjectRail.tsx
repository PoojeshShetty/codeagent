import type { RecentProject } from "../types/Home"
import "./ProjectRail.css"

interface ProjectRailProps {
  projects: RecentProject[]
  activeProject: RecentProject | null
  onProjectSelect: (project: RecentProject) => void
  onAddProject: () => void
  onOpenSettings: () => void
}

/** Deterministic color from a string */
function projectColor(name: string): string {
  const palette = [
    "#7c3aed", // violet
    "#059669", // emerald
    "#dc2626", // red
    "#d97706", // amber
    "#0891b2", // cyan
    "#db2777", // pink
    "#65a30d", // lime
    "#9333ea", // purple
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  }
  return palette[hash % palette.length]
}

function initials(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || name.slice(0, 2).toUpperCase()
}

export default function ProjectRail({
  projects,
  activeProject,
  onProjectSelect,
  onAddProject,
  onOpenSettings,
}: ProjectRailProps) {
  return (
    <div className="project-rail">
      <div className="rail-projects">
        {projects.map((project) => {
          const isActive = activeProject?.path === project.path
          const color = projectColor(project.name)
          return (
            <button
              key={project.path}
              className={`rail-project-btn ${isActive ? "active" : ""}`}
              onClick={() => onProjectSelect(project)}
              title={project.path}
              style={{ "--project-color": color } as React.CSSProperties}
            >
              <span
                className="rail-avatar"
                style={{ background: color }}
              >
                {initials(project.name)}
              </span>
              {isActive && <span className="rail-active-bar" />}
            </button>
          )
        })}
      </div>

      <div className="rail-bottom">
        <button
          className="rail-settings-btn"
          onClick={onOpenSettings}
          title="Provider Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path
              d="M13.3 6.7a1 1 0 0 0 .2-1.1l-.8-1.4a1 1 0 0 0-1-.5l-1 .2a5 5 0 0 0-.9-.5L9.6 2.4A1 1 0 0 0 8.7 2h-1.4a1 1 0 0 0-1 .7l-.3 1a5 5 0 0 0-.9.5l-1-.2a1 1 0 0 0-1 .5L2.3 5.9a1 1 0 0 0 .2 1.1l.8.7v1l-.8.7a1 1 0 0 0-.2 1.1l.8 1.4a1 1 0 0 0 1 .5l1-.2c.3.2.6.4.9.5l.3 1a1 1 0 0 0 1 .7h1.4a1 1 0 0 0 1-.7l.3-1c.3-.1.6-.3.9-.5l1 .2a1 1 0 0 0 1-.5l.8-1.4a1 1 0 0 0-.2-1.1l-.8-.7v-1l.8-.7Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="rail-add-btn"
          onClick={onAddProject}
          title="Open Project"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
