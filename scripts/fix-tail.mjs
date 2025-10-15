import fs from 'fs';

const f = 'server.js';
const src = fs.readFileSync(f, 'utf8');

// 1) Drop any inline GET /api/leaderboard stub blocks
let s = src.replace(/app\.get\(\s*['"]\/api\/leaderboard['"][\s\S]*?\}\);\s*/g, '');

// 2) Remove duplicate mounts (keep none; we will re-add exactly one)
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;?/g, '');

// 3) Remove existing 404 handler blocks
s = s.replace(/app\.use\(\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{\s*res\.status\(\s*404\s*\)\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*error\s*:\s*['"]not_found['"]\s*\}\s*\)\s*;\s*\}\s*\)\s*;?/g, '');

// 4) Remove existing error handler blocks
s = s.replace(/app\.use\(\s*\(\s*err\s*,\s*_?req\s*,\s*res\s*,\s*_?next\s*\)\s*=>\s*\{\s*console\.error\([^)]*\);\s*res\.status\(\s*500\s*\)\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*error\s*:\s*['"]internal_error['"]\s*\}\s*\)\s*;\s*\}\s*\)\s*;?/g, '');

// 5) Remove any existing listen lines
s = s.replace(/const\s+PORT\s*=\s*process\.env\.PORT[^;]*;?\s*app\.listen\([^)]*\)\s*;?/g, '');

// 6) Trim trailing whitespace & stray semis
s = s.replace(/\s+$/g, '');

// 7) Append the clean canonical tail
const tail = `
\n// --- 7GC normalized tail (auto) ---
app.use('/api/leaderboard', leaderboardRouter);

app.use((req, res) => {
  res.status(404).json({ ok:false, error:'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok:false, error:'internal_error' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(\`7GC backend listening on :\${PORT}\`));
`.trim();

fs.writeFileSync(f + '.bak.' + Date.now(), src);
fs.writeFileSync(f, s + '\n\n' + tail + '\n', 'utf8');
console.log('server.js tail normalized.');
