const fs = require('fs');
const path = require('path');
const { Session } = require('@shopify/shopify-api');

const sessionsPath = path.join(__dirname, '..', 'data', 'sessions.json');
const dir = path.dirname(sessionsPath);

try {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(sessionsPath)) fs.writeFileSync(sessionsPath, JSON.stringify({}));
} catch (e) {
  console.error('[SESSION STORAGE] Init failed:', e.message || e);
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    console.error('[SESSION STORAGE] Read failed:', e.message || e);
    return {};
  }
}
function write(data) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[SESSION STORAGE] Write failed:', e.message || e);
  }
}

class JsonSessionStorage {
  async storeSession(session) {
    const data = read();
    data[session.id] = session.toObject();
    write(data);
    return true;
  }

  async loadSession(id) {
    const data = read();
    const sess = data[id];
    return sess ? new Session(sess) : undefined;
  }

  async deleteSession(id) {
    const data = read();
    delete data[id];
    write(data);
    return true;
  }

  async deleteSessions(ids) {
    const data = read();
    ids.forEach(id => delete data[id]);
    write(data);
    return true;
  }

  async findSessionsByShop(shop) {
    const data = read();
    return Object.values(data)
      .filter(s => s.shop === shop)
      .map(s => new Session(s));
  }
}

module.exports = { JsonSessionStorage };
