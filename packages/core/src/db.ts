import { Database } from 'bun:sqlite'

const db = new Database('code_agent.db')

// ─── Schema ───────────────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,
    directory   TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    status      TEXT    NOT NULL
  )
`)

// Safe migration for databases created before the directory column existed
try { db.run('ALTER TABLE sessions ADD COLUMN directory TEXT') } catch { /* already exists */ }

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT    PRIMARY KEY,
    session_id  TEXT    NOT NULL,
    role        TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS tools (
    id          TEXT    PRIMARY KEY,
    session_id  TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    input       TEXT    NOT NULL,
    output      TEXT,
    status      TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS parts (
    id          TEXT    PRIMARY KEY,
    message_id  TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    data        JSON    NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)

export const DB = db

// ─── Session ──────────────────────────────────────────────────────────────────

export function createSession(sessionId: string, directory: string) {
  const now = Date.now()
  db.run(
    'INSERT INTO sessions (id, directory, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?)',
    [sessionId, directory, now, now, 'active']
  )
}

export interface SessionRow {
  id: string
  directory: string | null
  created_at: number
  updated_at: number
  status: string
}

export function getSessionsByDirectory(directory: string): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions WHERE directory = ? ORDER BY updated_at DESC')
    .all(directory) as SessionRow[]
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function saveMessage(
  sessionId: string,
  messageId: string,
  role: string,
  content: string
) {
  const now = Date.now()
  db.run(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [messageId, sessionId, role, content, now]
  )
  db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, sessionId])
}

export function getSessionMessages(sessionId: string) {
  return db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Array<{
      id: string
      session_id: string
      role: string
      content: string
      created_at: number
    }>
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export function saveToolCall(
  sessionId: string,
  toolId: string,
  name: string,
  input: string,
  output: string | null = null,
  status: string = 'pending'
) {
  const now = Date.now()
  db.run(
    'INSERT INTO tools (id, session_id, name, input, output, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [toolId, sessionId, name, input, output, status, now]
  )
}

export function updateToolOutput(toolId: string, output: string, status: string = 'completed') {
  db.run('UPDATE tools SET output = ?, status = ? WHERE id = ?', [output, status, toolId])
}

export function getSessionTools(sessionId: string) {
  return db
    .prepare('SELECT * FROM tools WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Array<{
      id: string
      session_id: string
      name: string
      input: string
      output: string | null
      status: string
      created_at: number
    }>
}

// ─── Parts ────────────────────────────────────────────────────────────────────

export type TextPart = {
  type: 'text'
  content: string
}

export type ToolCallPart = {
  type: 'tool_call'
  tool_id: string
  tool_name: string
  args: Record<string, unknown>
  result?: string
  summary?: string
  model?: string
  tokens?: { input: number; output: number }
}

export type PartData = TextPart | ToolCallPart

export interface PartRow {
  id: string
  message_id: string
  session_id: string
  data: string
  created_at: number
}

export function savePart(
  partId: string,
  messageId: string,
  sessionId: string,
  data: PartData
): void {
  db.run(
    'INSERT INTO parts (id, message_id, session_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
    [partId, messageId, sessionId, JSON.stringify(data), Date.now()]
  )
}

export function updatePartData(partId: string, data: Partial<PartData> & { type: PartData['type'] }): void {
  const existing = db.prepare('SELECT data FROM parts WHERE id = ?').get(partId) as { data: string } | undefined
  if (!existing) return
  const merged = { ...JSON.parse(existing.data), ...data }
  db.run('UPDATE parts SET data = ? WHERE id = ?', [JSON.stringify(merged), partId])
}

export function getMessageParts(messageId: string): PartRow[] {
  return db
    .prepare('SELECT * FROM parts WHERE message_id = ? ORDER BY created_at ASC')
    .all(messageId) as PartRow[]
}

export function updateMessageContent(messageId: string, content: string): void {
  db.run('UPDATE messages SET content = ? WHERE id = ?', [content, messageId])
}

export function getLastMessages(
  sessionId: string,
  excludeId: string
): Array<{ role: string; content: string }> {
  const rows = db
    .prepare(
      "SELECT id, role, content FROM messages WHERE session_id = ? AND id != ? AND TRIM(content) != '' ORDER BY created_at DESC LIMIT 30"
    )
    .all(sessionId, excludeId) as Array<{ id: string; role: string; content: string }>

  return rows
    .reverse()
    .map(r => ({ role: r.role, content: r.content }))
}
