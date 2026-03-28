import fetch from 'node-fetch';

const frontendBase =
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_BASE_URL ||
  'https://7goldencowries.com';

const backendBase =
  process.env.BACKEND_URL ||
  process.env.BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://sevengoldencowries-backend-vw37.onrender.com';

const wallet = process.env.SMOKE_WALLET || 'UQ_SMOKE_WALLET';

const state = {
  failed: false,
  issues: [],
};

function markIssue(msg) {
  state.failed = true;
  state.issues.push(msg);
  console.error('❌', msg);
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': '7gc-smoke/2.0',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { res, body, text };
}

async function ping(path, { requiredStatus = 200, base = backendBase } = {}) {
  const url = new URL(path, base);
  try {
    const { res, body } = await requestJson(url);
    const ok = requiredStatus == null ? true : res.status === requiredStatus;
    console.log(`${url} -> ${res.status}`);
    if (!ok) {
      markIssue(`${path} expected ${requiredStatus} but received ${res.status}`);
    }
    return { ok, status: res.status, body };
  } catch (error) {
    markIssue(`${path} request failed: ${error.message}`);
    return { ok: false, status: 0, body: null };
  }
}

async function fetchFrontendAndLinks() {
  const url = new URL('/', frontendBase);
  try {
    const res = await fetch(url, { headers: { 'user-agent': '7gc-smoke/2.0' } });
    const html = await res.text();
    console.log(`${url} -> ${res.status}`);

    if (res.status !== 200) {
      markIssue(`frontend root expected 200 but received ${res.status}`);
      return;
    }

    const routes = [
      '/',
      '/quests',
      '/profile',
      '/leaderboard',
      '/arena',
      '/subscription',
      '/token-sale',
    ];

    for (const route of routes) {
      const routeUrl = new URL(route, frontendBase);
      const routeRes = await fetch(routeUrl, {
        headers: { 'user-agent': '7gc-smoke/2.0' },
      });
      console.log(`${routeUrl} -> ${routeRes.status}`);
      if (routeRes.status >= 500) {
        markIssue(`frontend route ${route} returned ${routeRes.status}`);
      }
    }

    const hasAppShell = /<div\s+id="root"/i.test(html) || /id="__next"/i.test(html);
    if (!hasAppShell) {
      markIssue('frontend root did not include app shell mount element');
    }
  } catch (error) {
    markIssue(`frontend crawl failed: ${error.message}`);
  }
}

async function verifySessionFlows() {
  const cookie = [];

  async function sessionRequest(path, options = {}) {
    const url = new URL(path, backendBase);
    try {
      const { res, body, text } = await requestJson(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          cookie: cookie.join('; '),
          'content-type':
            options.body && !(options.headers && options.headers['content-type'])
              ? 'application/json'
              : options.headers?.['content-type'],
        },
      });

      const setCookie = res.headers.raw()['set-cookie'];
      if (Array.isArray(setCookie)) {
        for (const c of setCookie) {
          const firstPart = c.split(';')[0];
          if (firstPart) cookie.push(firstPart);
        }
      }

      return { res, body, text };
    } catch (error) {
      markIssue(`${path} session request failed: ${error.message}`);
      return {
        res: { status: 0, headers: { raw: () => ({}) } },
        body: null,
        text: '',
      };
    }
  }

  const bind = await sessionRequest('/api/session/bind-wallet', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  });
  console.log(`/api/session/bind-wallet -> ${bind.res.status}`);
  if (bind.res.status !== 200 || bind.body?.ok !== true) {
    markIssue('session bind wallet failed');
  }

  const sessionEndpoints = [
    '/api/users/me',
    '/api/quests',
    '/api/leaderboard',
    '/api/arena',
    '/api/v1/payments/status',
    '/api/v1/subscription/status',
  ];

  for (const endpoint of sessionEndpoints) {
    const out = await sessionRequest(endpoint);
    console.log(`${endpoint} -> ${out.res.status}`);
    if (out.res.status >= 500) {
      markIssue(`${endpoint} returned server error ${out.res.status}`);
    }
  }

  const verify = await sessionRequest('/api/v1/payments/verify', {
    method: 'POST',
    body: JSON.stringify({ txHash: 'qa-smoke-demo' }),
  });
  console.log(`/api/v1/payments/verify -> ${verify.res.status}`);
  if (verify.res.status >= 500) {
    markIssue(`/api/v1/payments/verify returned ${verify.res.status}`);
  }
}

async function run() {
  console.log('== 7GC full smoke ==');
  console.log(`frontend: ${frontendBase}`);
  console.log(`backend : ${backendBase}`);

  await fetchFrontendAndLinks();

  await ping('/');
  await ping('/healthz');
  await ping('/api/health');
  await ping('/api/meta/progression');
  await ping('/api/quests');
  await ping('/api/leaderboard');
  await ping('/api/arena');

  await verifySessionFlows();

  if (state.failed) {
    console.error('\nSmoke failed with issues:');
    for (const issue of state.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log('\n✅ Smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
