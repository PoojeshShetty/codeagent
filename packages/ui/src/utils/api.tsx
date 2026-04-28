import type { RecentProject } from "../types/Home";

export   /** Base headers for every API request — always includes directory when a project is open */
  function apiHeaders(activeProject: RecentProject, extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(activeProject ? { directory: activeProject.path } : {}),
      ...extra,
    }
  }