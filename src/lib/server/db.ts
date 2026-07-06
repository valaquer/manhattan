import Database from 'better-sqlite3';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'manhattan.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// === Schema ===
db.exec(`
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		created_at TEXT DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL,
		turn_number INTEGER NOT NULL,
		sender TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);

	CREATE TABLE IF NOT EXISTS pipeline_outputs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL,
		turn_number INTEGER NOT NULL,
		stage TEXT NOT NULL,
		model TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);

	CREATE TABLE IF NOT EXISTS memory (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		content TEXT NOT NULL,
		turn_created INTEGER NOT NULL,
		turn_updated INTEGER NOT NULL,
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);
`);

// === Session Queries ===

export function createSession(): number {
	return db.prepare('INSERT INTO sessions DEFAULT VALUES').run().lastInsertRowid as number;
}

export function getOrCreateSession(): number {
	const row = db.prepare('SELECT id FROM sessions ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
	return row ? row.id : createSession();
}

export function getNextTurnNumber(sessionId: number): number {
	const row = db.prepare('SELECT MAX(turn_number) as max FROM messages WHERE session_id = ?').get(sessionId) as { max: number | null };
	return (row.max ?? 0) + 1;
}

// === Message Queries (UI chat) ===

export function saveMessage(sessionId: number, turnNumber: number, sender: string, content: string): number {
	return db.prepare('INSERT INTO messages (session_id, turn_number, sender, content) VALUES (?, ?, ?, ?)').run(sessionId, turnNumber, sender, content).lastInsertRowid as number;
}

export function getRecentMessages(sessionId: number, limit: number = 20): Array<{ sender: string; content: string; turn_number: number }> {
	return db.prepare('SELECT sender, content, turn_number FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?').all(sessionId, limit).reverse() as Array<{ sender: string; content: string; turn_number: number }>;
}

export function getAllMessages(sessionId: number): Array<{ sender: string; content: string; turn_number: number }> {
	return db.prepare('SELECT sender, content, turn_number FROM messages WHERE session_id = ? ORDER BY id').all(sessionId) as Array<{ sender: string; content: string; turn_number: number }>;
}

// === Pipeline Output Queries (forensic log) ===

export function savePipelineOutput(sessionId: number, turnNumber: number, stage: string, model: string, content: string): number {
	return db.prepare('INSERT INTO pipeline_outputs (session_id, turn_number, stage, model, content) VALUES (?, ?, ?, ?, ?)').run(sessionId, turnNumber, stage, model, content).lastInsertRowid as number;
}

// === Memory Queries (Cutter extractions — living state) ===

export function saveMemory(sessionId: number, type: string, content: string, turnNumber: number): number {
	return db.prepare('INSERT INTO memory (session_id, type, content, turn_created, turn_updated) VALUES (?, ?, ?, ?, ?)').run(sessionId, type, content, turnNumber, turnNumber).lastInsertRowid as number;
}

export function updateMemory(id: number, content: string, turnNumber: number): void {
	db.prepare('UPDATE memory SET content = ?, turn_updated = ? WHERE id = ?').run(content, turnNumber, id);
}

export function getMemory(sessionId: number): Array<{ id: number; type: string; content: string; turn_created: number; turn_updated: number }> {
	return db.prepare('SELECT id, type, content, turn_created, turn_updated FROM memory WHERE session_id = ? ORDER BY id').all(sessionId) as Array<{ id: number; type: string; content: string; turn_created: number; turn_updated: number }>;
}

export function getMemoryByType(sessionId: number, type: string): Array<{ id: number; content: string; turn_created: number; turn_updated: number }> {
	return db.prepare('SELECT id, content, turn_created, turn_updated FROM memory WHERE session_id = ? AND type = ? ORDER BY id').all(sessionId, type) as Array<{ id: number; content: string; turn_created: number; turn_updated: number }>;
}

// === Session Management ===

export function deleteSession(sessionId: number): void {
	db.prepare('DELETE FROM memory WHERE session_id = ?').run(sessionId);
	db.prepare('DELETE FROM pipeline_outputs WHERE session_id = ?').run(sessionId);
	db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
	db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export default db;
