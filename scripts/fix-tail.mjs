import fs from 'fs/promises';

const path = 'server.js';
let s = await fs.readFile(path, 'utf8');

// Ensure router import once after the last import
if (!s.includes("import leaderboardRouter from './routes/leaderboard.js'")) {
  const lines = s.split('\n');
  let lastImport = -1;
  lines.forEach((l,i)=>{ if (/^import\s/.test(l)) lastImport = i; });
  if (lastImport >= 0) {
    lines.splice(lastImport+1, 0, "import leaderboardRouter from './routes/leaderboard.js';");
    s = lines.join('\n');
  } else {
    s = "import leaderboardRouter from './routes/leaderboard.js';\n" + s;
  }
}

// Remove any inline GET handler for /api/leaderboard
s = s.replace(/app\.get\(\s*['"]\/api\/leaderboard['"][\s\S]*?\}\);\s*/g, '');

// Remove any existing /api/leaderboard mounts
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"][\s\S]*?\);\s*/g, '');

// Remove any 404 handlers
s = s.replace(/app\.use\(\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*res\.status\(404\)[\s\S]*?\}\s*\)\s*;\s*/g, '');
s = s.replace(/res\.status\(404\)\.json\(\{[^}]*\}\)\);\s*/g, ''); // stray one-liners

// Remove any error handlers
s = s.replace(/app\.use\(\s*\(\s*err[\s\S]*?\}\s*\)\s*;\s*/g, '');

// Remove listen & PORT blocks
s = s.replace(/const\s+PORT[\s\S]*?app\.listen\([\s\S]*?\)\s*;\s*/g, '');

// Trim trailing whitespace
s = s.replace(/\s+$/,'') + '\n';

// Append clean tail
s += `
// --- 7GC fixed tail (auto) ---
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

await fs.writeFile(path, s, 'utf8');
console.log('server.js normalized ✅');
