require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { JsonSessionStorage } = require('./lib/sessionStorage');
const { verifyHmac } = require('./lib/verifyHmac');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || `localhost:${PORT}`;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SCOPES = (process.env.SCOPES || 'read_products,write_products,read_orders,write_orders,read_customers,write_customers').split(',');

function log(msg) { console.log(`${new Date().toISOString()} [INFO] ${msg}`); }
function errLog(msg) { console.error(`${new Date().toISOString()} [ERROR] ${msg}`); }

const recentLogs = [];
function addLog(msg) { recentLogs.push(`${new Date().toISOString()} ${msg}`); if (recentLogs.length > 500) recentLogs.shift(); }
function getRecent(lines = 200) { return recentLogs.slice(-lines).join('\n'); }

function hmacCheck(req, res, next) {
  const { shop } = req.query;
  if (!shop) return res.status(400).send('Shop required');
  if (SHOPIFY_API_SECRET && (req.query.hmac || req.query.signature)) {
    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      errLog('HMAC verification failed');
      return res.status(401).send('Unauthorized');
    }
  } else if (process.env.NODE_ENV !== 'development') {
    return res.status(401).send('HMAC/signature required');
  }
  next();
}

let shopify = null;
try {
  const { ApiVersion } = require('@shopify/shopify-api');
  const { shopifyApp } = require('@shopify/shopify-app-express');
  shopify = shopifyApp({
    api: {
      apiKey: SHOPIFY_API_KEY,
      apiSecretKey: SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.July26,
      scopes: SCOPES,
      hostName: HOST.replace(/^https?:\/\//, ''),
      hostScheme: 'https',
      isEmbeddedApp: false,
    },
    auth: {
      path: '/api/auth',
      callbackPath: '/api/auth/callback',
    },
    webhooks: { path: '/api/webhooks' },
    sessionStorage: new JsonSessionStorage(),
  });
} catch (initErr) {
  errLog('Shopify init failed, running in minimal mode: ' + (initErr.message || initErr));
}

async function adminAuth(req, res, next) {
  const shop = req.query.shop || req.headers['x-shopify-shop-domain'] || (req.session && req.session.shop) || req.shop;
  if (!shop) return res.status(400).json({ error: 'Shop required' });
  if (process.env.NODE_ENV === 'development' && !req.query.hmac && !req.query.signature) {
    req.shop = shop; return next();
  }
  if (req.query.hmac && SHOPIFY_API_SECRET && verifyHmac(req.query, SHOPIFY_API_SECRET)) { req.shop = shop; return next(); }
  if (req.query.signature) { req.shop = shop; return next(); }
  if (shopify) {
    try {
      const offlineId = shopify.api.session.getOfflineId(shop);
      const session = await shopify.config.sessionStorage.loadSession(offlineId);
      if (session && session.accessToken) { req.shop = shop; req.session = session; return next(); }
    } catch (e) {}
  }
  return res.status(401).json({ error: 'Unauthorized. Reinstall the app.' });
}

const app = express();
if (shopify) app.set('shopify', shopify);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));

app.get('/', hmacCheck, async (req, res, next) => {
  if (!shopify) return res.status(500).send('Shopify not configured');
  try {
    await shopify.auth.begin({ shop: req.query.shop, callbackPath: '/api/auth/callback', isOnline: false })(req, res, next);
  } catch (e) { next(e); }
});

app.get('/api/auth/callback', async (req, res, next) => {
  if (!shopify) return res.status(500).send('Shopify not configured');
  try {
    await shopify.auth.callback()(req, res, (err) => {
      if (err) { errLog('OAuth callback error: ' + (err.message || err)); return res.status(500).send('OAuth callback failed: ' + (err.message || err)); }
      next();
    });
    res.redirect(`https://admin.shopify.com/store/${req.query.shop.replace('.myshopify.com', '')}/apps/${SHOPIFY_API_KEY}`);
  } catch (e) { next(e); }
});

app.get('/api/health', (req, res) => res.send('ok'));
app.use('/api', adminAuth, require('./routes/admin'));
app.use('/storefront', require('./routes/proxy'));

app.get('/admin', hmacCheck, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});
app.get('/logs', (req, res) => { res.set('Content-Type', 'text/plain'); res.send(getRecent(req.query.lines ? parseInt(req.query.lines, 10) : 200)); });

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  errLog('Unhandled error: ' + (err.stack || err.message || err));
  res.status(500).send('Internal server error');
});

db.init().then(() => {
  app.listen(PORT, () => log(`GreenComply EU listening on port ${PORT}`));
}).catch(err => {
  errLog('Database init failed, continuing: ' + (err.message || err));
  app.listen(PORT, () => log(`GreenComply EU listening on port ${PORT}`));
});
