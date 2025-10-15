import fs from 'node:fs';

const src = fs.readFileSync('server.js', 'utf-8');

let s = src;

// Remove any broken inline attempt like: app.use((req, res) => app.use('/api/leaderboard', leaderboardRouter);
s = s.replace(/app\.use\(\s*\(req,\s*res\)\s*=>\s*app\.use\([^)]*leaderboardRouter\)[^)]*\);\s*/g, '');

// Remove any existing 404 handlers
s = s.replace(/app\.use\(\s*\(req,\s*res\)\s*=>\s*{[\s\S]*?res\.status\(\s*404\s*\)\.json\([^)]*\);\s*}\s*\);\s*/g, '');

// Remove any existing error handlers
s = s.replace(/app\.use\(\s*\(err,\s*_?req,\s*res,\s*_?next\)\s*=>\s*{[\s\S]*?}\s*\);\s*/g, '');

// Remove any existing app.listen
s = s.replace(/const\s+PORT\s*=.*?\napp\.listen\([^)]*\);\s*/gs, '');

// Also remove duplicate leaderboard mounts (we’ll insert one cleanly)
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\);\s*/g, '');

// Trim trailing whitespace
s = s.replace(/\s+$/s, '') + '\n';

// Append a clean, canonical tail
s += `
// --- 7GC normalized tail (auto) ---
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
`;

fs.writeFileSync('server.js', s);
console.log('server.js tail normalized.');
