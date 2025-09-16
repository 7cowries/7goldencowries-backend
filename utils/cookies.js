const isProd = process.env.NODE_ENV === 'production';

export function crossSiteCookieOptions(overrides = {}) {
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    ...overrides,
  };
}

export default crossSiteCookieOptions;
