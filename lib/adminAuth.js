const { verifyHmac } = require('./verifyHmac');

function adminAuth(shopify) {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'development' && !req.query.hmac && !req.query.signature) {
      return next();
    }
    if (req.query.hmac) {
      if (verifyHmac(req.query, process.env.SHOPIFY_API_SECRET || '')) {
        return next();
      }
      return res.status(401).send('Invalid HMAC');
    }

    const auth = req.headers.authorization || '';
    const match = auth.match(/^Bearer (.+)$/);
    if (match && shopify) {
      try {
        const payload = await shopify.api.session.decodeSessionToken(match[1]);
        const shop = payload.dest.replace(/^https:\/\//, '');
        if (!req.query.shop) req.query.shop = shop;
        return next();
      } catch (e) {
        return res.status(401).send('Invalid session token');
      }
    }

    return res.status(401).send('Unauthorized');
  };
}

module.exports = { adminAuth };
