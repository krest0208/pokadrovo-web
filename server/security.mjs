import { randomBytes, createHash, createHmac, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('base64url');
export const digest = v => createHash('sha256').update(String(v)).digest('hex');
export const equal = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 14 || Buffer.byteLength(password) > 512)
    throw new Error('Пароль должен содержать от 14 символов и не более 512 байт. Используйте уникальную парольную фразу.');
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 512) return false;
  const [name, n, r, p, salt, expected] = String(encoded).split('$');
  if (name !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  let bits = 0, value = 0, result = '';
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return result;
}
function base32(text) {
  let value = 0, bits = 0; const bytes = [];
  for (const c of text) { const n = alphabet.indexOf(c); if (n < 0) throw Error('Invalid TOTP secret'); value = (value << 5) | n; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
export function totp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(secret)).update(buf).digest();
  const i = h[19] & 15;
  return String((h.readUInt32BE(i) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function verifyTotp(secret, code, time = Date.now(), previous = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = Math.floor(time / 30000);
  for (const k of [step, step - 1, step + 1]) if (k > previous && equal(totp(secret, k), code)) return k;
  return null;
}

export function openStore(directory) {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* Windows ACLs are managed by the OS. */ }
  const keyFile = join(dir, 'master.key'), dbFile = join(dir, 'owner.sqlite');
  // Never regenerate a lost encryption key against an existing database.
  if (existsSync(dbFile) && !existsSync(keyFile)) throw Error('Missing master.key: restore the private backup before starting.');
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw Error('Invalid private encryption key');
  const db = new DatabaseSync(dbFile);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1), login TEXT NOT NULL, password TEXT NOT NULL, totp TEXT, last_step INTEGER NOT NULL DEFAULT -1, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, csrf TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires INTEGER NOT NULL, pending_totp TEXT, pending_until INTEGER);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL DEFAULT 'openai', model TEXT NOT NULL DEFAULT '', secret TEXT, updated INTEGER NOT NULL DEFAULT 0, analytics INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS rates(id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, visitor TEXT NOT NULL, project TEXT, mode TEXT, format TEXT, source TEXT, device TEXT);
    CREATE INDEX IF NOT EXISTS events_at ON events(at);
    CREATE TABLE IF NOT EXISTS page_days(day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  try { chmodSync(dbFile, 0o600); } catch {}
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  const get = (sql, ...values) => db.prepare(sql).get(...values);
  const all = (sql, ...values) => db.prepare(sql).all(...values);
  run('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)', 'started', String(Date.now()));
  const hmac = v => createHmac('sha256', key).update(String(v)).digest('hex');
  const seal = text => {
    const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from('pokadrovo-admin-v1'));
    const bytes = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return [iv.toString('base64url'), c.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.');
  };
  const unseal = text => {
    const [iv, tag, bytes] = String(text).split('.');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from('pokadrovo-admin-v1')); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(bytes, 'base64url')), d.final()]).toString('utf8');
  };
  const audit = (action, result, now = Date.now()) => run('INSERT INTO audit(at,action,result) VALUES(?,?,?)', now, action, result);
  const consume = (id, limit, span, now) => {
    const value = get('SELECT * FROM rates WHERE id=?', id);
    if (!value || value.reset <= now) { run('INSERT OR REPLACE INTO rates(id,attempts,reset) VALUES(?,?,?)', id, 1, now + span); return true; }
    if (value.attempts >= limit) return false;
    run('UPDATE rates SET attempts=attempts+1 WHERE id=?', id); return true;
  };
  const cleanup = (now = Date.now()) => {
    run('DELETE FROM sessions WHERE expires<=? OR last_seen<?', now, now - 30 * 60 * 1000);
    run('DELETE FROM rates WHERE reset<?', now);
    run('DELETE FROM events WHERE at<?', now - 90 * 86400000);
    run('DELETE FROM audit WHERE at<?', now - 180 * 86400000);
    run('DELETE FROM page_days WHERE day<?', new Date(now - 365 * 86400000).toISOString().slice(0, 10));
  };
  return { db, dir, run, get, all, hmac, seal, unseal, audit, consume, cleanup, close: () => db.close() };
}

export async function provisionOwner(store, login, password, replace = false) {
  if (typeof login !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(login)) throw Error('Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание.');
  const encoded = await hashPassword(password);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    if (store.get('SELECT id FROM owner WHERE id=1') && !replace) throw Error('Владелец уже настроен. Для восстановления используйте --reset.');
    store.run('INSERT OR REPLACE INTO owner(id,login,password,created,last_step) VALUES(1,?,?,?,-1)', login, encoded, Date.now());
    store.run('DELETE FROM sessions'); store.run('DELETE FROM rates'); store.audit(replace ? 'owner_reset' : 'owner_created', 'ok');
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
}
