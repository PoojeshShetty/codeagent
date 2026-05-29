## Dev Commands

Run everything together from the repo root:

```bash
bun run dev          # turbo: starts core + ui in parallel (desktop runs separately)
bun run build        # turbo: builds core then ui
```

Run individual packages:

```bash
# Core (Bun HTTP server, port 4096, hot-reload)
cd packages/core && bun run dev

# UI (Vite dev server, port 5173)
cd packages/ui && bun run dev

# Desktop (Tauri — wraps ui dev server, needs ui running first)
cd packages/desktop && bun run dev

# Type-check UI only
cd packages/ui && bun x tsc --noEmit

# Type-check core only
cd packages/core && bun x tsc --noEmit
```

> There are no tests yet.

---

## Architecture

```
Tauri Desktop Shell (packages/desktop)
  └─ wraps Vite dev server or built UI dist
       └─ React UI (packages/ui, port 5173)
            └─ HTTP fetch calls
                 └─ Bun HTTP Server (packages/core, port 4096)
                      ├─ Vercel AI SDK → LLM (Anthropic / Mistral / OpenAI)
                      ├─ Tool execution (scoped to project directory)
                      └─ SQLite (code_agent.db, via bun:sqlite)
```

The backend and desktop are **separate processes** — Tauri does not embed the Bun server. Both must be running for full functionality.

---

## Core API (`packages/core`)

All responses include CORS headers. Custom header `directory` (absolute project path) is required on session endpoints.

| Method | Path | Required | Description |
|--------|------|----------|-------------|
| GET | `/hello_world` | — | Health check |
| GET | `/providers` | — | Provider + model list from models.dev, filtered to mistral/anthropic/openai |
| GET | `/provider/register` | — | List provider IDs that have a saved API key |
| POST | `/provider/register` | `{ providerId, apiKey }` | Save API key for a provider |
| POST | `/sessions` | body `{ directory }` | Get all sessions for a project directory |
| POST | `/session` | header `directory` | Create new session (stored with directory) |
| POST | `/session/:id` | header `directory`, body `{ message, providerId, modelId }` | Send message, get LLM reply |
| GET | `/session/:id` | — | Fetch message history for a session |

**Provider config** is persisted at `~/.local/share/codeagent/providers.json` as `{ [providerId]: { apiKey } }`.

**SQLite DB** is `code_agent.db` in the working directory of `packages/core`. Tables: `sessions` (includes `directory` column), `messages`, `tools`.

### Tool execution pattern

`tools.ts` defines `ToolDefinition<T>` with `execute(args, ctx?: ToolContext)`. `ToolContext` carries `{ sessionId, toolId, directory }`. Before calling the LLM, `index.ts` calls `bindToolsToDirectory()` which wraps each tool's `execute` in a closure injecting the context — so `llm.ts` stays unaware of the directory concept and just calls `execute(args)`.

All file/shell tools resolve relative paths against `ctx.directory` (not `process.cwd()`). Paths outside the project directory are blocked (`assertWithinDirectory`).

### LLM & tool limits

- **Max steps**: `generateResponse` stops after 10 tool-call steps (`stopWhen: stepCountIs(10)`).
- **Streaming**: `streamResponse` does not support multi-step tool calls — tool results won't be fed back to the model in a follow-up step.
- **`read_file`**: truncates at 50 KB; returns partial content with a note.
- **`search_file`**: caps at 100 results; skips `node_modules` and `.git`.
- **`bash`**: blocks `sudo`, `su`, `eval`, and `curl … | sh` patterns; all referenced paths must resolve within the project directory.
- **`insert_file`**: fails if the file exists unless `overwrite: true`; parent directories are created automatically.
- **`update_file`**: requires `old_content` to be present verbatim; replaces only the first occurrence unless `replace_all: true`.

### SQLite schema notes

`code_agent.db` lives in `packages/core/` (wherever `bun run dev` is launched from).

| Table | Notable columns / values |
|-------|--------------------------|
| `sessions` | `status = 'active'`; `directory` was added via migration — old rows may have `NULL` |
| `messages` | `role` is `'user'` or `'assistant'`; ordered by `created_at ASC` |
| `tools` | `status` cycles: `'pending'` → `'executing'` → `'completed'` / `'failed'`; `output` is `NULL` until the tool finishes |

---

## UI (`packages/ui`)

**Entry**: `main.tsx` renders `<TauriProvider><ModelProvider><App /></ModelProvider></TauriProvider>`

**Context providers** (both must wrap any consumer):
- `TauriContext` — exposes `isTauri: boolean` (detected once via `window.__TAURI_INTERNALS__`). Use `useTauri()` anywhere you need to branch on desktop vs browser.
- `ModelContext` — fetches provider list from `/providers`, persists selected model to `localStorage["model_selected"]`. Use `useModel()` to read `selectedModel` and call `selectModel()`.

**Layout** (three columns rendered in `App.tsx`):
```
ProjectRail (48px) | SessionSidebar (240px) | ChatArea (flex-1)
```
- `ProjectRail` — icon per project from `localStorage["recentProjects"]`, settings button, add button.
- Session sidebar + chat area live inside `ChatInterface.tsx`.

**State flow**:
1. User picks/adds project → `App.tsx` saves to `localStorage["recentProjects"]`, sets `activeProject`
2. `ChatInterface` `useEffect([activeProject.path])` → `POST /sessions { directory }` → populates session list
3. User clicks session → `useEffect([activeSessionId])` → `GET /session/:id` → populates messages
4. User sends message → `POST /session/:id` with `{ message, providerId, modelId }` + header `directory`

**Key shared utilities**:
- `src/types/Home.ts` — `RecentProject` type (`{ path, name, openedAt }`)
- `src/utils/api.tsx` — `apiHeaders(activeProject)` builds `{ "Content-Type": "application/json", directory: path }`
- `src/components/Home.tsx` — exports `getRecentProjects()` (reads `localStorage["recentProjects"]`)

**Tauri folder picker** (`App.tsx`):
```ts
const { isTauri } = useTauri()
// if isTauri → openDialog({ directory: true }) from @tauri-apps/plugin-dialog
// else → window.prompt fallback for browser dev
```

---

## Desktop (`packages/desktop`)

Tauri 2 shell. `src-tauri/tauri.conf.json` points `devUrl` at `http://localhost:5173` and `frontendDist` at `../../ui/dist`.

Tauri plugins in use: `tauri-plugin-opener`, `tauri-plugin-dialog`.
Capability file: `src-tauri/capabilities/default.json` — add new permissions here.

When adding a new Tauri plugin:
1. Add to `Cargo.toml` under `[dependencies]`
2. Register `.plugin(tauri_plugin_xxx::init())` in `src/lib.rs`
3. Add permission (e.g. `"dialog:allow-open"`) to `capabilities/default.json`
4. Install JS counterpart: `bun add @tauri-apps/plugin-xxx` in `packages/ui`

---

## Code Conventions

- **New UI feature** → create it as a self-contained component in `src/components/`, import into the file that uses it. Do not inline large JSX into `App.tsx` or `ChatInterface.tsx`.
- **API call changes** → update `src/utils/api.tsx` (`apiHeaders`) rather than building headers inline.
- **Shared types** → go in `src/types/`. Currently: `Home.ts` for `RecentProject`.
- **Context** → `src/context/`. Use context for app-wide state (Tauri detection, model selection). Do not use context for page-level state.
- **Core route order matters** — `POST /sessions` must be matched before `POST /session` in `index.ts` (substring matching). Same applies to any new `/session*` routes.
- **No section separator comments** — do not use decorative dividers like `// ─── section name ───`. Function and variable names are sufficient to communicate structure.
- **Types in separate files** — define types/interfaces in a co-located `types/` folder (e.g. `src/types/llm.ts` for `src/llm.ts`). Import them into the implementation file. Do not define types inline in the main file.