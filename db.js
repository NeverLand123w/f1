// db.js
const { createClient } = require('@libsql/client');
const dotenv = require('dotenv');
dotenv.config();

// Create the Turso connection
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

module.exports = db;


