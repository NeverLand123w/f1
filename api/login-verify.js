// api/login-verify.js  →  POST /api/login-verify
const jwt       = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const db        = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0) return res.status(400).json({ message: 'User not found.' });

        const user = result.rows[0];
        const verified = speakeasy.totp.verify({
            secret: (user.twoFactorSecret || '').trim(), encoding: 'base32', token: otpCode.trim(), window: 2
        });
        if (!verified) return res.status(400).json({ message: 'Invalid Authenticator Code.' });

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
        res.json({ token, tokens: user.tokens, username: user.username });
    } catch (err) {
        console.error('Login-verify error:', err);
        res.status(500).json({ message: 'Error in 2FA.' });
    }
};
