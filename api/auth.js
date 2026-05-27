// api/auth.js
// Handles: POST /api/register, POST /api/verify-registration-2fa,
//          POST /api/login,    POST /api/login-verify,  GET /api/me
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode  = require('qrcode');
const db      = require('../db');
require('dotenv').config();

const app = express();
app.use(express.json());

// ── DB INIT (runs once per cold-start) ─────────────────────────────────────
async function initDB() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            username         TEXT UNIQUE NOT NULL,
            password         TEXT NOT NULL,
            twoFactorSecret  TEXT,
            is2faEnabled     BOOLEAN DEFAULT 0,
            tokens           REAL DEFAULT 5.0,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Safe migration — ignore if column already exists
    try {
        await db.execute("ALTER TABLE active_bets ADD COLUMN window_penalty REAL DEFAULT 1.0");
    } catch (_) { /* already exists */ }

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
}
initDB().catch(console.error);

// ── REGISTER ────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: 'Username and password are required.' });

        const existing = await db.execute({
            sql: 'SELECT id FROM users WHERE username = ?',
            args: [username]
        });
        if (existing.rows.length > 0)
            return res.status(400).json({ message: 'Username already taken!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const secret = speakeasy.generateSecret({ name: `F1 Paddock (${username})` });

        await db.execute({
            sql: 'INSERT INTO users (username, password, twoFactorSecret) VALUES (?, ?, ?)',
            args: [username, hashedPassword, secret.base32]
        });

        qrcode.toDataURL(secret.otpauth_url, (err, qrImageData) => {
            if (err) return res.status(500).json({ message: 'QR generation failed.' });
            res.json({ message: 'Setup 2FA', username, qrImage: qrImageData });
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// ── VERIFY REGISTRATION 2FA ─────────────────────────────────────────────────
app.post('/api/verify-registration-2fa', async (req, res) => {
    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({
            sql: 'SELECT twoFactorSecret FROM users WHERE username = ?',
            args: [username]
        });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const verified = speakeasy.totp.verify({
            secret:   result.rows[0].twoFactorSecret,
            encoding: 'base32',
            token:    otpCode,
            window:   1
        });
        if (!verified)
            return res.status(400).json({ message: 'Invalid Authenticator Code!' });

        await db.execute({
            sql:  'UPDATE users SET is2faEnabled = 1 WHERE username = ?',
            args: [username]
        });
        res.json({ message: '2FA Secure! You can now log in.' });
    } catch (err) {
        console.error('Verify 2FA error:', err);
        res.status(500).json({ message: 'Error verifying 2FA.' });
    }
});

// ── LOGIN (step 1 — password check) ─────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await db.execute({
            sql: 'SELECT * FROM users WHERE username = ?',
            args: [username]
        });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const isMatch = await bcrypt.compare(password, result.rows[0].password);
        if (!isMatch)
            return res.status(400).json({ message: 'Wrong password.' });

        res.json({ message: 'Require 2FA', username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Error logging in.' });
    }
});

// ── LOGIN VERIFY (step 2 — OTP) ─────────────────────────────────────────────
app.post('/api/login-verify', async (req, res) => {
    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({
            sql: 'SELECT * FROM users WHERE username = ?',
            args: [username]
        });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const user = result.rows[0];
        const verified = speakeasy.totp.verify({
            secret:   user.twoFactorSecret,
            encoding: 'base32',
            token:    otpCode,
            window:   1
        });
        if (!verified)
            return res.status(400).json({ message: 'Invalid Authenticator Code.' });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET
        );
        res.json({ token, tokens: user.tokens, username: user.username });
    } catch (err) {
        console.error('Login-verify error:', err);
        res.status(500).json({ message: 'Error in 2FA.' });
    }
});

// ── ME (get current user + active bets) ─────────────────────────────────────
app.get('/api/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token.' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);

        const userRes = await db.execute({
            sql:  'SELECT username, tokens FROM users WHERE id = ?',
            args: [decoded.id]
        });
        if (userRes.rows.length === 0)
            return res.status(404).json({ message: 'User not found.' });

        const betsRes = await db.execute({
            sql:  "SELECT driver_name, token_amount FROM active_bets WHERE username = ? AND status = 'PENDING'",
            args: [decoded.username]
        });

        res.json({
            username:   userRes.rows[0].username,
            tokens:     userRes.rows[0].tokens,
            activeBets: betsRes.rows
        });
    } catch (err) {
        res.status(401).json({ message: 'Invalid token.' });
    }
});

module.exports = app;
