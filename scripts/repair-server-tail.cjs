const fs = require('fs');

const file = 'server.js';
let s = fs.readFileSync(file,'utf8');

// 2a) Ensure ESM import exists exactly once
const importLine = "import leaderboardRouter from './routes/leaderboard.js';";
if (!/import\s+leaderboardRouter\s+from\s+['"]\.\/routes\/leaderboard\.js['"]\s*;/.test(s)) {
  const lines = s.split('\n');
  let lastImport = -1;
  for (let i=0;i<lines.length;i++) if (/^import\s/.test(lines[i])) lastImport = i;
  if (lastImport >= 0) lines.splice(lastImport+1,0, importLine);
  else lines.unshift(importLine);
  s = lines.join('\n');
}

// 2b) Find the last "const PORT" and rebuild the tail from there
let idx = s.lastIndexOf('const PORT');
if (idx === -1) {
  // If PORT line is missing or mangled, anchor on app.listen or else append.
  idx = s.search(/app\.listen\s*\(/);
  if (idx === -1) idx = s.length;
}

// Strip everything from idx -> end (this removes any broken mounts/404/error/extra braces)
s = s.slice(0, idx);

// Build canonical tail
const tail =
`\nconst PORT = process.env.PORT || 10000;\n
// Mount leaderboard once
app.use('/api/leaderboard', leaderboardRouter);

// 404 (json)
app.use((req, res) => res.status(404).json({ ok:false, error:'not_found' }));

// Error last
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok:false, error:'internal_error' });
});

app.listen(PORT, () => console.log(\`7GC backend listening on :\${PORT}\`));\n`;

s = s.replace(/\s+$/,'') + tail;

fs.writeFileSync(file, s, 'utf8');
console.log('✅ server.js tail repaired.');
