require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { ApiVersion } = require('@shopify/shopify-api');
const { JsonSessionStorage } = require('./lib/sessionStorage');
const { adminAuth } = require('./lib/adminAuth');
const db = require('./db');

const PORT = process.env.PORT || 3000;

function log(msg) { console.log(`${new Date().toISOString()} [INFO] ${msg}`); }
function error(msg) { console.error(`${new Date().toISOString()} [ERROR] ${msg}`); }

const recentLogs = [];
function addLog(msg) { recentLogs.push(`${new Date().toISOString()} ${msg}`); if (recentLogs.length > 500) recentLogs.shift(); }
function getRecent(lines = 200) { return recentLogs.slice(-lines).join('\n'); }

const origLog = console.log;
const origErr = console.error;
console.log = (...args) => { const line = args.join(' '); addLog('[LOG] ' + line); origLog.apply(console, args); };
console.error = (...args) => { const line = args.join(' '); addLog('[ERR] ' + line); origErr.apply(console, args); };

let shopify = null;
const hasShopifyCreds = process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET;
if (hasShopifyCreds) {
  try {
    shopify = shopifyApp({
      api: {
        apiKey: process.env.SHOPIFY_API_KEY,
        apiSecretKey: process.env.SHOPIFY_API_SECRET,
        apiVersion: ApiVersion.July26,
        scopes: (process.env.SCOPES || 'read_products,write_products,read_orders,write_orders,read_customers,write_customers').split(','),
        hostScheme: process.env.NODE_ENV === 'development' ? 'http' : 'https',
        hostName: process.env.HOST || `localhost:${PORT}`,
        isEmbeddedApp: false,
        isCustomStoreApp: false,
      },
      auth: {
        path: '/api/auth',
        callbackPath: '/api/auth/callback',
      },
      webhooks: {
        path: '/api/webhooks',
      },
      sessionStorage: new JsonSessionStorage(),
    });
  } catch (initErr) {
    error('Shopify init failed: ' + (initErr.message || initErr));
  }
} else {
  error('Missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET. App will run in minimal mode.');
}

const app = express();
app.set('shopify', shopify);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  addLog(`${req.method} ${req.url}`);
  next();
});

if (shopify) {
  app.get(shopify.config.auth.path, (req, res, next) => {
    log('OAuth begin ' + JSON.stringify({ shop: req.query.shop }));
    shopify.auth.begin()(req, res, next);
  });

  app.get(shopify.config.auth.callbackPath, (req, res, next) => {
    log('OAuth callback ' + JSON.stringify({ shop: req.query.shop, code: req.query.code ? 'present' : 'missing' }));
    shopify.auth.callback()(req, res, (err) => {
      if (err) {
        error('OAuth callback error: ' + (err.message || err));
        return res.status(500).send('OAuth callback failed: ' + (err.message || err));
      }
      next();
    });
  }, (req, res, next) => {
    log('OAuth callback completed, redirecting');
    next();
  }, shopify.redirectToShopifyOrAppRoot());

  app.post(shopify.config.webhooks.path, shopify.processWebhooks({ webhookHandlers: {} }));
}

app.get('/api/health', (req, res) => res.send('ok'));

// Storefront app proxy
app.use('/apps/eu-suite', require('./routes/proxy'));

// Admin API
app.use('/api', adminAuth(shopify), require('./routes/admin'));

if (shopify) {
  app.get('/', shopify.validateAuthenticatedSession(), async (req, res) => {
    const { shop } = req.query;
    log('Admin load ' + JSON.stringify({ shop }));
    try {
      const template = fs.readFileSync(path.join(__dirname, 'views', 'admin.html'), 'utf8');
      res.set('Content-Type', 'text/html');
      res.send(template.replace(/{{SHOP}}/g, shop || '').replace(/{{API_KEY}}/g, process.env.SHOPIFY_API_KEY || ''));
    } catch (e) {
      error('Admin render error: ' + (e.message || e));
      res.status(500).send('Internal server error');
    }
  });
} else {
  app.get('/', (req, res) => res.status(500).send('Shopify not configured. Missing API key/secret.'));
}

app.get('/logs', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(getRecent(req.query.lines ? parseInt(req.query.lines, 10) : 200));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  error('Unhandled error: ' + (err.stack || err.message || err));
  res.status(500).send('Internal server error');
});

db.init().then(() => {
  app.listen(PORT, () => log(`GreenComply EU listening on port ${PORT}`));
}).catch(err => {
  error('Database init failed, continuing: ' + (err.message || err));
  app.listen(PORT, () => log(`GreenComply EU listening on port ${PORT}`));
});
