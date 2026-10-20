import { createHash } from 'node:crypto';
import { token, equal } from './security.mjs';
import { body, deny, json } from './http.mjs';
import { checkSite } from './site-checks.mjs';
import { BUILTIN_IDEAS, PUBLIC_FEATURES } from './site-ideas.mjs';

export const SITE_AGENT_HOUR = 3600000;
const nextHour = time => (Math.floor(time / SITE_AGENT_HOUR) + 1) * SITE_AGENT_HOUR;
const reportId = value => typeof value === 'string' && /^[1-9]\d{0,12}$/.test(value);

/** One owner inbox, persistent hourly schedule and a recoverable lease; no external messaging account. */
export function createSiteAgent({ store, now, origin, session, sameOrigin, facts, suggestIdeas, request = globalThis.fetch, autoStart = true }) {
  const defaultEnabled = new URL(origin).hostname === 'pokadrovo.ru';
  store.db.exec(`CREATE TABLE IF NOT EXISTS site_agent_state(
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0, use_ai INTEGER NOT NULL DEFAULT 1,
    next_run INTEGER NOT NULL DEFAULT 0, last_run INTEGER, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
    ai_status TEXT NOT NULL DEFAULT 'not-configured');
    CREATE TABLE IF NOT EXISTS site_agent_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,slot TEXT NOT NULL UNIQUE,at INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,read_at INTEGER);
    CREATE TABLE IF NOT EXISTS site_agent_findings(key TEXT PRIMARY KEY,title TEXT NOT NULL,evidence TEXT NOT NULL,severity TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'open');
    CREATE TABLE IF NOT EXISTS site_agent_ideas(key TEXT PRIMARY KEY,title TEXT NOT NULL,details TEXT NOT NULL,basis TEXT NOT NULL,source TEXT NOT NULL,first_at INTEGER NOT NULL,delivered_at INTEGER,state TEXT NOT NULL DEFAULT 'new');
    CREATE INDEX IF NOT EXISTS site_agent_report_unread ON site_agent_reports(read_at,id);`);
  store.run('INSERT OR IGNORE INTO site_agent_state(id,enabled,next_run) VALUES(1,?,?)', Number(defaultEnabled), now() + 60000);
  let timer, stopped = false, schedulerActive = false, activeController = null, activeLease = null;
  const row = () => store.get('SELECT * FROM site_agent_state WHERE id=1');
  const ownsLease = lease => !stopped && row().lease_token === lease;
  function status() {
    const state = row(), last = store.get('SELECT id,at,status FROM site_agent_reports ORDER BY id DESC LIMIT 1');
    return { enabled: !!state.enabled, useAi: !!state.use_ai, scheduleMinutes: 60, schedulerActive,
      nextRun: state.enabled ? state.next_run : null, lastRun: state.last_run, running: state.lease_until > now(),
      unread: store.get('SELECT count(*) AS n FROM site_agent_reports WHERE read_at IS NULL').n,
      lastReport: last || null, aiStatus: state.ai_status, aiDailyMaximum: 1, retentionDays: 90,
      openFindings: store.get("SELECT count(*) AS n FROM site_agent_findings WHERE state='open'").n,
      recipient: 'owner', delivery: 'site-account', target: origin };
  }
  function settings(data) {
    if (typeof data.enabled !== 'boolean' || typeof data.useAi !== 'boolean') deny(400, 'Проверьте переключатели агента.');
    const old = row(); store.run('UPDATE site_agent_state SET enabled=?,use_ai=?,next_run=? WHERE id=1', Number(data.enabled), Number(data.useAi), data.enabled && !old.enabled ? now() + 60000 : old.next_run);
    store.audit('site_agent_settings', 'ok', now()); return status();
  }
  function reports(before) {
    if (before !== undefined && !reportId(before)) deny(400, 'Некорректная страница сообщений.');
    const rows = before ? store.all('SELECT * FROM site_agent_reports WHERE id<? ORDER BY id DESC LIMIT 21', Number(before)) : store.all('SELECT * FROM site_agent_reports ORDER BY id DESC LIMIT 21');
    const items = rows.slice(0, 20).map(r => ({ id: r.id, at: r.at, status: r.status, read: r.read_at !== null, ...JSON.parse(r.payload) }));
    return { items, nextBefore: rows.length > 20 ? String(items.at(-1).id) : null, status: status() };
  }
  function ideas() { return { items: store.all('SELECT key,title,details,basis,source,delivered_at AS at,state FROM site_agent_ideas WHERE delivered_at IS NOT NULL ORDER BY delivered_at DESC LIMIT 100') }; }
  function read(id) {
    if (!reportId(id)) deny(400, 'Некорректное сообщение.');
    const found = store.get('SELECT id FROM site_agent_reports WHERE id=?', Number(id)); if (!found) deny(404, 'Сообщение не найдено.');
    store.run('UPDATE site_agent_reports SET read_at=coalesce(read_at,?) WHERE id=?', now(), Number(id)); return { ok: true, unread: status().unread };
  }
  function seedIdeas(items, source) {
    const normalize = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    const known = new Set(store.all('SELECT title FROM site_agent_ideas').map(i => normalize(i.title)));
    for (const item of items) {
      if (known.has(normalize(item.title))) continue; known.add(normalize(item.title));
      const key = source === 'ai' ? 'ai:' + createHash('sha256').update(item.title.trim().toLowerCase()).digest('hex').slice(0, 32) : item.key;
      store.run('INSERT OR IGNORE INTO site_agent_ideas(key,title,details,basis,source,first_at) VALUES(?,?,?,?,?,?)', key, item.title, item.details, item.basis, source, now());
    }
  }
  function updateFindings(report) {
    const fresh = [], resolved = [];
    for (const finding of report.findings) {
      const old = store.get('SELECT state FROM site_agent_findings WHERE key=?', finding.key);
      if (!old || old.state !== 'open') fresh.push(finding.key);
      store.run("INSERT INTO site_agent_findings(key,title,evidence,severity,first_at,last_at,state) VALUES(?,?,?,?,?,?,'open') ON CONFLICT(key) DO UPDATE SET title=excluded.title,evidence=excluded.evidence,severity=excluded.severity,last_at=excluded.last_at,state='open'", finding.key, finding.title, finding.evidence, finding.severity, now(), now());
    }
    const observed = new Map(report.checks.map(c => [c.key, c.status]));
    const buildObserved = observed.get('home-http') === 'ok' && observed.get('build-entry') === 'ok';
    for (const old of store.all("SELECT key,title FROM site_agent_findings WHERE state='open'")) {
      if (observed.get(old.key) === 'ok' || buildObserved && old.key.startsWith('asset:') && !observed.has(old.key)) {
        store.run("UPDATE site_agent_findings SET state='resolved',last_at=? WHERE key=?", now(), old.key); resolved.push({ key: old.key, title: old.title });
      }
    }
    return { newFindingKeys: fresh, resolvedFindings: resolved };
  }
  async function run(manual = false) {
    if (stopped) return null;
    const lease = token(); let slot;
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const state = row();
      if (state.lease_until > now() || !manual && (!state.enabled || state.next_run > now())) { store.db.exec('COMMIT'); return null; }
      slot = manual ? 'manual:' + lease : 'hour:' + Math.floor(state.next_run / SITE_AGENT_HOUR);
      if (!manual && store.get('SELECT id FROM site_agent_reports WHERE slot=?', slot)) { store.run('UPDATE site_agent_state SET next_run=? WHERE id=1', nextHour(now())); store.db.exec('COMMIT'); return null; }
      store.run('UPDATE site_agent_state SET lease_token=?,lease_until=? WHERE id=1', lease, now() + 180000); store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    const controller = new AbortController(), startedAt = Date.now(); activeController = controller; activeLease = lease;
    const timeout = setTimeout(() => controller.abort(), 120000); timeout.unref?.();
    try {
      const meta = facts();
      const result = await checkSite({ origin, request, signal: controller.signal, facts: meta });
      if (!ownsLease(lease)) return null;
      let aiState = row().use_ai ? 'not-configured' : 'disabled';
      if (row().use_ai && meta.aiConfigured && suggestIdeas && !controller.signal.aborted) {
        const recent = store.all('SELECT title FROM site_agent_ideas ORDER BY first_at DESC LIMIT 40').map(r => r.title);
        let generated; try { generated = await suggestIdeas({ features: PUBLIC_FEATURES, recentIdeas: recent }, controller.signal); } catch { generated = { status: 'failed', ideas: [] }; }
        if (!ownsLease(lease)) return null;
        aiState = generated.status; if (generated.status === 'ready') seedIdeas(generated.ideas, 'ai');
      }
      if (!ownsLease(lease)) return null;
      const statusValue = result.findings.some(f => f.severity === 'critical') ? 'critical' : result.findings.length ? 'warning' : 'ok';
      store.db.exec('BEGIN IMMEDIATE');
      try {
        seedIdeas(BUILTIN_IDEAS, 'rule');
        const nextIdea = store.get("SELECT key,title,details,basis,source FROM site_agent_ideas WHERE delivered_at IS NULL AND state='new' ORDER BY CASE source WHEN 'ai' THEN 0 ELSE 1 END,first_at,rowid LIMIT 1");
        if (nextIdea) store.run('UPDATE site_agent_ideas SET delivered_at=? WHERE key=?', now(), nextIdea.key);
        const changes = updateFindings(result);
        const payload = { title: 'Проверка сайта и идеи', trigger: manual ? 'manual' : 'hourly', ...result, ...changes,
          ideas: nextIdea ? [nextIdea] : [], aiStatus: aiState, durationMs: Math.max(0, Date.now() - startedAt),
          summary: result.findings.length ? `Замечаний: ${result.findings.length}. Новых: ${changes.newFindingKeys.length}.` : 'В выполненных проверках новых сбоев не обнаружено.',
          ideasNote: nextIdea ? 'Предложение требует оценки; это не подтверждённый баг.' : 'Новых идей в текущем списке нет. Ранее предложенные остаются в разделе идей.' };
        store.run('INSERT INTO site_agent_reports(slot,at,status,payload) VALUES(?,?,?,?)', slot, now(), statusValue, JSON.stringify(payload));
        store.run('UPDATE site_agent_state SET last_run=?,next_run=?,ai_status=? WHERE id=1 AND lease_token=?', now(), manual ? row().next_run : nextHour(now()), aiState, lease);
        store.run('DELETE FROM site_agent_reports WHERE at<?', now() - 90 * 86400000);
        store.db.exec('COMMIT'); store.audit('site_agent_report', statusValue, now()); return payload;
      } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    } catch {
      if (!ownsLease(lease)) return null;
      const payload = { title: 'Проверка агента прервана', trigger: manual ? 'manual' : 'hourly', summary: 'Не удалось завершить проверку. Вывод о состоянии сайта не получен.',
        findings: [], checks: [], ideas: [], newFindingKeys: [], resolvedFindings: [], scope: [], notChecked: ['Проверка не завершена'], durationMs: Math.max(0, Date.now() - startedAt) };
      store.run('INSERT OR IGNORE INTO site_agent_reports(slot,at,status,payload) VALUES(?,?,?,?)', slot, now(), 'error', JSON.stringify(payload));
      store.run('UPDATE site_agent_state SET last_run=?,next_run=? WHERE id=1 AND lease_token=?', now(), manual ? row().next_run : nextHour(now()), lease); return payload;
    } finally {
      clearTimeout(timeout);
      if (ownsLease(lease)) store.run('UPDATE site_agent_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?', lease);
      if (activeLease === lease) { activeLease = null; activeController = null; }
    }
  }
  function start() {
    if (!autoStart || schedulerActive || stopped) return;
    schedulerActive = true; timer = setInterval(() => { void run().catch(() => {}); }, 30000); timer.unref();
  }
  function stop() {
    if (stopped) return; clearInterval(timer); schedulerActive = false; activeController?.abort();
    if (activeLease) store.run('UPDATE site_agent_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?', activeLease);
    stopped = true;
  }
  async function route(req, res, url) {
    if (!url.pathname.startsWith('/api/account/agent/')) return false;
    const auth = session(req); if (!auth.owner) deny(403, 'Сообщения агента доступны только владельцу сайта.');
    if (!equal(req.headers['x-pk-account'], auth.key)) deny(409, 'Аккаунт изменился. Обновите страницу.');
    if (req.method === 'GET' && url.pathname === '/api/account/agent/status') { json(res, 200, status()); return true; }
    if (req.method === 'GET' && url.pathname === '/api/account/agent/reports') { json(res, 200, reports(url.searchParams.get('before') ?? undefined)); return true; }
    if (req.method === 'GET' && url.pathname === '/api/account/agent/ideas') { json(res, 200, ideas()); return true; }
    if (req.method !== 'POST') deny(404, 'Действие агента не найдено.');
    sameOrigin(req); if (!equal(req.headers['x-csrf-token'], auth.csrf) || !equal(req.headers['x-pk-account'], auth.key)) deny(403, 'Обновите страницу и повторите действие.');
    const data = await body(req, 2048);
    if (url.pathname === '/api/account/agent/ideas/state') { json(res, 200, updateIdea(data.key, data.state)); return true; }
    if (url.pathname === '/api/account/agent/read-all') { store.run('UPDATE site_agent_reports SET read_at=? WHERE read_at IS NULL', now()); json(res, 200, { ok: true, unread: 0 }); return true; }
    const match = /^\/api\/account\/agent\/reports\/(\d+)\/read$/.exec(url.pathname);
    if (match) { json(res, 200, read(match[1])); return true; }
    deny(404, 'Действие агента не найдено.');
  }
  function updateIdea(key, state) {
    if (!['new', 'planned', 'dismissed'].includes(state) || typeof key !== 'string' || key.length > 100) deny(400, 'Некорректный статус идеи.');
    if (!store.get('SELECT key FROM site_agent_ideas WHERE key=? AND delivered_at IS NOT NULL', key)) deny(404, 'Идея не найдена.');
    store.run('UPDATE site_agent_ideas SET state=? WHERE key=?', state, key); return { ok: true };
  }
  return { status, settings, reports, ideas, read, updateIdea, route, run, start, stop };
}
