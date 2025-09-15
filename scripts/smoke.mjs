import fetch from 'node-fetch';
import { getRequiredEnv } from '../config/env.js';

const base =
  process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

const requiredEnvVars = ['SUBSCRIPTION_WEBHOOK_SECRET', 'TOKEN_SALE_WEBHOOK_SECRET'];
for (const name of requiredEnvVars) {
  getRequiredEnv(name);
}

const endpoints = [
  { path: '/healthz', requiredStatus: 200 },
  { path: '/api/health', requiredStatus: 200 },
  { path: '/api/leaderboard' },
  { path: '/api/quests' },
  { path: '/api/referrals/code' },
];

let failed = false;

async function ping({ path, requiredStatus }) {
  try {
    const url = new URL(path, base);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': '7gc-smoke/1.0' },
    });
    console.log(path, res.status);
    if (requiredStatus && res.status !== requiredStatus) {
      console.error(
        `${path} expected status ${requiredStatus} but received ${res.status}`
      );
      failed = true;
    }
    await res.arrayBuffer();
  } catch (e) {
    console.error(path, 'error', e.message);
    if (requiredStatus) {
      failed = true;
    }
  }
}

for (const endpoint of endpoints) {
  await ping(endpoint);
}

if (failed) {
  process.exit(1);
}
