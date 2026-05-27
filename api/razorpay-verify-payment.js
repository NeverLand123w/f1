// api/razorpay-verify-payment.js  →  POST /api/razorpay-verify-payment
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');
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
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, purchasedTokens } = req.body;

        const body        = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSig = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSig !== razorpay_signature)
            return res.status(400).json({ message: 'Payment signature mismatch! Transaction unauthorized.' });

        await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [purchasedTokens, decoded.username] });
        const bal = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });

        res.json({ message: 'Tokens credited successfully!', newBalance: bal.rows[0].tokens });
    } catch (err) {
        console.error('Razorpay verify error:', err);
        res.status(500).json({ message: 'Payment verification failed.' });
    }
};
