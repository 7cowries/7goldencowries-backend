import fetch from 'node-fetch';

const base = process.env.BASE_URL || 'http://localhost:3000';
const endpoints = ['/api/health', '/api/leaderboard', '/api/quests', '/api/referrals/code'];

async function ping(path) {
  try {
    const res = await fetch(base + path, { method: 'GET' });
    console.log(path, res.status);
    await res.text();
  } catch (e) {
    console.error(path, 'error', e.message);
  }
}

for (const p of endpoints) {
  await ping(p);
}
