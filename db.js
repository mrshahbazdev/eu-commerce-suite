require('dotenv').config();
const fs = require('fs');
const path = require('path');

let mysql;
let pool;
let jsonDb;

const useMysql = process.env.DB_HOST && process.env.DB_DATABASE;

if (useMysql) {
  try {
    mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  } catch (e) {
    console.warn('mysql2 not installed, falling back to JSON file storage:', e.message);
  }
}

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const fileFor = (name) => {
  const p = path.join(dbDir, `${name}.json`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify([]));
  return p;
};

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2));

const tables = {
  settings: fileFor('settings'),
  cookieConsents: fileFor('cookie_consents'),
  dataRequests: fileFor('data_requests'),
  legalPages: fileFor('legal_pages'),
  ageVerifications: fileFor('age_verifications'),
  vatSettings: fileFor('vat_settings'),
  carbonSettings: fileFor('carbon_settings'),
  carbonOrders: fileFor('carbon_orders'),
  courierSettings: fileFor('courier_settings'),
  sustainabilityReports: fileFor('sustainability_reports'),
  cookieScanResults: fileFor('cookie_scan_results'),
  consentLogs: fileFor('consent_logs'),
};

jsonDb = {
  read: (name) => read(tables[name]),
  write: (name, data) => write(tables[name], data),
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

async function initTables() {
  if (!pool) return;

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      shop VARCHAR(80) PRIMARY KEY,
      settings LONGTEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS consent_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      customer_id VARCHAR(80),
      categories LONGTEXT,
      ip VARCHAR(45),
      user_agent LONGTEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS data_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      email VARCHAR(255) NOT NULL,
      type ENUM('export', 'delete') NOT NULL,
      status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
      result LONGTEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      INDEX idx_shop (shop)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS legal_pages (
      shop VARCHAR(80) PRIMARY KEY,
      privacy_policy LONGTEXT,
      terms LONGTEXT,
      impressum LONGTEXT,
      widerruf LONGTEXT,
      agb LONGTEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS age_verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      customer_id VARCHAR(80),
      dob DATE,
      ip VARCHAR(45),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS vat_settings (
      shop VARCHAR(80) PRIMARY KEY,
      enabled TINYINT DEFAULT 0,
      io_ss_number VARCHAR(50),
      default_rate DECIMAL(5,2) DEFAULT 19.00,
      country_rates LONGTEXT,
      display_label VARCHAR(255),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS carbon_settings (
      shop VARCHAR(80) PRIMARY KEY,
      enabled TINYINT DEFAULT 0,
      kg_co2_per_order DECIMAL(10,4) DEFAULT 2.5,
      per_kg_factor DECIMAL(10,4) DEFAULT 0.5,
      offset_rate_per_kg DECIMAL(10,4) DEFAULT 0.12,
      currency VARCHAR(3) DEFAULT 'EUR',
      label VARCHAR(255) DEFAULT 'Make it carbon neutral',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS carbon_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      order_id VARCHAR(80),
      kg_co2 DECIMAL(10,4),
      offset_amount DECIMAL(10,2),
      currency VARCHAR(3),
      status VARCHAR(20) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS courier_settings (
      shop VARCHAR(80) PRIMARY KEY,
      enabled TINYINT DEFAULT 0,
      dpd_enabled TINYINT DEFAULT 0,
      gls_enabled TINYINT DEFAULT 0,
      dhl_enabled TINYINT DEFAULT 0,
      dpd_api_key VARCHAR(255),
      gls_api_key VARCHAR(255),
      dhl_api_key VARCHAR(255),
      settings LONGTEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cookie_scan_results (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      url VARCHAR(255),
      cookies LONGTEXT,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sustainability_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop VARCHAR(80) NOT NULL,
      period_start DATE,
      period_end DATE,
      kg_co2_offset DECIMAL(12,4) DEFAULT 0,
      offsets_sold INT DEFAULT 0,
      report_data LONGTEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop)
    )
  `);
}

const db = {
  init: async () => {
    if (!pool) return;
    try { await initTables(); } catch (err) {
      console.error('[DB INIT ERROR] MySQL init failed, falling back to JSON:', err.message || err);
      pool = null;
    }
  },

  _getSettings: async (shop) => {
    if (!pool) return jsonDb.read('settings').find(s => s.shop === shop)?.settings || {};
    const [rows] = await pool.execute('SELECT settings FROM settings WHERE shop = ?', [shop]);
    return rows[0] ? JSON.parse(rows[0].settings || '{}') : {};
  },

  _saveSettings: async (shop, settings) => {
    if (!pool) {
      const list = jsonDb.read('settings');
      const idx = list.findIndex(s => s.shop === shop);
      if (idx >= 0) list[idx].settings = settings; else list.push({ shop, settings });
      jsonDb.write('settings', list);
      return;
    }
    await pool.execute(
      'INSERT INTO settings (shop, settings) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings=VALUES(settings)',
      [shop, JSON.stringify(settings)]
    );
  },

  saveCookieConsent: async (shop, data) => {
    const row = { id: uid(), shop, ...data, created_at: new Date().toISOString() };
    if (!pool) {
      const list = jsonDb.read('consent_logs'); list.push(row); jsonDb.write('consent_logs', list); return row;
    }
    const res = await pool.execute(
      'INSERT INTO consent_logs (shop, customer_id, categories, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
      [shop, data.customer_id || '', JSON.stringify(data.categories || {}), data.ip || '', data.user_agent || '']
    );
    row.id = res[0].insertId; return row;
  },

  getConsentLogs: async (shop, { limit = 50 } = {}) => {
    if (!pool) return jsonDb.read('consent_logs').filter(r => r.shop === shop).slice(0, limit);
    const [rows] = await pool.execute('SELECT * FROM consent_logs WHERE shop = ? ORDER BY created_at DESC LIMIT ?', [shop, limit]);
    return rows.map(r => ({ ...r, categories: JSON.parse(r.categories || '{}') }));
  },

  createDataRequest: async (shop, { email, type }) => {
    const row = { id: uid(), shop, email, type, status: 'pending', created_at: new Date().toISOString() };
    if (!pool) {
      const list = jsonDb.read('data_requests'); list.push(row); jsonDb.write('data_requests', list); return row;
    }
    const res = await pool.execute('INSERT INTO data_requests (shop, email, type) VALUES (?, ?, ?)', [shop, email, type]);
    row.id = res[0].insertId; return row;
  },

  getDataRequests: async (shop) => {
    if (!pool) return jsonDb.read('data_requests').filter(r => r.shop === shop);
    const [rows] = await pool.execute('SELECT * FROM data_requests WHERE shop = ? ORDER BY created_at DESC', [shop]);
    return rows;
  },

  updateDataRequest: async (shop, id, status, result) => {
    if (!pool) {
      const list = jsonDb.read('data_requests');
      const r = list.find(x => x.shop === shop && String(x.id) === String(id));
      if (r) { r.status = status; r.result = result; r.completed_at = new Date().toISOString(); jsonDb.write('data_requests', list); }
      return;
    }
    await pool.execute('UPDATE data_requests SET status = ?, result = ?, completed_at = NOW() WHERE shop = ? AND id = ?', [status, result, shop, id]);
  },

  getLegalPages: async (shop) => {
    if (!pool) return jsonDb.read('legalPages').find(r => r.shop === shop) || {};
    const [rows] = await pool.execute('SELECT * FROM legal_pages WHERE shop = ?', [shop]);
    return rows[0] || {};
  },

  saveLegalPages: async (shop, pages) => {
    if (!pool) {
      const list = jsonDb.read('legalPages');
      const idx = list.findIndex(r => r.shop === shop);
      if (idx >= 0) list[idx] = { ...list[idx], ...pages, shop }; else list.push({ ...pages, shop });
      jsonDb.write('legalPages', list); return;
    }
    const cols = Object.keys(pages).filter(k => k !== 'shop');
    if (!cols.length) return;
    const fields = cols.join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const update = cols.map(c => `${c}=VALUES(${c})`).join(', ');
    await pool.execute(
      `INSERT INTO legal_pages (shop, ${fields}) VALUES (?, ${placeholders}) ON DUPLICATE KEY UPDATE ${update}`,
      [shop, ...Object.values(pages)]
    );
  },

  logAgeVerification: async (shop, data) => {
    const row = { id: uid(), shop, ...data, created_at: new Date().toISOString() };
    if (!pool) { const list = jsonDb.read('age_verifications'); list.push(row); jsonDb.write('age_verifications', list); return row; }
    const res = await pool.execute('INSERT INTO age_verifications (shop, customer_id, dob, ip) VALUES (?, ?, ?, ?)', [shop, data.customer_id || '', data.dob || null, data.ip || '']);
    row.id = res[0].insertId; return row;
  },

  getAgeVerifications: async (shop) => {
    if (!pool) return jsonDb.read('age_verifications').filter(r => r.shop === shop);
    const [rows] = await pool.execute('SELECT * FROM age_verifications WHERE shop = ? ORDER BY created_at DESC', [shop]);
    return rows;
  },

  getVatSettings: async (shop) => {
    if (!pool) return jsonDb.read('vat_settings').find(r => r.shop === shop) || { enabled: 0 };
    const [rows] = await pool.execute('SELECT * FROM vat_settings WHERE shop = ?', [shop]);
    if (!rows[0]) return { enabled: 0 };
    return { ...rows[0], country_rates: JSON.parse(rows[0].country_rates || '{}') };
  },

  saveVatSettings: async (shop, settings) => {
    const countryRates = JSON.stringify(settings.country_rates || {});
    if (!pool) {
      const list = jsonDb.read('vat_settings');
      const idx = list.findIndex(r => r.shop === shop);
      if (idx >= 0) list[idx] = { ...list[idx], ...settings, country_rates: settings.country_rates }; else list.push({ ...settings, shop });
      jsonDb.write('vat_settings', list); return;
    }
    await pool.execute(
      'INSERT INTO vat_settings (shop, enabled, io_ss_number, default_rate, country_rates, display_label) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), io_ss_number=VALUES(io_ss_number), default_rate=VALUES(default_rate), country_rates=VALUES(country_rates), display_label=VALUES(display_label)',
      [shop, settings.enabled ? 1 : 0, settings.io_ss_number || '', settings.default_rate || 19.00, countryRates, settings.display_label || 'VAT included']
    );
  },

  getCarbonSettings: async (shop) => {
    if (!pool) return jsonDb.read('carbon_settings').find(r => r.shop === shop) || { enabled: 0 };
    const [rows] = await pool.execute('SELECT * FROM carbon_settings WHERE shop = ?', [shop]);
    return rows[0] || { enabled: 0 };
  },

  saveCarbonSettings: async (shop, settings) => {
    if (!pool) {
      const list = jsonDb.read('carbon_settings');
      const idx = list.findIndex(r => r.shop === shop);
      if (idx >= 0) list[idx] = { ...list[idx], ...settings, shop }; else list.push({ ...settings, shop });
      jsonDb.write('carbon_settings', list); return;
    }
    await pool.execute(
      'INSERT INTO carbon_settings (shop, enabled, kg_co2_per_order, per_kg_factor, offset_rate_per_kg, currency, label) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), kg_co2_per_order=VALUES(kg_co2_per_order), per_kg_factor=VALUES(per_kg_factor), offset_rate_per_kg=VALUES(offset_rate_per_kg), currency=VALUES(currency), label=VALUES(label)',
      [shop, settings.enabled ? 1 : 0, settings.kg_co2_per_order || 2.5, settings.per_kg_factor || 0.5, settings.offset_rate_per_kg || 0.12, settings.currency || 'EUR', settings.label || 'Make it carbon neutral']
    );
  },

  createCarbonOrder: async (shop, data) => {
    const row = { id: uid(), shop, ...data, created_at: new Date().toISOString() };
    if (!pool) { const list = jsonDb.read('carbon_orders'); list.push(row); jsonDb.write('carbon_orders', list); return row; }
    const res = await pool.execute('INSERT INTO carbon_orders (shop, order_id, kg_co2, offset_amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)', [shop, data.order_id || '', data.kg_co2 || 0, data.offset_amount || 0, data.currency || 'EUR', data.status || 'pending']);
    row.id = res[0].insertId; return row;
  },

  getCarbonOrders: async (shop) => {
    if (!pool) return jsonDb.read('carbon_orders').filter(r => r.shop === shop);
    const [rows] = await pool.execute('SELECT * FROM carbon_orders WHERE shop = ? ORDER BY created_at DESC', [shop]);
    return rows;
  },

  getCourierSettings: async (shop) => {
    if (!pool) return jsonDb.read('courier_settings').find(r => r.shop === shop) || {};
    const [rows] = await pool.execute('SELECT * FROM courier_settings WHERE shop = ?', [shop]);
    if (!rows[0]) return {};
    return { ...rows[0], settings: JSON.parse(rows[0].settings || '{}') };
  },

  saveCourierSettings: async (shop, settings) => {
    const extra = JSON.stringify(settings.settings || {});
    if (!pool) {
      const list = jsonDb.read('courier_settings');
      const idx = list.findIndex(r => r.shop === shop);
      if (idx >= 0) list[idx] = { ...list[idx], ...settings, shop }; else list.push({ ...settings, shop });
      jsonDb.write('courier_settings', list); return;
    }
    await pool.execute(
      'INSERT INTO courier_settings (shop, enabled, dpd_enabled, gls_enabled, dhl_enabled, dpd_api_key, gls_api_key, dhl_api_key, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), dpd_enabled=VALUES(dpd_enabled), gls_enabled=VALUES(gls_enabled), dhl_enabled=VALUES(dhl_enabled), dpd_api_key=VALUES(dpd_api_key), gls_api_key=VALUES(gls_api_key), dhl_api_key=VALUES(dhl_api_key), settings=VALUES(settings)',
      [shop, settings.enabled ? 1 : 0, settings.dpd_enabled ? 1 : 0, settings.gls_enabled ? 1 : 0, settings.dhl_enabled ? 1 : 0, settings.dpd_api_key || '', settings.gls_api_key || '', settings.dhl_api_key || '', extra]
    );
  },

  saveCookieScan: async (shop, { url, cookies }) => {
    const row = { id: uid(), shop, url, cookies, scanned_at: new Date().toISOString() };
    if (!pool) { const list = jsonDb.read('cookie_scan_results'); list.push(row); jsonDb.write('cookie_scan_results', list); return row; }
    const res = await pool.execute('INSERT INTO cookie_scan_results (shop, url, cookies) VALUES (?, ?, ?)', [shop, url, JSON.stringify(cookies || [])]);
    row.id = res[0].insertId; return row;
  },

  getCookieScans: async (shop) => {
    if (!pool) return jsonDb.read('cookie_scan_results').filter(r => r.shop === shop);
    const [rows] = await pool.execute('SELECT * FROM cookie_scan_results WHERE shop = ? ORDER BY scanned_at DESC', [shop]);
    return rows.map(r => ({ ...r, cookies: JSON.parse(r.cookies || '[]') }));
  },

  createSustainabilityReport: async (shop, data) => {
    const row = { id: uid(), shop, ...data, created_at: new Date().toISOString() };
    if (!pool) { const list = jsonDb.read('sustainability_reports'); list.push(row); jsonDb.write('sustainability_reports', list); return row; }
    const res = await pool.execute('INSERT INTO sustainability_reports (shop, period_start, period_end, kg_co2_offset, offsets_sold, report_data) VALUES (?, ?, ?, ?, ?, ?)', [shop, data.period_start, data.period_end, data.kg_co2_offset || 0, data.offsets_sold || 0, JSON.stringify(data.report_data || {})]);
    row.id = res[0].insertId; return row;
  },

  getSustainabilityReports: async (shop) => {
    if (!pool) return jsonDb.read('sustainability_reports').filter(r => r.shop === shop);
    const [rows] = await pool.execute('SELECT * FROM sustainability_reports WHERE shop = ? ORDER BY created_at DESC', [shop]);
    return rows.map(r => ({ ...r, report_data: JSON.parse(r.report_data || '{}') }));
  },
};

module.exports = db;
