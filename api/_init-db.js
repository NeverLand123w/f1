// api/_init-db.js — Vercel ignores files prefixed with _
// Call initDB() at the top of any function that needs the tables to exist.
const db = require('../db');

let initialized = false;

async function initDB() {
    if (initialized) return;
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT UNIQUE NOT NULL,
            password        TEXT NOT NULL,
            twoFactorSecret TEXT,
            is2faEnabled    BOOLEAN DEFAULT 0,
            tokens          REAL DEFAULT 5.0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS active_bets (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            username       TEXT NOT NULL,
            driver_name    TEXT NOT NULL,
            token_amount   REAL NOT NULL,
            window_penalty REAL DEFAULT 1.0,
            status         TEXT DEFAULT 'PENDING',
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    try { await db.execute("ALTER TABLE active_bets ADD COLUMN window_penalty REAL DEFAULT 1.0"); } catch (_) {}
    await db.execute(`
        CREATE TABLE IF NOT EXISTS fastest_lap_bets (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            username     TEXT NOT NULL,
            driver_name  TEXT NOT NULL,
            lap_number   INTEGER NOT NULL,
            token_amount REAL NOT NULL,
            status       TEXT DEFAULT 'PENDING',
            payout       REAL DEFAULT 0,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    initialized = true;
}

module.exports = { initDB };
