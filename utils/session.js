export function getSessionWallet(req) {
  const w = req?.session?.wallet;
  if (typeof w !== "string") {
    return null;
  }
  const trimmed = w.trim();
  return trimmed ? trimmed : null;
}

export default { getSessionWallet };
