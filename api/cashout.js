// api/cashout.js  →  POST /api/cashout
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
        const { driverName, returnAmount } = req.body;
        const cashoutAmt = parseFloat(returnAmount);

        if (!driverName || isNaN(cashoutAmt) || cashoutAmt < 0)
            return res.status(400).json({ message: 'Invalid cashout request.' });

        const betRes = await db.execute({
            sql:  "SELECT * FROM active_bets WHERE username = ? AND driver_name = ? AND status = 'PENDING'",
            args: [decoded.username, driverName]
        });
        if (betRes.rows.length === 0)
            return res.status(404).json({ message: 'No active bet found for this driver.' });

        await db.execute({ sql: "UPDATE active_bets SET status = 'CASHED_OUT' WHERE id = ?", args: [betRes.rows[0].id] });
        await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [cashoutAmt, decoded.username] });

        const balRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        res.json({ message: 'Cashout successful!', newBalance: balRes.rows[0].tokens, cashedOut: cashoutAmt });
    } catch (err) {
        console.error('Cashout error:', err);
        res.status(500).json({ message: 'Cashout failed.' });
    }
};
