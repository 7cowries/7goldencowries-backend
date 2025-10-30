require('dotenv').config();
const express = require('express');

let helmet = null;
try { helmet = require('helmet'); } catch (_) {}

const corsMW   = require('./api/cors');
const apiStubs = require('./api/stubs');

const app = express();
if (typeof express.json === 'function') app.use(express.json());
if (helmet) app.use(helmet({ contentSecurityPolicy: false }));
app.use(corsMW);

// ---- stub routes (safe to keep until real routes are ready)
if (typeof apiStubs === 'function') apiStubs(app);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on ${PORT}`));
