// api/index.js
require('dotenv').config(); // ← must be first

const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode    = require('qrcode');
const crypto    = require('crypto');
const Razorpay  = require('razorpay');
const path      = require('path');
const db        = require('../db');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use((req, res, next) => {
    if (req.path.endsWith('.css')) res.type('text/css');
    next();
});

app.get('/api/debug-path', (req, res) => {
    const fs = require('fs');
    const publicPath = path.join(__dirname, '../public');
    res.json({
        __dirname,
        publicPath,
        exists: fs.existsSync(publicPath),
        files: fs.existsSync(publicPath) ? fs.readdirSync(publicPath) : []
    });
});

// ── LIBSQL ROW HELPERS ───────────────────────────────────────────────────────
// @libsql/client returns rows as arrays, not plain objects.
// These helpers map column names to values.
function rowToObj(result, index = 0) {
    const row = result.rows[index];
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
}

function rowsToObjs(result) {
    return result.rows.map(row => {
        const obj = {};
        result.columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

// ── DB INIT ──────────────────────────────────────────────────────────────────
let dbInitialized = false;
async function initDB() {
    if (dbInitialized) return;
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        username         TEXT UNIQUE NOT NULL,
        password         TEXT NOT NULL,
        twoFactorSecret  TEXT,
        is2faEnabled     BOOLEAN DEFAULT 0,
        tokens           REAL DEFAULT 5.0,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS active_bets (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        username       TEXT NOT NULL,
        driver_name    TEXT NOT NULL,
        token_amount   REAL NOT NULL,
        window_penalty REAL DEFAULT 1.0,
        status         TEXT DEFAULT 'PENDING',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    try { await db.execute("ALTER TABLE active_bets ADD COLUMN window_penalty REAL DEFAULT 1.0"); } catch (_) {}
    await db.execute(`CREATE TABLE IF NOT EXISTS fastest_lap_bets (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT NOT NULL,
        driver_name  TEXT NOT NULL,
        lap_number   INTEGER NOT NULL,
        token_amount REAL NOT NULL,
        status       TEXT DEFAULT 'PENDING',
        payout       REAL DEFAULT 0,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    dbInitialized = true;
}
initDB().catch(console.error);

// ── AUTH HELPER ──────────────────────────────────────────────────────────────
function decodeToken(req) {
    const header = req.headers.authorization;
    if (!header) throw new Error('NO_TOKEN');
    return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
}

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
    res.json({ status: 'Online', message: 'F1 Bet API is running!', timestamp: new Date().toISOString() });
});

// ── REGISTER ─────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: 'Username and password are required.' });

        const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
        if (existing.rows.length > 0)
            return res.status(400).json({ message: 'Username already taken!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const secret = speakeasy.generateSecret({ name: `F1 Paddock (${username})` });

        await db.execute({
            sql:  'INSERT INTO users (username, password, twoFactorSecret) VALUES (?, ?, ?)',
            args: [username, hashedPassword, secret.base32]
        });

        qrcode.toDataURL(secret.otpauth_url, (err, qrImageData) => {
            if (err) return res.status(500).json({ message: 'QR generation failed.' });
            res.json({ message: 'Setup 2FA', username, qrImage: qrImageData });
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// ── VERIFY REGISTRATION 2FA ──────────────────────────────────────────────────
app.post('/api/verify-registration-2fa', async (req, res) => {
    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({ sql: 'SELECT twoFactorSecret FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const { twoFactorSecret } = rowToObj(result);
        const verified = speakeasy.totp.verify({
            secret: twoFactorSecret, encoding: 'base32', token: otpCode, window: 1
        });
        if (!verified)
            return res.status(400).json({ message: 'Invalid Authenticator Code!' });

        await db.execute({ sql: 'UPDATE users SET is2faEnabled = 1 WHERE username = ?', args: [username] });
        res.json({ message: '2FA Secure! You can now log in.' });
    } catch (err) {
        console.error('Verify 2FA error:', err);
        res.status(500).json({ message: 'Error verifying 2FA.' });
    }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: 'Username and password are required.' });

        const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const user = rowToObj(result);
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return res.status(400).json({ message: 'Wrong password.' });

        res.json({ message: 'Require 2FA', username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Error logging in.' });
    }
});

// ── LOGIN VERIFY ──────────────────────────────────────────────────────────────
app.post('/api/login-verify', async (req, res) => {
    try {
        const { username, otpCode } = req.body;
        const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
        if (result.rows.length === 0)
            return res.status(400).json({ message: 'User not found.' });

        const user = rowToObj(result);
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret, encoding: 'base32', token: otpCode, window: 1
        });
        if (!verified)
            return res.status(400).json({ message: 'Invalid Authenticator Code.' });

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
        res.json({ token, tokens: user.tokens, username: user.username });
    } catch (err) {
        console.error('Login-verify error:', err);
        res.status(500).json({ message: 'Error in 2FA.' });
    }
});

// ── ME ────────────────────────────────────────────────────────────────────────
app.get('/api/me', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const userRes = await db.execute({ sql: 'SELECT username, tokens FROM users WHERE id = ?', args: [decoded.id] });
        if (userRes.rows.length === 0)
            return res.status(404).json({ message: 'User not found.' });

        const user = rowToObj(userRes);
        const betsRes = await db.execute({
            sql:  "SELECT driver_name, token_amount FROM active_bets WHERE username = ? AND status = 'PENDING'",
            args: [decoded.username]
        });
        res.json({ username: user.username, tokens: user.tokens, activeBets: rowsToObjs(betsRes) });
    } catch (err) {
        res.status(401).json({ message: 'Invalid token.' });
    }
});

// ── BET ───────────────────────────────────────────────────────────────────────
app.post('/api/bet', async (req, res) => {
    try {
        const decoded = decodeToken(req);
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
        const { tokens } = rowToObj(userRes);
        const currentTokens = parseFloat(tokens);
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
});

// ── CASHOUT ───────────────────────────────────────────────────────────────────
app.post('/api/cashout', async (req, res) => {
    try {
        const decoded = decodeToken(req);
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

        const bet = rowToObj(betRes);
        await db.execute({ sql: "UPDATE active_bets SET status = 'CASHED_OUT' WHERE id = ?", args: [bet.id] });
        await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [cashoutAmt, decoded.username] });

        const balRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        const { tokens } = rowToObj(balRes);
        res.json({ message: 'Cashout successful!', newBalance: tokens, cashedOut: cashoutAmt });
    } catch (err) {
        console.error('Cashout error:', err);
        res.status(500).json({ message: 'Cashout failed.' });
    }
});

// ── RAZORPAY CREATE ORDER ─────────────────────────────────────────────────────
app.post('/api/razorpay-create-order', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const { tokens, price } = req.body;

        if (!tokens || !price)
            return res.status(400).json({ message: 'Missing tokens or price parameter.' });

        const keyId     = process.env.RAZORPAY_KEY_ID     || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

        if (!keyId || keyId === 'dummy_id') {
            await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [tokens, decoded.username] });
            const bal = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
            return res.json({ devCredit: true, newBalance: rowToObj(bal).tokens });
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
});

// ── RAZORPAY VERIFY PAYMENT ───────────────────────────────────────────────────
app.post('/api/razorpay-verify-payment', async (req, res) => {
    try {
        const decoded = decodeToken(req);
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
        res.json({ message: 'Tokens credited successfully!', newBalance: rowToObj(bal).tokens });
    } catch (err) {
        console.error('Razorpay verify error:', err);
        res.status(500).json({ message: 'Payment verification failed.' });
    }
});

// ── FASTEST LAP BET ───────────────────────────────────────────────────────────
app.post('/api/fastest-lap-bet', async (req, res) => {
    try {
        const decoded = decodeToken(req);
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
        const currentTokens = parseFloat(rowToObj(userRes).tokens);
        if (currentTokens < amount)
            return res.status(400).json({ message: `Insufficient funds. You have ${currentTokens.toFixed(1)} tokens.` });

        await db.execute({ sql: 'UPDATE users SET tokens = tokens - ? WHERE username = ?', args: [amount, decoded.username] });
        await db.execute({
            sql:  'INSERT INTO fastest_lap_bets (username, driver_name, lap_number, token_amount) VALUES (?, ?, ?, ?)',
            args: [decoded.username, driverName, lapNumber, amount]
        });

        const newBal = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        res.json({ message: 'Fastest-lap bet locked!', newBalance: rowToObj(newBal).tokens });
    } catch (err) {
        console.error('Fastest-lap bet error:', err);
        res.status(500).json({ message: 'Failed to place fastest-lap bet.' });
    }
});

// ── GET FASTEST LAP BETS ──────────────────────────────────────────────────────
app.get('/api/fastest-lap-bets', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const result  = await db.execute({
            sql:  'SELECT * FROM fastest_lap_bets WHERE username = ? ORDER BY created_at DESC',
            args: [decoded.username]
        });
        res.json({ bets: rowsToObjs(result) });
    } catch (err) {
        console.error('Get fastest-lap bets error:', err);
        res.status(500).json({ message: 'Failed to fetch fastest-lap bets.' });
    }
});

// ── SETTLE BETS ───────────────────────────────────────────────────────────────
app.post('/api/settle-bets', async (req, res) => {
    try {
        const decoded = decodeToken(req);
        const { raceResults } = req.body;

        if (!Array.isArray(raceResults))
            return res.status(400).json({ message: 'raceResults must be an array.' });

        const betsReq = await db.execute({
            sql:  "SELECT * FROM active_bets WHERE username = ? AND status = 'PENDING'",
            args: [decoded.username]
        });

        let totalWinnings = 0;
        const betResults  = [];

        for (const bet of rowsToObjs(betsReq)) {
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

        if (totalWinnings > 0)
            await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [totalWinnings, decoded.username] });

        const balanceRes = await db.execute({ sql: 'SELECT tokens FROM users WHERE username = ?', args: [decoded.username] });
        res.json({ message: 'Bets settled!', winnings: totalWinnings, newBalance: rowToObj(balanceRes).tokens, details: betResults });
    } catch (err) {
        console.error('Settle bets error:', err);
        res.status(500).json({ message: 'Failed to settle bets.' });
    }
});

// ── SETTLE FASTEST LAP ────────────────────────────────────────────────────────
app.post('/api/settle-fastest-lap', async (req, res) => {
    try {
        decodeToken(req);
        const { lapNumber, fastestLapDriver } = req.body;

        if (!lapNumber || !fastestLapDriver)
            return res.status(400).json({ message: 'lapNumber and fastestLapDriver are required.' });

        const betsRes = await db.execute({
            sql:  "SELECT * FROM fastest_lap_bets WHERE lap_number = ? AND status = 'PENDING'",
            args: [lapNumber]
        });

        const results = [];
        for (const bet of rowsToObjs(betsRes)) {
            const won    = bet.driver_name === fastestLapDriver;
            const payout = won ? parseFloat(bet.token_amount) * 1.5 : 0;

            await db.execute({
                sql:  'UPDATE fastest_lap_bets SET status = ?, payout = ? WHERE id = ?',
                args: [won ? 'WON' : 'LOST', payout, bet.id]
            });
            if (won)
                await db.execute({ sql: 'UPDATE users SET tokens = tokens + ? WHERE username = ?', args: [payout, bet.username] });

            results.push({ username: bet.username, driver: bet.driver_name, won, payout });
        }

        res.json({ message: `Lap ${lapNumber} fastest-lap bets settled.`, fastestLapDriver, results });
    } catch (err) {
        console.error('Settle fastest-lap error:', err);
        res.status(500).json({ message: 'Failed to settle fastest-lap bets.' });
    }
});

// ── STATIC + FALLBACK ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── START SERVER ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
