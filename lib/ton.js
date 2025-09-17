const TONCENTER_ENDPOINTS = {
  mainnet: 'https://toncenter.com/api/v3',
  testnet: 'https://testnet.toncenter.com/api/v3',
};

function normalizeAddress(address) {
  if (!address) return '';
  return String(address).trim();
}

function extractDestination(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (msg.destination?.address) return normalizeAddress(msg.destination.address);
  if (msg.destination) return normalizeAddress(msg.destination);
  if (msg.dst) return normalizeAddress(msg.dst);
  if (msg.to) return normalizeAddress(msg.to);
  if (msg.address) return normalizeAddress(msg.address);
  return '';
}

function extractComment(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (typeof msg.comment === 'string') return msg.comment;
  if (typeof msg.message === 'string') return msg.message;
  if (typeof msg.body === 'string') return msg.body;
  if (typeof msg.text === 'string') return msg.text;
  if (msg.decoded_body) {
    const decoded = msg.decoded_body;
    if (typeof decoded.comment === 'string') return decoded.comment;
    if (typeof decoded.text === 'string') return decoded.text;
    if (typeof decoded.body === 'string') return decoded.body;
  }
  return '';
}

function extractAmountTon(msg) {
  if (!msg || typeof msg !== 'object') return 0;
  const value = msg.value ?? msg.amount ?? msg.coins ?? msg.nano;
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  // Values are denominated in nanoTON.
  return numeric / 1e9;
}

function resolveToncenterEndpoint(network) {
  const key = String(network || 'mainnet').toLowerCase();
  return TONCENTER_ENDPOINTS[key] || TONCENTER_ENDPOINTS.mainnet;
}

function resolveProvider() {
  const provider = String(process.env.TON_VERIFIER || 'toncenter').toLowerCase();
  if (provider !== 'toncenter') {
    throw new Error(`unsupported_ton_verifier:${provider}`);
  }
  return provider;
}

export async function verifyTonPayment({ txHash, to, minAmount = 0, comment }) {
  if (!txHash) {
    return { verified: false, reason: 'tx_required' };
  }

  resolveProvider();

  const endpoint = resolveToncenterEndpoint(process.env.TON_NETWORK);
  const url = new URL('/transactions', endpoint);
  url.searchParams.set('hash', txHash);
  url.searchParams.set('limit', '1');

  const headers = {};
  if (process.env.TONCENTER_API_KEY) {
    headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`toncenter_http_${res.status}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    throw new Error('toncenter_invalid_json');
  }

  const candidates = [];
  if (Array.isArray(payload?.transactions)) {
    candidates.push(...payload.transactions);
  }
  if (payload?.transaction && typeof payload.transaction === 'object') {
    candidates.push(payload.transaction);
  }

  const normalizedHash = String(txHash).toLowerCase();
  const tx = candidates.find((entry) => {
    if (!entry) return false;
    const entryHash = entry.hash || entry.tx_hash || entry.transaction_id?.hash;
    if (!entryHash) return false;
    return String(entryHash).toLowerCase() === normalizedHash;
  }) || candidates[0];

  if (!tx) {
    return { verified: false, reason: 'tx_not_found' };
  }

  const inbound = tx.in_msg || tx.inMsg || tx.in_message || tx.inMessage || tx.message || tx.msg;
  const destination = extractDestination(inbound);
  const observedComment = extractComment(inbound);
  const amountTon = extractAmountTon(inbound);

  if (to && normalizeAddress(to) !== destination) {
    return { verified: false, reason: 'destination_mismatch', amount: amountTon, to: destination, comment: observedComment };
  }

  if (minAmount && amountTon < Number(minAmount)) {
    return { verified: false, reason: 'amount_too_low', amount: amountTon, to: destination, comment: observedComment };
  }

  if (comment && !observedComment.includes(comment)) {
    return { verified: false, reason: 'comment_mismatch', amount: amountTon, to: destination, comment: observedComment };
  }

  return {
    verified: true,
    amount: amountTon,
    to: destination,
    comment: observedComment,
    hash: txHash,
  };
}

export default { verifyTonPayment };
