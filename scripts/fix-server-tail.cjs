const fs = require('fs');

const FILE = 'server.js';
let s = fs.readFileSync(FILE, 'utf8');

/* 0) Normalize line endings */
s = s.replace(/\r\n/g, '\n');

/* 1) Remove any stray inline GET /api/leaderboard stubs */
s = s.replace(/app\.get\(\s*['"]\/api\/leaderboard['"][\s\S]*?\}\);\s*/g, '');

/* 2) Remove any weird/accidental mounts like: app.use((req,res) => app.use('/api/leaderboard', ... */
s = s.replace(/app\.use\(\s*\(req,\s*res\)\s*=>\s*app\.use\(\s*['"]\/api\/leaderboard['"][\s\S]*?;\s*/g, '');

/* 3) Remove duplicate clean mounts if we previously added them */
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;\s*/g, '');

/* 4) Ensure a single import for the router near the other imports */
if (!/import\s+leaderboardRouter\s+from\s+['"]\.\/routes\/leaderboard\.js['"]\s*;/.test(s)) {
  // Insert just before the first 'const app = express();'
  const m = s.match(/^\s*const\s+app\s*=\s*express\(\)\s*;/m);
  if (m) {
    const idx = s.indexOf(m[0]);
    s = s.slice(0, idx) + `import leaderboardRouter from './routes/leaderboard.js';\n` + s.slice(idx);
  } else {
    // Fallback: append at top
    s = `import leaderboardRouter from './routes/leaderboard.js';\n` + s;
  }
}

/* 5) From the FIRST 'const PORT = process.env.PORT || 10000;' onward, replace with a known-good tail */
const portRe = /const\s+PORT\s*=\s*process\.env\.PORT\s*\|\|\s*10000\s*;/;
const mPort = s.match(portRe);
if (!mPort) {
  console.error('ERROR: Could not find: const PORT = process.env.PORT || 10000;');
  process.exit(1);
}
const idx = s.indexOf(mPort[0]);

const tail =
`${mPort[0]}

// Mount leaderboard BEFORE the 404
app.use('/api/leaderboard', leaderboardRouter);

// 404 one-liner
app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// error handler last
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

app.listen(PORT, () => console.log(\`7GC backend listening on :\${PORT}\`));
`;

s = s.slice(0, idx) + tail;

/* 6) Clean up any triple blank lines */
s = s.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(FILE, s);
console.log('✅ server.js tail repaired and /api/leaderboard mounted once.');
