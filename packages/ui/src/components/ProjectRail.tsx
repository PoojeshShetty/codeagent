import type { RecentProject } from "../types/Home"
import "./ProjectRail.css"

interface ProjectRailProps {
  projects: RecentProject[]
  activeProject: RecentProject | null
  onProjectSelect: (project: RecentProject) => void
  onAddProject: () => void
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
