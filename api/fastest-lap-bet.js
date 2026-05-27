// api/fastest-lap-bet.js  →  POST /api/fastest-lap-bet
const jwt = require('jsonwebtoken');
const db  = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ message: 'Access denied.' });

    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        const { driverName, lapNumber, betAmount } = req.body;
        const amount = parseFloat(betAmount);

        if (!driverName || !lapNumber || isNaN(amount) || amount <= 0)
            return res.status(400).json({ message: 'Invalid fastest-lap bet parameters.' });

        const existing = await db.execute({
            sql:  "SELECT id FROM fastest_lap_bets WHERE username = ? AND lap_number = ? AND status = 'PENDING'",
            args: [decoded.username, lapNumber]
        });
        if (existing.rows.length > 0)
            return res.status(400).json({ message: `You already have a fastest-lap bet on lap ${lapNumber}.` });

        const userRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        const currentTokens = parseFloat(userRes.rows[0].tokens);
        if (currentTokens < amount)
            return res.status(400).json({ message: `Insufficient funds. You have ${currentTokens.toFixed(1)} tokens.` });

        await db.execute({ sql: 'UPDATE users SET tokens = tokens - ? WHERE username = ?', args: [amount, decoded.username] });
        await db.execute({
            sql:  'INSERT INTO fastest_lap_bets (username, driver_name, lap_number, token_amount) VALUES (?, ?, ?, ?)',
            args: [decoded.username, driverName, lapNumber, amount]
        });

        const newBal = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        res.json({ message: 'Fastest-lap bet locked!', newBalance: newBal.rows[0].tokens });
    } catch (err) {
        console.error('Fastest-lap bet error:', err);
        res.status(500).json({ message: 'Failed to place fastest-lap bet.' });
    }
};
