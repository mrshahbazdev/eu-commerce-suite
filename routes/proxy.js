const express = require('express');
const router = express.Router();
const { verifyAppProxy } = require('../lib/verifyProxy');
const db = require('../db');

const apiSecret = process.env.SHOPIFY_API_SECRET || '';

function proxyAuth(req, res, next) {
  if (process.env.NODE_ENV === 'development' && !req.query.signature) return next();
  if (!verifyAppProxy(req.query, apiSecret)) return res.status(401).json({ error: 'Invalid signature' });
  next();
}

function getShop(req) { return req.query.shop; }

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

router.get('/consent-banner', proxyAuth, async (req, res, next) => {
  try {
    const settings = await db._getSettings(getShop(req)) || {};
    const banner = settings.consent_banner || {};
    const title = escapeHtml(banner.title || 'We value your privacy');
    const text = escapeHtml(banner.text || 'This website uses cookies to ensure you get the best experience.');
    res.set('Content-Type', 'application/liquid');
    res.send(`{% layout none %}${consentBannerHtml(title, text)}`);
  } catch (e) { next(e); }
});

router.post('/consent', proxyAuth, async (req, res, next) => {
  try {
    const row = await db.saveCookieConsent(getShop(req), {
      customer_id: req.query.logged_in_customer_id || req.body.customer_id || 'guest',
      categories: req.body.categories || {},
      ip: req.headers['x-forwarded-for'] || req.ip,
      user_agent: req.headers['user-agent'] || '',
    });
    res.json({ success: true, id: row.id });
  } catch (e) { next(e); }
});

router.get('/age-verify', proxyAuth, async (req, res, next) => {
  try {
    const settings = await db._getSettings(getShop(req)) || {};
    const av = settings.age_verification || {};
    res.set('Content-Type', 'application/liquid');
    res.send(`{% layout none %}${ageVerifyHtml(escapeHtml(av.title || 'Age Verification'), escapeHtml(av.text || 'You must be 18 or older to enter.'))}`);
  } catch (e) { next(e); }
});

router.post('/age-verify', proxyAuth, async (req, res, next) => {
  try {
    const row = await db.logAgeVerification(getShop(req), {
      customer_id: req.query.logged_in_customer_id || req.body.customer_id || 'guest',
      dob: req.body.dob,
      ip: req.headers['x-forwarded-for'] || req.ip,
    });
    res.json({ success: true, id: row.id });
  } catch (e) { next(e); }
});

router.get('/vat-display', proxyAuth, async (req, res, next) => {
  try {
    const settings = await db.getVatSettings(getShop(req));
    const price = parseFloat(req.query.price) || 0;
    const rate = parseFloat(settings.default_rate) || 19.00;
    const vat = +(price * rate / (100 + rate)).toFixed(2);
    const label = escapeHtml(settings.display_label || 'VAT included');
    res.set('Content-Type', 'application/liquid');
    res.send(`{% layout none %}<span class="ec-vat" data-vat-amount="${vat}">${label}: ${vat}</span>`);
  } catch (e) { next(e); }
});

router.get('/carbon-badge', proxyAuth, async (req, res, next) => {
  try {
    const settings = await db.getCarbonSettings(getShop(req));
    const weight = parseFloat(req.query.weight) || settings.kg_co2_per_order || 2.5;
    const factor = parseFloat(settings.per_kg_factor) || 0.5;
    const kg = +(weight * factor).toFixed(4);
    res.set('Content-Type', 'application/liquid');
    res.send(`{% layout none %}<span class="ec-carbon-badge" title="Estimated carbon footprint: ${kg} kg CO2e">🌱 ${kg} kg CO2e</span>`);
  } catch (e) { next(e); }
});

router.get('/carbon-widget', proxyAuth, async (req, res, next) => {
  try {
    const settings = await db.getCarbonSettings(getShop(req));
    const weight = parseFloat(req.query.weight) || settings.kg_co2_per_order || 2.5;
    const factor = parseFloat(settings.per_kg_factor) || 0.5;
    const rate = parseFloat(settings.offset_rate_per_kg) || 0.12;
    const kg = +(weight * factor).toFixed(4);
    const offset = +(kg * rate).toFixed(2);
    const label = escapeHtml(settings.label || 'Make it carbon neutral');
    res.set('Content-Type', 'application/liquid');
    res.send(`{% layout none %}${carbonWidgetHtml(label, kg, offset, settings.currency || 'EUR')}`);
  } catch (e) { next(e); }
});

router.post('/carbon-offset', proxyAuth, async (req, res, next) => {
  try {
    const { order_id, kg_co2, offset_amount, currency } = req.body;
    const row = await db.createCarbonOrder(getShop(req), { order_id, kg_co2, offset_amount, currency, status: 'pending' });
    res.json({ success: true, id: row.id });
  } catch (e) { next(e); }
});

function consentBannerHtml(title, text) {
  return `
<style>
.ec-cookie-banner { position: fixed; bottom: 0; left: 0; right: 0; background: #0f172a; color: #f8fafc; padding: 20px 24px; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 -4px 20px rgba(0,0,0,.2); }
.ec-cookie-banner__wrap { max-width: 1200px; margin: 0 auto; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.ec-cookie-banner__title { font-weight: 700; margin: 0 0 6px; font-size: 16px; }
.ec-cookie-banner__text { margin: 0; font-size: 14px; line-height: 1.5; color: #cbd5e1; flex: 1; min-width: 260px; }
.ec-cookie-banner__toggles { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.ec-cookie-banner__toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.ec-cookie-banner__toggle input { accent-color: #10b981; cursor: pointer; }
.ec-btn { border: none; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; font-size: 14px; }
.ec-btn--primary { background: #10b981; color: #fff; }
.ec-btn--secondary { background: #334155; color: #f8fafc; }
</style>
<div id="ec-cookie-banner" class="ec-cookie-banner">
  <div class="ec-cookie-banner__wrap">
    <div>
      <p class="ec-cookie-banner__title">${title}</p>
      <p class="ec-cookie-banner__text">${text}</p>
    </div>
    <div class="ec-cookie-banner__toggles">
      <label class="ec-cookie-banner__toggle"><input type="checkbox" checked disabled> Necessary</label>
      <label class="ec-cookie-banner__toggle"><input type="checkbox" id="ec-consent-analytics"> Analytics</label>
      <label class="ec-cookie-banner__toggle"><input type="checkbox" id="ec-consent-marketing"> Marketing</label>
      <button class="ec-btn ec-btn--primary" onclick="ecSaveConsent()">Accept selected</button>
      <button class="ec-btn ec-btn--secondary" onclick="ecRejectConsent()">Reject all</button>
    </div>
  </div>
</div>
<script>
function ecSaveConsent(){ var c={necessary:true, analytics:document.getElementById('ec-consent-analytics').checked, marketing:document.getElementById('ec-consent-marketing').checked}; fetch('/apps/eu-suite/consent?shop='+encodeURIComponent(window.ecShop), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({categories:c})}); document.getElementById('ec-cookie-banner').style.display='none'; }
function ecRejectConsent(){ ecSaveConsent(); }
</script>`;
}

function ageVerifyHtml(title, text) {
  return `
<style>
.ec-age-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.92); z-index: 99999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.ec-age-card { background: #fff; color: #0f172a; padding: 36px; border-radius: 16px; max-width: 420px; width: calc(100% - 32px); text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.ec-age-title { font-size: 22px; font-weight: 800; margin: 0 0 12px; }
.ec-age-text { color: #475569; margin-bottom: 24px; }
.ec-age-input { width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px; font-size: 15px; }
.ec-age-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; background: #10b981; color: #fff; font-weight: 700; cursor: pointer; }
</style>
<div id="ec-age-overlay" class="ec-age-overlay">
  <div class="ec-age-card">
    <p class="ec-age-title">${title}</p>
    <p class="ec-age-text">${text}</p>
    <input type="date" id="ec-age-dob" class="ec-age-input" placeholder="Date of birth">
    <button class="ec-age-btn" onclick="ecVerifyAge()">Enter</button>
  </div>
</div>
<script>
function ecVerifyAge(){ var dob=document.getElementById('ec-age-dob').value; if(!dob) return; fetch('/apps/eu-suite/age-verify?shop='+encodeURIComponent(window.ecShop), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dob:dob})}); document.getElementById('ec-age-overlay').style.display='none'; }
</script>`;
}

function carbonWidgetHtml(label, kg, offset, currency) {
  return `
<style>
.ec-carbon-widget { display: inline-flex; align-items: center; gap: 10px; background: #f0fdf4; color: #065f46; border: 1px solid #a7f3d0; border-radius: 10px; padding: 10px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; }
.ec-carbon-widget__amount { font-weight: 800; }
</style>
<div class="ec-carbon-widget">
  <span>${label}</span>
  <span class="ec-carbon-widget__amount">+${offset} ${currency}</span>
  <span title="${kg} kg CO2e">🌱</span>
</div>`;
}

module.exports = router;
