// api/bet.js  →  POST /api/bet
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
        const { driverName, betAmount, windowPenalty } = req.body;
        const amount  = parseFloat(betAmount);
        const penalty = parseFloat(windowPenalty) || 1.0;

        if (!driverName || isNaN(amount) || amount <= 0)
            return res.status(400).json({ message: 'Invalid bet parameters.' });

        const existingBet = await db.execute({
            sql:  "SELECT id FROM active_bets WHERE username = ? AND driver_name = ? AND status = 'PENDING'",
            args: [decoded.username, driverName]
        });
        if (existingBet.rows.length > 0)
            return res.status(400).json({ message: `You already have a pending bet on ${driverName}.` });

        const userRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        const currentTokens = parseFloat(userRes.rows[0].tokens);
        if (currentTokens < amount)
            return res.status(400).json({ message: `Insufficient funds. You have ${currentTokens.toFixed(1)} tokens.` });

        await db.execute({ sql: 'UPDATE users SET tokens = tokens - ? WHERE username = ?', args: [amount, decoded.username] });
        await db.execute({
            sql:  'INSERT INTO active_bets (username, driver_name, token_amount, window_penalty) VALUES (?, ?, ?, ?)',
            args: [decoded.username, driverName, amount, penalty]
        });

        res.json({ message: 'Bet confirmed!', newBalance: currentTokens - amount });
    } catch (err) {
        console.error('Bet error:', err);
        res.status(500).json({ message: 'Failed to process bet.' });
    }
};
