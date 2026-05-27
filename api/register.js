// api/register.js  →  POST /api/register
const bcrypt    = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode    = require('qrcode');
const db        = require('../db');
const { initDB } = require('./_init-db');
require('dotenv').config();

module.exports = async (req, res) => {
    await initDB();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: 'Username and password are required.' });

        const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
        if (existing.rows.length > 0)
            return res.status(400).json({ message: 'Username already taken!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const secret = speakeasy.generateSecret({ name: `F1 Paddock (${username})` });

        await db.execute({
            sql:  'INSERT INTO users (username, password, twoFactorSecret) VALUES (?, ?, ?)',
            args: [username, hashedPassword, secret.base32]
        });

        const qrImageData = await qrcode.toDataURL(secret.otpauth_url);
        res.json({ message: 'Setup 2FA', username, qrImage: qrImageData });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error during registration.' });
    }
};
