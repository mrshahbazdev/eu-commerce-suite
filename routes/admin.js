const express = require('express');
const router = express.Router();
const db = require('../db');

function getShop(req, res) {
  const sessionShop = res && res.locals && res.locals.shopify && res.locals.shopify.session && res.locals.shopify.session.shop;
  return req.query.shop || req.headers['x-shopify-shop-domain'] || (req.session && req.session.shop) || req.shop || sessionShop;
}

// Settings
router.get('/settings', async (req, res, next) => {
  try { res.json(await db._getSettings(getShop(req, res))); } catch (e) { next(e); }
});
router.post('/settings', async (req, res, next) => {
  try { await db._saveSettings(getShop(req, res), req.body); res.json({ success: true }); } catch (e) { next(e); }
});

// GDPR Consent logs
router.get('/consent-logs', async (req, res, next) => {
  try { res.json({ logs: await db.getConsentLogs(getShop(req, res), { limit: parseInt(req.query.limit, 10) || 50 }) }); } catch (e) { next(e); }
});

router.post('/consent-logs', async (req, res, next) => {
  try { const row = await db.saveCookieConsent(getShop(req, res), req.body); res.json(row); } catch (e) { next(e); }
});

// Data request / delete / export
router.get('/data-requests', async (req, res, next) => {
  try { res.json({ requests: await db.getDataRequests(getShop(req, res)) }); } catch (e) { next(e); }
});

router.post('/data-requests', async (req, res, next) => {
  try {
    const { email, type } = req.body;
    if (!email || !['export', 'delete'].includes(type)) return res.status(400).json({ error: 'email and type required' });
    const row = await db.createDataRequest(getShop(req, res), { email, type });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/data-requests/:id/process', async (req, res, next) => {
  try {
    const { status, result } = req.body;
    await db.updateDataRequest(getShop(req, res), req.params.id, status, result);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Legal pages
router.get('/legal-pages', async (req, res, next) => {
  try { res.json(await db.getLegalPages(getShop(req, res))); } catch (e) { next(e); }
});

router.post('/legal-pages', async (req, res, next) => {
  try {
    const { privacy_policy, terms, impressum, widerruf, agb } = req.body;
    await db.saveLegalPages(getShop(req, res), { privacy_policy, terms, impressum, widerruf, agb });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post('/generate-legal-pages', async (req, res, next) => {
  try {
    const { company, address, email, url } = req.body;
    if (!company || !email) return res.status(400).json({ error: 'company and email required' });
    const pp = generatePrivacyPolicy({ company, address, email, url });
    const terms = generateTerms({ company, address, email, url });
    const impressum = generateImpressum({ company, address, email, url });
    const widerruf = generateWiderruf({ company, address, email, url });
    const agb = generateAGB({ company, address, email, url });
    await db.saveLegalPages(getShop(req, res), { privacy_policy: pp, terms, impressum, widerruf, agb });
    res.json({ privacy_policy: pp, terms, impressum, widerruf, agb });
  } catch (e) { next(e); }
});

// Cookie scanner (simple heuristic)
router.post('/cookie-scan', async (req, res, next) => {
  try {
    const { url: targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: 'url required' });
    const https = require('https');
    const http = require('http');
    const client = targetUrl.startsWith('https') ? https : http;
    const body = await new Promise((resolve, reject) => {
      client.get(targetUrl, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const cookies = [];
    const seen = new Set();
    const common = ['_ga', '_gid', '_fbp', '_gat', 'fr', 'MUID', 'IDE', 'NID', '1P_JAR', 'CONSENT', 'OTZ', '__cfduid', '__stripe_mid', 'shopify_sa_p', 'cart', '_shopify_y', '_shopify_s'];
    common.forEach(name => {
      if (body.toLowerCase().includes(name.toLowerCase()) && !seen.has(name)) { seen.add(name); cookies.push({ name, category: guessCookieCategory(name) }); }
    });
    const row = await db.saveCookieScan(getShop(req, res), { url: targetUrl, cookies });
    res.json(row);
  } catch (e) { next(e); }
});

router.get('/cookie-scans', async (req, res, next) => {
  try { res.json({ scans: await db.getCookieScans(getShop(req, res)) }); } catch (e) { next(e); }
});

function guessCookieCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('ga') || n.includes('_gid') || n.includes('analytics') || n.includes('_gat')) return 'analytics';
  if (n.includes('fb') || n.includes('fr') || n.includes('ads') || n.includes('muid') || n.includes('ide')) return 'marketing';
  if (n.includes('cart') || n.includes('shopify_s') || n.includes('_shopify_y') || n.includes('session') || n.includes('csrf')) return 'necessary';
  if (n.includes('pref') || n.includes('lang') || n.includes('currency')) return 'preferences';
  return 'unknown';
}

// Age verification
router.get('/age-verifications', async (req, res, next) => {
  try { res.json({ logs: await db.getAgeVerifications(getShop(req, res)) }); } catch (e) { next(e); }
});

router.post('/age-verification', async (req, res, next) => {
  try { const row = await db.logAgeVerification(getShop(req, res), req.body); res.json(row); } catch (e) { next(e); }
});

// VAT
router.get('/vat-settings', async (req, res, next) => {
  try { res.json(await db.getVatSettings(getShop(req, res))); } catch (e) { next(e); }
});

router.post('/vat-settings', async (req, res, next) => {
  try { await db.saveVatSettings(getShop(req, res), req.body); res.json({ success: true }); } catch (e) { next(e); }
});

// Carbon
router.get('/carbon-settings', async (req, res, next) => {
  try { res.json(await db.getCarbonSettings(getShop(req, res))); } catch (e) { next(e); }
});

router.post('/carbon-settings', async (req, res, next) => {
  try { await db.saveCarbonSettings(getShop(req, res), req.body); res.json({ success: true }); } catch (e) { next(e); }
});

router.post('/carbon-calculate', async (req, res, next) => {
  try {
    const settings = await db.getCarbonSettings(getShop(req, res));
    const { weight_kg, order_total, distance_km } = req.body;
    const w = parseFloat(weight_kg) || settings.kg_co2_per_order || 2.5;
    const factor = settings.per_kg_factor || 0.5;
    const rate = settings.offset_rate_per_kg || 0.12;
    const kg = w * factor;
    const offset = +(kg * rate).toFixed(2);
    res.json({ kg_co2: +kg.toFixed(4), offset_amount: offset, currency: settings.currency || 'EUR' });
  } catch (e) { next(e); }
});

router.get('/carbon-orders', async (req, res, next) => {
  try { res.json({ orders: await db.getCarbonOrders(getShop(req, res)) }); } catch (e) { next(e); }
});

router.post('/carbon-orders', async (req, res, next) => {
  try { const row = await db.createCarbonOrder(getShop(req, res), req.body); res.json(row); } catch (e) { next(e); }
});

// Couriers
router.get('/courier-settings', async (req, res, next) => {
  try { res.json(await db.getCourierSettings(getShop(req, res))); } catch (e) { next(e); }
});

router.post('/courier-settings', async (req, res, next) => {
  try { await db.saveCourierSettings(getShop(req, res), req.body); res.json({ success: true }); } catch (e) { next(e); }
});

router.post('/courier/quote', async (req, res, next) => {
  try {
    const { carrier, from, to, weight, dimensions } = req.body;
    const settings = await db.getCourierSettings(getShop(req, res));
    const quote = {
      carrier,
      estimated_days: carrier === 'dpd' ? 2 : carrier === 'gls' ? 1 : 3,
      green: settings[`${carrier}_enabled`] ? true : false,
      price: weight ? +(weight * (carrier === 'dpd' ? 7.5 : carrier === 'gls' ? 8.2 : 9.0)).toFixed(2) : 10,
      currency: 'EUR',
      note: 'Live integration requires carrier API credentials and contract.'
    };
    res.json(quote);
  } catch (e) { next(e); }
});

// Sustainability reports
router.get('/sustainability-reports', async (req, res, next) => {
  try { res.json({ reports: await db.getSustainabilityReports(getShop(req, res)) }); } catch (e) { next(e); }
});

router.post('/sustainability-reports', async (req, res, next) => {
  try {
    const { period_start, period_end } = req.body;
    const orders = await db.getCarbonOrders(getShop(req, res));
    const filtered = orders.filter(o => o.created_at >= period_start && o.created_at <= period_end);
    const total = filtered.reduce((sum, o) => sum + (parseFloat(o.kg_co2) || 0), 0);
    const count = filtered.length;
    const row = await db.createSustainabilityReport(getShop(req, res), {
      period_start,
      period_end,
      kg_co2_offset: total,
      offsets_sold: count,
      report_data: { total_orders: orders.length, period_orders: count, kg_co2_offset: total }
    });
    res.json(row);
  } catch (e) { next(e); }
});

function generatePrivacyPolicy({ company, address, email, url }) {
  return `Privacy Policy for ${company}\n\nAt ${company}, accessible from ${url || 'our store'}, one of our main priorities is the privacy of our visitors and customers. This Privacy Policy document contains types of information that is collected and recorded by ${company} and how we use it.\n\nIf you have additional questions or require more information about our Privacy Policy, do not hesitate to contact us at ${email}.\n\nWe are a controller of your data. This Privacy Policy applies to personal data that we collect through our store, emails, forms, cookies and other tracking technologies.\n\nYour rights under GDPR include access, rectification, erasure, restriction of processing, data portability, and objection. To exercise these rights, contact ${email}.`;
}

function generateTerms({ company, address, email, url }) {
  return `Terms and Conditions for ${company}\n\nWelcome to ${url || 'our store'}. These terms and conditions outline the rules and regulations for the use of ${company}'s website. By accessing this website we assume you accept these terms and conditions in full. Do not continue to use ${url || 'our store'} if you do not agree to all of the terms and conditions stated on this page.\n\nContact: ${email}, ${address || ''}`;
}

function generateImpressum({ company, address, email, url }) {
  return `Impressum / Legal Notice\n\n${company}\n${address || ''}\n\nE-Mail: ${email}\nWebsite: ${url || ''}\n\nVertreten durch: Geschäftsführer/in (Managing Director)`;
}

function generateWiderruf({ company, address, email }) {
  return `Widerrufsbelehrung\n\nSie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die letzte Ware in Besitz genommen haben.\n\n${company}\n${address || ''}\n${email}`;
}

function generateAGB({ company, address, email }) {
  return `Allgemeine Geschäftsbedingungen (AGB)\n\n1. Geltungsbereich\nDiese AGB gelten für alle Bestellungen über unseren Onlineshop.\n\n2. Vertragspartner\nDer Kaufvertrag kommt zustande mit ${company}.\n\n3. Kontakt\n${company}\n${address || ''}\n${email}`;
}

module.exports = router;
