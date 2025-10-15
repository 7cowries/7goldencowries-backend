const fs = require('fs');

const path = 'server.js';
let s = fs.readFileSync(path, 'utf8');

// Ensure single import after last import
if (!s.includes("import leaderboardRouter from './routes/leaderboard.js'")) {
  const lines = s.split('\n');
  let lastImport = -1;
  lines.forEach((ln, i) => { if (ln.startsWith('import ')) lastImport = i; });
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, "import leaderboardRouter from './routes/leaderboard.js';");
    s = lines.join('\n');
  } else {
    s = "import leaderboardRouter from './routes/leaderboard.js';\n" + s;
  }
}

// Remove any old inline /api/leaderboard stubs (GET handler blocks)
s = s.replace(/app\.get\(\s*["']\/api\/leaderboard["'][\s\S]*?\n\s*\}\);\s*/g, '');

// Remove duplicate mounts if any
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;\s*/g, '');

// Insert mount before the first 404 handler
const m404 = s.match(/res\.status\(\s*404\s*\)\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*error\s*:\s*["']not_found["']\s*\}\s*\)\s*\)\s*;\s*/);
if (m404) {
  const idx = m404.index;
  s = s.slice(0, idx) + "app.use('/api/leaderboard', leaderboardRouter);\n" + s.slice(idx);
} else {
  // As a fallback, put it near the top after middlewares
  s = s.replace(/app\.use\(.*\);\n/gm, (m) => m) + "app.use('/api/leaderboard', leaderboardRouter);\n";
}

fs.writeFileSync(path, s);
console.log('server.js patched: mounted /api/leaderboard before 404 and imported router.');
