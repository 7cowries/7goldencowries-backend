export async function fetchJson(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
