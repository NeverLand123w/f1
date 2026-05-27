// api/me.js  →  GET /api/me
const jwt = require('jsonwebtoken');
const db  = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ message: 'No token.' });

    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);

        const userRes = await db.execute({ sql: 'SELECT username, tokens FROM users WHERE id = ?', args: [decoded.id] });
        if (userRes.rows.length === 0) return res.status(404).json({ message: 'User not found.' });

        const betsRes = await db.execute({
            sql:  "SELECT driver_name, token_amount FROM active_bets WHERE username = ? AND status = 'PENDING'",
            args: [decoded.username]
        });

        res.json({ username: userRes.rows[0].username, tokens: userRes.rows[0].tokens, activeBets: betsRes.rows });
    } catch (err) {
        res.status(401).json({ message: 'Invalid token.' });
    }
};
