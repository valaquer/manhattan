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

	CREATE TABLE IF NOT EXISTS turns (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL,
		number INTEGER NOT NULL,
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);

	CREATE TABLE IF NOT EXISTS blocks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		turn_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		sender TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY (turn_id) REFERENCES turns(id)
	);
`);

// === Queries ===

export function createSession(): number {
	return db.prepare('INSERT INTO sessions DEFAULT VALUES').run().lastInsertRowid as number;
}

export function getOrCreateSession(): number {
	const row = db.prepare('SELECT id FROM sessions ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
	return row ? row.id : createSession();
}

export function createTurn(sessionId: number, number: number): number {
	return db.prepare('INSERT INTO turns (session_id, number) VALUES (?, ?)').run(sessionId, number).lastInsertRowid as number;
}

export function getNextTurnNumber(sessionId: number): number {
	const row = db.prepare('SELECT MAX(number) as max FROM turns WHERE session_id = ?').get(sessionId) as { max: number | null };
	return (row.max ?? 0) + 1;
}

export function saveBlock(turnId: number, type: string, sender: string, content: string): number {
	return db.prepare('INSERT INTO blocks (turn_id, type, sender, content) VALUES (?, ?, ?, ?)').run(turnId, type, sender, content).lastInsertRowid as number;
}

export function getTurns(sessionId: number): Array<{ number: number; blocks: Array<{ type: string; sender: string; content: string }> }> {
	const turns = db.prepare('SELECT id, number FROM turns WHERE session_id = ? ORDER BY number').all(sessionId) as Array<{ id: number; number: number }>;
	return turns.map((t) => {
		const blocks = db.prepare('SELECT type, sender, content FROM blocks WHERE turn_id = ? ORDER BY id').all(t.id) as Array<{ type: string; sender: string; content: string }>;
		return { number: t.number, blocks };
	});
}

export function deleteSession(sessionId: number): void {
	const turns = db.prepare('SELECT id FROM turns WHERE session_id = ?').all(sessionId) as Array<{ id: number }>;
	for (const t of turns) {
		db.prepare('DELETE FROM blocks WHERE turn_id = ?').run(t.id);
	}
	db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
	db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export default db;
