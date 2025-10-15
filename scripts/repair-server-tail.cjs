const fs = require('fs');

const file = 'server.js';
let s = fs.readFileSync(file, 'utf8');

/**
 * 1) Normalize duplicate 404 / error handlers (keep the first of each)
 */
s = (() => {
  // Keep the FIRST 404 handler only
  const lines = s.split('\n');
  let seen404 = 0;
  let seenErr = 0;
  const out = [];
  let skippingErr = false;

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    // Detect error handler start
    if (/app\.use\(\(err,\s*_?req,\s*res,\s*_?next\)\s*=>/.test(L)) {
      if (seenErr) { skippingErr = true; continue; }
      seenErr = 1;
    }

    if (skippingErr) {
      // detect end of error handler block
      if (/\}\);/.test(L)) { skippingErr = false; }
      continue;
    }

    // Detect and de-duplicate 404 one-liners we added earlier
    if (/res\.status\(404\)\.json\(\{\s*ok:\s*false,\s*error:\s*["']not_found["']\s*\}\)\);/.test(L)) {
      if (seen404) continue;
      seen404 = 1;
    }

    out.push(L);
  }

  return out.join('\n');
})();

/**
 * 2) Ensure a single, clean leaderboard import at the top
 */
if (!/import\s+leaderboardRouter\s+from\s+['"]\.\/routes\/leaderboard\.js['"]\s*;/.test(s)) {
  const importIdxs = Array.from(s.matchAll(/^import .*;$/mg)).map(m => m.index);
  const insertAt = importIdxs.length ? importIdxs[importIdxs.length - 1] : 0;
  s = s.slice(0, insertAt) +
      s.slice(insertAt).replace(/^import .*;$/m, (m0) =>
        m0 + `\nimport leaderboardRouter from './routes/leaderboard.js';`
      );
}

/**
 * 3) Remove any inline GET /api/leaderboard stubs we experimented with
 *    and any duplicate app.use('/api/leaderboard', ...)
 */
s = s.replace(/app\.get\(\s*['"]\/api\/leaderboard['"][\s\S]*?\}\);\s*/g, '');
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;\s*/g, '');

/**
 * 4) From the **first** "const PORT" onward, replace the tail with a known-good tail.
 *    This also zaps any stray '});' that got left behind.
 */
const portRe = /const\s+PORT\s*=\s*process\.env\.PORT\s*\|\|\s*10000\s*;/;
const m = s.match(portRe);
if (!m) {
  console.error('ERROR: Could not find "const PORT = process.env.PORT || 10000;" in server.js');
  process.exit(1);
}
const idx = s.indexOf(m[0]);

const tail =
`\n${m[0]}

// Mount leaderboard BEFORE the 404
app.use('/api/leaderboard', leaderboardRouter);

// 404 last (only one)
app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// error last
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

app.listen(PORT, () => console.log(\`7GC backend listening on :\${PORT}\`));
`;

s = s.slice(0, idx) + tail;

// Final pass: delete accidental double blank lines
s = s.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(file, s);
console.log('server.js repaired and leaderboard mounted cleanly.');
