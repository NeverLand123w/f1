// api/login.js  →  POST /api/login
const bcrypt = require('bcryptjs');
const db     = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const { username, password } = req.body;
        const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0) return res.status(400).json({ message: 'User not found.' });

        const isMatch = await bcrypt.compare(password, result.rows[0].password);
        if (!isMatch) return res.status(400).json({ message: 'Wrong password.' });

        res.json({ message: 'Require 2FA', username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Error logging in.' });
    }
};
