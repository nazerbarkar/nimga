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

  db.run("CREATE TABLE IF NOT EXISTS users (wallet_address TEXT PRIMARY KEY, free_used INTEGER DEFAULT 0, credits REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, prompt TEXT NOT NULL, image_url TEXT, votes INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, amount REAL NOT NULL, credits_added REAL NOT NULL, tx_hash TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS votes (id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, wallet_address TEXT NOT NULL, value INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(generation_id, wallet_address))");

  // Migration: add votes column to existing generations table
  try { db.run("ALTER TABLE generations ADD COLUMN votes INTEGER DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE generations ADD COLUMN visibility TEXT DEFAULT 'public'"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_gen_wallet ON votes(generation_id, wallet_address)"); } catch (_) {}

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
  if (!user) return 3;
  return Math.max(0, 3 - user.free_used);
}

function useFreeGeneration(walletAddress) {
  const user = getUser(walletAddress);
  if (!user || user.free_used >= 3) return false;
  execute('UPDATE users SET free_used = free_used + 1 WHERE wallet_address = ?', [walletAddress]);
  return true;
}

function useCredit(walletAddress) {
  const user = getUser(walletAddress);
  if (!user || user.credits < 1) return false;
  execute('UPDATE users SET credits = credits - 1 WHERE wallet_address = ?', [walletAddress]);
  return true;
}

function addCredits(walletAddress, amount, credits) {
  execute('UPDATE users SET credits = credits + ? WHERE wallet_address = ?', [credits, walletAddress]);
  const txId = uuidv4();
  execute('INSERT INTO transactions (id, wallet_address, amount, credits_added, status) VALUES (?, ?, ?, ?, ?)',
    [txId, walletAddress, amount, credits, 'completed']);
  return txId;
}

function saveGeneration(walletAddress, prompt, imageUrl, visibility = 'public') {
  const id = uuidv4();
  execute('INSERT INTO generations (id, wallet_address, prompt, image_url, visibility) VALUES (?, ?, ?, ?, ?)',
    [id, walletAddress, prompt, imageUrl, visibility]);
  return id;
}

function getGenerations(walletAddress, limit = 50) {
  return query('SELECT * FROM generations WHERE wallet_address = ? ORDER BY created_at DESC LIMIT ?',
    [walletAddress, limit]);
}

function getGalleryNew(limit = 50, offset = 0) {
  return query('SELECT id, image_url, votes, wallet_address, created_at FROM generations WHERE visibility = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', ['public', limit, offset]);
}

function getGalleryTop(limit = 50, offset = 0) {
  return query('SELECT id, image_url, votes, wallet_address, created_at FROM generations WHERE visibility = ? ORDER BY votes DESC, created_at DESC LIMIT ? OFFSET ?', ['public', limit, offset]);
}

function voteGeneration(generationId, walletAddress, value) {
  const existing = query('SELECT * FROM votes WHERE generation_id = ? AND wallet_address = ?', [generationId, walletAddress]);
  if (existing.length > 0) {
    if (existing[0].value === value) {
      execute('DELETE FROM votes WHERE generation_id = ? AND wallet_address = ?', [generationId, walletAddress]);
      execute('UPDATE generations SET votes = votes - ? WHERE id = ?', [value, generationId]);
      return 0;
    } else {
      execute('UPDATE votes SET value = ? WHERE generation_id = ? AND wallet_address = ?', [value, generationId, walletAddress]);
      execute('UPDATE generations SET votes = votes + ? WHERE id = ?', [value * 2, generationId]);
      return value;
    }
  } else {
    execute('INSERT INTO votes (id, generation_id, wallet_address, value) VALUES (?, ?, ?, ?)',
      [uuidv4(), generationId, walletAddress, value]);
    execute('UPDATE generations SET votes = votes + ? WHERE id = ?', [value, generationId]);
    return value;
  }
}

function getUserVote(generationId, walletAddress) {
  if (!walletAddress) return 0;
  const rows = query('SELECT value FROM votes WHERE generation_id = ? AND wallet_address = ?', [generationId, walletAddress]);
  return rows.length > 0 ? rows[0].value : 0;
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

function reverseCredit(walletAddress) {
  execute('UPDATE users SET credits = credits + 1 WHERE wallet_address = ?', [walletAddress]);
}

module.exports = {
  initDb,
  getOrCreateUser,
  getUser,
  getRemainingFree,
  useFreeGeneration,
  useCredit,
  addCredits,
  saveGeneration,
  getGenerations,
  getGalleryNew,
  getGalleryTop,
  voteGeneration,
  getUserVote,
  getStats,
  reverseFreeGeneration,
  reverseCredit,
  query,
  execute
};
