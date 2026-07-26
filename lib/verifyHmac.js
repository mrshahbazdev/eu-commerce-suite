const crypto = require('crypto');

function verifyHmac(query, apiSecret) {
  const signature = query.hmac;
  if (!signature || !apiSecret) return false;

  const pairs = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature' && query[key] !== '')
    .sort()
    .map((key) => {
      const value = Array.isArray(query[key]) ? query[key].join(',') : query[key];
      return `${key}=${value}`;
    });

  const message = pairs.join('&');
  const hmac = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

module.exports = { verifyHmac };
