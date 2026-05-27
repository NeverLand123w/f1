// api/settle-fastest-lap.js  →  POST /api/settle-fastest-lap
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
        jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); // auth check
        const { lapNumber, fastestLapDriver } = req.body;

        if (!lapNumber || !fastestLapDriver)
            return res.status(400).json({ message: 'lapNumber and fastestLapDriver are required.' });

        const betsRes = await db.execute({
            sql:  "SELECT * FROM fastest_lap_bets WHERE lap_number = ? AND status = 'PENDING'",
            args: [lapNumber]
        });

        const results = [];
        for (const bet of betsRes.rows) {
            const won    = bet.driver_name === fastestLapDriver;
            const payout = won ? parseFloat(bet.token_amount) * 1.5 : 0;

            await db.execute({
                sql:  'UPDATE fastest_lap_bets SET status = ?, payout = ? WHERE id = ?',
                args: [won ? 'WON' : 'LOST', payout, bet.id]
            });
            if (won) {
                await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [payout, bet.username] });
            }
            results.push({ username: bet.username, driver: bet.driver_name, won, payout });
        }

        res.json({ message: `Lap ${lapNumber} fastest-lap bets settled.`, fastestLapDriver, results });
    } catch (err) {
        console.error('Settle fastest-lap error:', err);
        res.status(500).json({ message: 'Failed to settle fastest-lap bets.' });
    }
};
