// api/razorpay.js
// Handles: POST /api/razorpay/create-order,  POST /api/razorpay/verify-payment
const express  = require('express');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const db       = require('../db');
require('dotenv').config();

const app = express();
app.use(express.json());

function decodeToken(req) {
    const header = req.headers.authorization;
    if (!header) throw new Error('NO_TOKEN');
    return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
}

// ── CREATE RAZORPAY ORDER ────────────────────────────────────────────────────
// Body: { tokens: number, price: number (INR) }
app.post('/api/razorpay/create-order', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const { tokens, price } = req.body;

        if (!tokens || !price)
            return res.status(400).json({ message: 'Missing tokens or price parameter.' });

        // Dev-mode fallback: if Razorpay keys aren't configured, credit directly
        const keyId     = process.env.RAZORPAY_KEY_ID     || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

        if (!keyId || keyId === 'dummy_id') {
            console.warn('⚠️  Razorpay keys not set — dev-mode direct credit');
            await db.execute({
                sql:  'UPDATE users SET tokens = tokens + ? WHERE username = ?',
                args: [tokens, decoded.username]
            });
            const bal = await db.execute({
                sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username]
            });
            return res.json({ devCredit: true, newBalance: bal.rows[0].tokens });
        }

        const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

        const amountInPaise = Math.round(parseFloat(price) * 100);
        const order = await rzp.orders.create({
            amount:   amountInPaise,
            currency: 'INR',
            receipt:  `tkn_${Date.now()}`
        });

        res.json({
            orderId:     order.id,
            amount:      order.amount,
            currency:    order.currency,
            razorpayKey: keyId
        });
    } catch (err) {
        if (err.message === 'NO_TOKEN') return res.status(401).json({ message: 'Access denied.' });
        console.error('Razorpay create-order error:', err);
        res.status(500).json({ message: 'Could not create order.' });
    }
});

// ── VERIFY PAYMENT & CREDIT TOKENS ──────────────────────────────────────────
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, purchasedTokens }
app.post('/api/razorpay/verify-payment', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            purchasedTokens
        } = req.body;

        // Cryptographic signature check — prevents spoofed payments
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSig = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSig !== razorpay_signature)
            return res.status(400).json({ message: 'Payment signature mismatch! Transaction unauthorized.' });

        await db.execute({
            sql:  'UPDATE users SET tokens = tokens + ? WHERE username = ?',
            args: [purchasedTokens, decoded.username]
        });
        const bal = await db.execute({
            sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username]
        });

        res.json({ message: 'Tokens credited successfully!', newBalance: bal.rows[0].tokens });
    } catch (err) {
        if (err.message === 'NO_TOKEN') return res.status(401).json({ message: 'Access denied.' });
        console.error('Razorpay verify-payment error:', err);
        res.status(500).json({ message: 'Payment verification failed.' });
    }
});

module.exports = app;
