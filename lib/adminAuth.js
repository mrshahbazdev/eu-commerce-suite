const { verifyHmac } = require('./verifyHmac');

function adminAuth(shopify) {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'development' && !req.query.hmac && !req.query.signature && !req.query.session) {
      return next();
    }

    const shop = req.query.shop || req.headers['x-shopify-shop-domain'];

    // 1. Existing offline session for this shop (non-embedded admin API calls)
    if (shop && shopify) {
      try {
        const offlineId = shopify.api.session.getOfflineId(shop);
        const session = await shopify.config.sessionStorage.loadSession(offlineId);
        if (session && session.isActive()) {
          req.shop = shop;
          return next();
        }
      } catch (e) {
        console.error('[adminAuth] session load error:', e.message || e);
      }
    }

    // 2. Shopify session token from query (non-embedded apps)
    if (req.query.session && shopify) {
      try {
        const payload = await shopify.api.session.decodeSessionToken(req.query.session);
        const tokenShop = payload.dest.replace(/^https:\/\//, '');
        if (!req.query.shop) req.query.shop = tokenShop;
        if (shop && tokenShop !== shop) {
          console.error('[adminAuth] session token shop mismatch', tokenShop, shop);
          return res.status(401).send('Session shop mismatch');
        }
        req.shop = tokenShop;
        return next();
      } catch (e) {
        console.error('[adminAuth] session token decode failed:', e.message || e);
      }
    }

    // 3. Bearer session token from App Bridge
    const auth = req.headers.authorization || '';
    const match = auth.match(/^Bearer (.+)$/);
    if (match && shopify) {
      try {
        const payload = await shopify.api.session.decodeSessionToken(match[1]);
        const tokenShop = payload.dest.replace(/^https:\/\//, '');
        if (!req.query.shop) req.query.shop = tokenShop;
        req.shop = tokenShop;
        return next();
      } catch (e) {
        return res.status(401).send('Invalid session token');
      }
    }

    // 4. Shopify admin HMAC signature
    if (req.query.hmac) {
      if (verifyHmac(req.query, process.env.SHOPIFY_API_SECRET || '')) {
        return next();
      }
      console.error('[adminAuth] Invalid HMAC for shop', shop);
      return res.status(401).send('Invalid HMAC');
    }

    return res.status(401).send('Unauthorized');
  };
}

module.exports = { adminAuth };
