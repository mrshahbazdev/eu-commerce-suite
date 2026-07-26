const crypto = require('crypto');

function verifyAppProxy(query, apiSecret) {
  const signature = query.signature || query.hmac;
  if (!signature || !apiSecret) return false;

  const params = Object.keys(query)
    .filter((key) => key !== 'signature' && key !== 'hmac')
    .sort()
    .map((key) => {
      const value = Array.isArray(query[key]) ? query[key].join(',') : query[key];
      return `${key}=${value}`;
    })
    .join('');

  const hmac = crypto.createHmac('sha256', apiSecret).update(params).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

module.exports = { verifyAppProxy };
