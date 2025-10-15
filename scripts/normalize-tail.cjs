const fs = require('fs');

const f = 'server.js';
let s = fs.readFileSync(f, 'utf8');

// ensure the router import exists once
if (!/import\s+leaderboardRouter\s+from\s+['"]\.\/routes\/leaderboard\.js['"]\s*;/.test(s)) {
  const lines = s.split('\n');
  let lastImport = -1;
  lines.forEach((L,i)=>{ if (/^import\s/.test(L)) lastImport = i; });
  const ins = "import leaderboardRouter from './routes/leaderboard.js';";
  if (lastImport >= 0) lines.splice(lastImport+1,0,ins); else lines.unshift(ins);
  s = lines.join('\n');
}

// strip any broken injection line like: app.use((req,res)=> app.use('/api/leaderboard', leaderboardRouter);
s = s.replace(/app\.use\(\s*\(req\s*,\s*res\)\s*=>\s*app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\)\s*;\s*/g, '');

// remove all existing leaderboard mounts; we'll add one cleanly
s = s.replace(/app\.use\(\s*['"]\/api\/leaderboard['"]\s*,\s*leaderboardRouter\s*\)\s*;\s*/g, '');

// remove all 404 handlers that look like JSON not_found (and also malformed variants spanning one line)
s = s.replace(/app\.use\(\s*\(req\s*,\s*res\)\s*=>\s*res\.status\(\s*404\s*\)\.json\([^)]*\)\s*\)\s*;\s*/g, '');
// if someone dropped just the inner res.status(...)); line, remove it too
s = s.replace(/\bres\.status\(\s*404\s*\)\.json\([^)]*\)\s*\)\s*;\s*/g, '');

// remove duplicate error handlers: app.use((err, _req, res, _next) => { ... });
s = s.replace(/app\.use\(\s*\(err\s*,\s*[_a-zA-Z]+\s*,\s*res\s*,\s*[_a-zA-Z]+\)\s*=>\s*\{[\s\S]*?\}\)\s*;\s*/g, '');

// find app.listen(...) to insert right before it
const listenIdx = s.search(/app\.listen\s*\(/);
if (listenIdx === -1) {
  console.error('Could not find app.listen(...) in server.js');
  process.exit(1);
}

// build clean tail blocks
const blocks =
"app.use('/api/leaderboard', leaderboardRouter);\n" +
"app.use((req, res) => res.status(404).json({ ok:false, error:'not_found' }));\n" +
"app.use((err, _req, res, _next) => {\n" +
"  console.error(err);\n" +
"  res.status(500).json({ ok:false, error:'internal_error' });\n" +
"});\n";

// insert right before app.listen(...)
s = s.slice(0, listenIdx) + blocks + s.slice(listenIdx);

fs.writeFileSync(f, s, 'utf8');
console.log('✅ server.js normalized (leaderboard mount + single 404 + single error handler).');
