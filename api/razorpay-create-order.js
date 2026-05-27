// api/razorpay-create-order.js  →  POST /api/razorpay-create-order
const jwt      = require('jsonwebtoken');
const Razorpay = require('razorpay');
const db       = require('../db');
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
        const { tokens, price } = req.body;

        if (!tokens || !price)
            return res.status(400).json({ message: 'Missing tokens or price parameter.' });

        const keyId     = process.env.RAZORPAY_KEY_ID     || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

        // Dev-mode fallback
        if (!keyId || keyId === 'dummy_id') {
            await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [tokens, decoded.username] });
            const bal = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
            return res.json({ devCredit: true, newBalance: bal.rows[0].tokens });
        }

        const rzp   = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const order = await rzp.orders.create({
            amount:   Math.round(parseFloat(price) * 100),
            currency: 'INR',
            receipt:  `tkn_${Date.now()}`
        });

        res.json({ orderId: order.id, amount: order.amount, currency: order.currency, razorpayKey: keyId });
    } catch (err) {
        console.error('Razorpay create-order error:', err);
        res.status(500).json({ message: 'Could not create order.' });
    }
};
