// api/_lib.js  — shared helpers (Vercel ignores files starting with _)
const jwt = require('jsonwebtoken');

function decodeToken(req) {
    const header = req.headers.authorization;
    if (!header) throw new Error('NO_TOKEN');
    return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
}

module.exports = { decodeToken };
