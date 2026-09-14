const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data.db');
let db;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("CREATE TABLE IF NOT EXISTS users (wallet_address TEXT PRIMARY KEY, free_used INTEGER DEFAULT 0, free_video_used INTEGER DEFAULT 0, credits REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, prompt TEXT NOT NULL, image_url TEXT, video_url TEXT, type TEXT DEFAULT 'text-to-image', visibility TEXT DEFAULT 'public', created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, amount REAL NOT NULL, credits_added REAL NOT NULL, tx_hash TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)");

  // Migrations
  try { db.run("ALTER TABLE generations ADD COLUMN video_url TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE generations ADD COLUMN type TEXT DEFAULT 'text-to-image'"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN free_video_used INTEGER DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN free_i2v_used INTEGER DEFAULT 0"); } catch (_) {}

  saveDb();
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function execute(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function getOrCreateUser(walletAddress) {
  let rows = query('SELECT * FROM users WHERE wallet_address = ?', [walletAddress]);
  if (rows.length === 0) {
    execute('INSERT INTO users (wallet_address) VALUES (?)', [walletAddress]);
    rows = query('SELECT * FROM users WHERE wallet_address = ?', [walletAddress]);
  } else {
    execute('UPDATE users SET last_login = datetime("now") WHERE wallet_address = ?', [walletAddress]);
  }
  return rows[0];
}

function getUser(walletAddress) {
  const rows = query('SELECT * FROM users WHERE wallet_address = ?', [walletAddress]);
  return rows.length > 0 ? rows[0] : null;
}

function getRemainingFree(walletAddress) {
  const user = getUser(walletAddress);
  if (!user) return 1;
  return Math.max(0, 1 - user.free_used);
}

function getRemainingFreeVideo(walletAddress) {
  const user = getUser(walletAddress);
  if (!user) return 1;
  return Math.max(0, 1 - user.free_video_used);
}

function getRemainingFreeI2V(walletAddress) {
  const user = getUser(walletAddress);
  if (!user) return 1;
  return Math.max(0, 1 - user.free_i2v_used);
}

function useFreeGeneration(walletAddress) {
  const user = getUser(walletAddress);
  if (!user || user.free_used >= 1) return false;
  execute('UPDATE users SET free_used = free_used + 1 WHERE wallet_address = ?', [walletAddress]);
  return true;
}

function useFreeVideoGeneration(walletAddress) {
  const user = getUser(walletAddress);
  if (!user || user.free_video_used >= 1) return false;
  execute('UPDATE users SET free_video_used = free_video_used + 1 WHERE wallet_address = ?', [walletAddress]);
  return true;
}

function useFreeI2VGeneration(walletAddress) {
  const user = getUser(walletAddress);
  if (!user || user.free_i2v_used >= 1) return false;
  execute('UPDATE users SET free_i2v_used = free_i2v_used + 1 WHERE wallet_address = ?', [walletAddress]);
  return true;
}

function useCredit(walletAddress, amount = 1) {
  const user = getUser(walletAddress);
  if (!user || user.credits < amount) return false;
  execute('UPDATE users SET credits = credits - ? WHERE wallet_address = ?', [amount, walletAddress]);
  return true;
}

function addCredits(walletAddress, amount, credits) {
  execute('UPDATE users SET credits = credits + ? WHERE wallet_address = ?', [credits, walletAddress]);
  const txId = uuidv4();
  execute('INSERT INTO transactions (id, wallet_address, amount, credits_added, status) VALUES (?, ?, ?, ?, ?)',
    [txId, walletAddress, amount, credits, 'completed']);
  return txId;
}

function saveGeneration(walletAddress, prompt, imageUrl, visibility = 'public', type = 'text-to-image', videoUrl = null) {
  const id = uuidv4();
  execute('INSERT INTO generations (id, wallet_address, prompt, image_url, video_url, type, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, walletAddress, prompt, imageUrl, videoUrl, type, visibility]);
  return id;
}

function getGenerations(walletAddress, limit = 50) {
  return query('SELECT * FROM generations WHERE wallet_address = ? ORDER BY created_at DESC LIMIT ?',
    [walletAddress, limit]);
}

function getGallery(limit = 50, offset = 0) {
  return query('SELECT id, image_url, video_url, type, wallet_address, created_at FROM generations WHERE visibility = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', ['public', limit, offset]);
}

function getStats() {
  const users = query('SELECT COUNT(*) as count FROM users');
  const totalImages = query('SELECT COUNT(*) as count FROM generations');
  return {
    totalUsers: users[0]?.count || 0,
    totalGenerations: totalImages[0]?.count || 0,
  };
}

function reverseFreeGeneration(walletAddress) {
  execute('UPDATE users SET free_used = MAX(0, free_used - 1) WHERE wallet_address = ?', [walletAddress]);
}

function reverseFreeVideoGeneration(walletAddress) {
  execute('UPDATE users SET free_video_used = MAX(0, free_video_used - 1) WHERE wallet_address = ?', [walletAddress]);
}

function reverseFreeI2VGeneration(walletAddress) {
  execute('UPDATE users SET free_i2v_used = MAX(0, free_i2v_used - 1) WHERE wallet_address = ?', [walletAddress]);
}

function reverseCredit(walletAddress, amount = 1) {
  execute('UPDATE users SET credits = credits + ? WHERE wallet_address = ?', [amount, walletAddress]);
}

module.exports = {
  initDb,
  getOrCreateUser,
  getUser,
  getRemainingFree,
  getRemainingFreeVideo,
  getRemainingFreeI2V,
  useFreeGeneration,
  useFreeVideoGeneration,
  useFreeI2VGeneration,
  useCredit,
  addCredits,
  saveGeneration,
  getGenerations,
  getGallery,
  getStats,
  reverseFreeGeneration,
  reverseFreeVideoGeneration,
  reverseFreeI2VGeneration,
  reverseCredit,
  query,
  execute
};
