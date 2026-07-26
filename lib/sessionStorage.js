const fs = require('fs');
const path = require('path');

const sessionsPath = path.join(__dirname, '..', 'data', 'sessions.json');
const dir = path.dirname(sessionsPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(sessionsPath)) fs.writeFileSync(sessionsPath, JSON.stringify({}));

function read() {
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}
function write(data) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
}

class JsonSessionStorage {
  async storeSession(session) {
    const data = read();
    data[session.id] = session;
    write(data);
    return true;
  }

  async loadSession(id) {
    const data = read();
    return data[id] || undefined;
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
    return Object.values(data).filter(s => s.shop === shop);
  }
}

module.exports = { JsonSessionStorage };
