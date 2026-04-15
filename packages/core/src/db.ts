import { Database } from 'bun:sqlite'

// Initialize SQLite database
const db = new Database('code_agent.db')

// Create tables if they don't exist
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)

export const DB = db

// Session management
export function createSession(sessionId: string) {
  const now = Date.now()
  db.run(
    'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)',
    [sessionId, now, now, 'active']
  )
}

export function saveMessage(sessionId: string, messageId: string, role: string, content: string) {
  const now = Date.now()
  db.run(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [messageId, sessionId, role, content, now]
  )
  
  // Update session timestamp
  db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, sessionId])
}

export function getSessionMessages(sessionId: string) {
  return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Array<{
      id: string
      session_id: string
      role: string
      content: string
      created_at: number
    }>
}

export function saveToolCall(sessionId: string, toolId: string, name: string, input: string, output: string | null = null, status: string = 'pending') {
  const now = Date.now()
  db.run(
    'INSERT INTO tools (id, session_id, name, input, output, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [toolId, sessionId, name, input, output, status, now]
  )
}

export function updateToolOutput(toolId: string, output: string, status: string = 'completed') {
  db.run(
    'UPDATE tools SET output = ?, status = ? WHERE id = ?',
    [output, status, toolId]
  )
}

export function getSessionTools(sessionId: string) {
  return db.prepare('SELECT * FROM tools WHERE session_id = ? ORDER BY created_at ASC')
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