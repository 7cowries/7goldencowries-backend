const fs = require('fs');

const path = 'server.js';
let s = fs.readFileSync(path, 'utf8');

// 1) Ensure ESM import exists once (after the last import line)
if (!/import\s+leaderboardRouter\s+from\s+['"]\.\/routes\/leaderboard\.js['"]\s*;/.test(s)) {
  const lines = s.split('\n');
  let lastImport = -1;
  lines.forEach((line, i) => { if (/^import\s/.test(line)) lastImport = i; });
  const toInsert = "import leaderboardRouter from './routes/leaderboard.js';";
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, toInsert);
  } else {
    lines.unshift(toInsert);
  }
  s = lines.join('\n');
}

// 2) Remove any broken injection like: app.use((req, res) => app.use('/api/leaderboard'...
s = s.replace(/app\.use\(\s*\(req,\s*res\)\s*=>\s*app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\)\s*;\s*/g, '');

// 3) Remove any duplicate correct mounts; we’ll reinstate a single one
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;\s*/g, '');

// 4) Insert the correct mount BEFORE the first 404 JSON handler
const mount = "app.use('/api/leaderboard', leaderboardRouter);";
const notFoundRegex = /app\.use\(\s*\(req,\s*res\)\s*=>\s*res\.status\(\s*404\s*\)\.json\(\{\s*ok:\s*false\s*,\s*error:\s*['"]not_found['"]\s*\}\)\s*\)\s*;\s*/;

if (notFoundRegex.test(s)) {
  s = s.replace(notFoundRegex, `${mount}\n$&`);
} else {
  // Fallback: try to put near top after first app.use(...)
  s = s.replace(/app\.use\(.*\);\n/, (m) => m + mount + '\n');
}

// 5) Keep only the FIRST 404 handler
let seen404 = false;
s = s.split('\n').filter(line => {
  if (/res\.status\(\s*404\s*\)\.json\(\{\s*ok:\s*false\s*,\s*error:\s*['"]not_found['"]\s*\}\)\s*\)\s*;/.test(line)) {
    if (seen404) return false;
    seen404 = true;
  }
  return true;
}).join('\n');

// 6) Keep only the FIRST error handler (app.use((err, _req, res, _next) => {...}))
let lines = s.split('\n');
let out = [];
let inErr = false, seenErr = false;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (/app\.use\(\s*\(err\s*,\s*[_a-zA-Z]+,\s*res\s*,\s*[_a-zA-Z]+\)\s*=>\s*\{/.test(L)) {
    if (seenErr) { inErr = true; continue; }
    seenErr = true; inErr = false; out.push(L); continue;
  }
  if (inErr) {
    if (/\}\)\s*;\s*$/.test(L)) { inErr = false; }
    continue;
  }
  out.push(L);
}
s = out.join('\n');

fs.writeFileSync(path, s, 'utf8');
console.log('✅ server.js normalized: imported router, mounted before 404, single 404 & error handlers.');
