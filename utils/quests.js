export function deriveCategory(row) {
  if (row.category && typeof row.category === 'string' && row.category.trim() !== '') {
    return row.category;
  }
  const t = (row.type || '').toLowerCase();
  if (t === 'daily') return 'Daily';
  if (t === 'onchain') return 'Onchain';
  if (['link', 'tweet', 'retweet', 'quote', 'follow', 'x', 'twitter'].includes(t)) return 'Social';
  return 'All';
}
