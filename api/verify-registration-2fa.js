// api/verify-registration-2fa.js  →  POST /api/verify-registration-2fa
const speakeasy = require('speakeasy');
const db        = require('../db');
require('dotenv').config();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({ sql: 'SELECT twoFactorSecret FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0) return res.status(400).json({ message: 'User not found.' });

        const verified = speakeasy.totp.verify({
            secret: (result.rows[0].twoFactorSecret || '').trim(), encoding: 'base32', token: otpCode.trim(), window: 2
        });
        if (!verified) return res.status(400).json({ message: 'Invalid Authenticator Code!' });

        await db.execute({ sql: 'UPDATE users SET is2faEnabled = 1 WHERE username = ?', args: [username] });
        res.json({ message: '2FA Secure! You can now log in.' });
    } catch (err) {
        console.error('Verify 2FA error:', err);
        res.status(500).json({ message: 'Error verifying 2FA.' });
    }
};
