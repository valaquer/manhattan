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
		config TEXT,
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
		prompt_tokens INTEGER,
		completion_tokens INTEGER,
		model_params TEXT,
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);

	CREATE TABLE IF NOT EXISTS klara_reviews (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL,
		turn_number INTEGER NOT NULL,
		stage TEXT NOT NULL,
		review TEXT NOT NULL,
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

// === Migrations for existing DBs ===
function migrateSchema() {
	const cols = db.prepare("PRAGMA table_info(pipeline_outputs)").all() as Array<{ name: string }>;
	const colNames = new Set(cols.map(c => c.name));
	if (!colNames.has('prompt_tokens')) db.exec('ALTER TABLE pipeline_outputs ADD COLUMN prompt_tokens INTEGER');
	if (!colNames.has('completion_tokens')) db.exec('ALTER TABLE pipeline_outputs ADD COLUMN completion_tokens INTEGER');
	if (!colNames.has('model_params')) db.exec('ALTER TABLE pipeline_outputs ADD COLUMN model_params TEXT');
	if (!colNames.has('attempt')) db.exec('ALTER TABLE pipeline_outputs ADD COLUMN attempt INTEGER DEFAULT 1');

	const memoryCols = db.prepare("PRAGMA table_info(memory)").all() as Array<{ name: string }>;
	const memoryColNames = new Set(memoryCols.map(c => c.name));
	if (!memoryColNames.has('attempt')) db.exec('ALTER TABLE memory ADD COLUMN attempt INTEGER DEFAULT 1');
	if (!memoryColNames.has('superseded')) db.exec("ALTER TABLE memory ADD COLUMN superseded INTEGER DEFAULT 0");

	const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
	const sessionColNames = new Set(sessionCols.map(c => c.name));
	if (!sessionColNames.has('config')) db.exec('ALTER TABLE sessions ADD COLUMN config TEXT');
}
migrateSchema();

// === Session Queries ===

export function createSession(config?: string): number {
	if (config) {
		return db.prepare('INSERT INTO sessions (config) VALUES (?)').run(config).lastInsertRowid as number;
	}
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

export function savePipelineOutput(
	sessionId: number, turnNumber: number, stage: string, model: string, content: string,
	promptTokens?: number, completionTokens?: number, modelParams?: string, attempt?: number,
	systemPrompt?: string, userContent?: string,
): number {
	return db.prepare(
		'INSERT INTO pipeline_outputs (session_id, turn_number, stage, model, content, prompt_tokens, completion_tokens, model_params, attempt, system_prompt, user_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	).run(sessionId, turnNumber, stage, model, content, promptTokens ?? null, completionTokens ?? null, modelParams ?? null, attempt ?? 1, systemPrompt ?? null, userContent ?? null).lastInsertRowid as number;
}

// === Memory Queries (Cutter extractions — living state) ===

export function saveMemory(sessionId: number, type: string, content: string, turnNumber: number): number {
	return db.prepare('INSERT INTO memory (session_id, type, content, turn_created, turn_updated) VALUES (?, ?, ?, ?, ?)').run(sessionId, type, content, turnNumber, turnNumber).lastInsertRowid as number;
}

export function updateMemory(id: number, content: string, turnNumber: number): void {
	db.prepare('UPDATE memory SET content = ?, turn_updated = ? WHERE id = ?').run(content, turnNumber, id);
}

export function supersedeMemoryForTurn(sessionId: number, turnNumber: number): void {
	db.prepare('UPDATE memory SET superseded = 1 WHERE session_id = ? AND turn_created = ?').run(sessionId, turnNumber);
}

export function updateMessageContent(sessionId: number, turnNumber: number, sender: string, content: string): void {
	db.prepare('UPDATE messages SET content = ? WHERE session_id = ? AND turn_number = ? AND sender = ?').run(content, sessionId, turnNumber, sender);
}

export function getMemory(sessionId: number): Array<{ id: number; type: string; content: string; turn_created: number; turn_updated: number }> {
	return db.prepare('SELECT id, type, content, turn_created, turn_updated FROM memory WHERE session_id = ? AND (superseded = 0 OR superseded IS NULL) ORDER BY id').all(sessionId) as Array<{ id: number; type: string; content: string; turn_created: number; turn_updated: number }>;
}

export function getMemoryByType(sessionId: number, type: string): Array<{ id: number; content: string; turn_created: number; turn_updated: number }> {
	return db.prepare('SELECT id, content, turn_created, turn_updated FROM memory WHERE session_id = ? AND type = ? AND (superseded = 0 OR superseded IS NULL) ORDER BY id').all(sessionId, type) as Array<{ id: number; content: string; turn_created: number; turn_updated: number }>;
}

// === Klara Review Queries ===

export function saveKlaraReview(sessionId: number, turnNumber: number, stage: string, review: string): number {
	return db.prepare('INSERT INTO klara_reviews (session_id, turn_number, stage, review) VALUES (?, ?, ?, ?)').run(sessionId, turnNumber, stage, review).lastInsertRowid as number;
}

export function getKlaraReviews(sessionId: number, turnNumber: number): Array<{ stage: string; review: string }> {
	return db.prepare('SELECT stage, review FROM klara_reviews WHERE session_id = ? AND turn_number = ? ORDER BY id').all(sessionId, turnNumber) as Array<{ stage: string; review: string }>;
}

// === Session Management ===

export function getAllSessions(): Array<{ id: number; created_at: string }> {
	return db.prepare('SELECT id, created_at FROM sessions ORDER BY id DESC').all() as Array<{ id: number; created_at: string }>;
}

export default db;
