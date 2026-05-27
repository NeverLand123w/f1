// api/fastest-lap-bets.js  →  GET /api/fastest-lap-bets
const jwt = require('jsonwebtoken');
const db  = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ message: 'Access denied.' });

    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        const result  = await db.execute({
            sql:  'SELECT * FROM fastest_lap_bets WHERE username = ? ORDER BY created_at DESC',
            args: [decoded.username]
        });
        res.json({ bets: result.rows });
    } catch (err) {
        console.error('Get fastest-lap bets error:', err);
        res.status(500).json({ message: 'Failed to fetch fastest-lap bets.' });
    }
};
