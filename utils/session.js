export function getSessionWallet(req) {
  const w = req?.session?.wallet;
  return w ? String(w) : null;
}

