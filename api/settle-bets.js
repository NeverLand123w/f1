// api/settle-bets.js  →  POST /api/settle-bets
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
        const { raceResults } = req.body;

        if (!Array.isArray(raceResults))
            return res.status(400).json({ message: 'raceResults must be an array.' });

        const betsReq = await db.execute({
            sql:  "SELECT * FROM active_bets WHERE username = ? AND status = 'PENDING'",
            args: [decoded.username]
        });

        let totalWinnings = 0;
        const betResults  = [];

        for (const bet of betsReq.rows) {
            const betAmount    = parseFloat(bet.token_amount);
            const driverResult = raceResults.find(d => d.driverName === bet.driver_name);
            const pos          = driverResult ? driverResult.pos : 22;

            const multiplier =
                pos === 1 ? 2.0 :
                pos === 2 ? 1.5 :
                pos === 3 ? 1.2 :
                pos <= 5  ? 1.0 :
                pos <= 8  ? 0.5 : 0;

            const payout = betAmount * multiplier * (parseFloat(bet.window_penalty) || 1.0);
            totalWinnings += payout;

            await db.execute({
                sql:  "UPDATE active_bets SET status = ? WHERE id = ?",
                args: [payout > 0 ? 'WON' : 'LOST', bet.id]
            });
            betResults.push({ driver: bet.driver_name, pos, betted: betAmount, won: payout });
        }

        if (totalWinnings > 0) {
            await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [totalWinnings, decoded.username] });
        }

        const balanceRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        res.json({ message: 'Bets settled!', winnings: totalWinnings, newBalance: balanceRes.rows[0].tokens, details: betResults });
    } catch (err) {
        console.error('Settle bets error:', err);
        res.status(500).json({ message: 'Failed to settle bets.' });
    }
};
