import { deny } from './http.mjs';
import { token } from './security.mjs';

export const YANDEX_MODEL = 'yandexgpt-5.1';
export const YANDEX_ENDPOINT = 'https://ai.api.cloud.yandex.net/foundationModels/v1/completion';

/** Separate credentials: configuring Yandex never replaces the Qwen key. */
export function createYandex({ store, now }) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS ai_yandex_config(
    id INTEGER PRIMARY KEY CHECK(id=1), model TEXT NOT NULL DEFAULT 'yandexgpt-5.1',
    folder_id TEXT NOT NULL DEFAULT '', secret TEXT, enabled INTEGER NOT NULL DEFAULT 0,
    revision TEXT NOT NULL DEFAULT '', verified_revision TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO ai_yandex_config(id) VALUES(1);`);
  const row = () => store.get('SELECT * FROM ai_yandex_config WHERE id=1');
  function state() {
    const c = row();
    return { c, configured: !!c.secret && !!c.folder_id && c.model === YANDEX_MODEL,
      enabled: !!c.enabled, verified: !!c.revision && c.verified_revision === c.revision };
  }
  function adminState() {
    const s = state(); return { model: s.c.model, folderId: s.c.folder_id, keyConfigured: !!s.c.secret,
      enabled: s.enabled, configured: s.configured, verified: s.verified,
      connected: s.configured && s.enabled && s.verified, updated: s.c.updated,
      customersEnabled: false, tariffConfigured: false };
  }
  function save(data) {
    if (data.model !== YANDEX_MODEL || typeof data.folderId !== 'string' || !/^[a-z0-9]{10,64}$/.test(data.folderId) || typeof data.enabled !== 'boolean')
      deny(400, 'Укажите идентификатор каталога Яндекса и модель yandexgpt-5.1.');
    const old = row(); let secret = old.secret;
    if (data.removeKey === true) secret = null;
    else if (data.apiKey !== undefined && data.apiKey !== '') {
      if (typeof data.apiKey !== 'string' || !/^[\x21-\x7e]{12,4096}$/.test(data.apiKey)) deny(400, 'Некорректный API-ключ Яндекса.');
      secret = store.seal(data.apiKey);
    }
    if (data.enabled && !secret) deny(400, 'Для включения нужен API-ключ Яндекса.');
    store.run('UPDATE ai_yandex_config SET model=?,folder_id=?,secret=?,enabled=?,revision=?,verified_revision=?,updated=? WHERE id=1',
      data.model, data.folderId, secret, Number(data.enabled), token(), '', now());
    store.audit('yandex_settings_updated', 'ok', now());
    return adminState();
  }
  function prepare(s, system, input) {
    if (Buffer.byteLength(JSON.stringify(input)) > 64000) deny(413, 'Для первого теста Яндекса выберите проект меньшего размера.');
    return { url: YANDEX_ENDPOINT,
      headers: { Authorization: 'Api-Key ' + store.unseal(s.c.secret), 'Content-Type': 'application/json', Accept: 'application/json',
        'x-folder-id': s.c.folder_id, 'x-data-logging-enabled': 'false' },
      payload: { modelUri: `gpt://${s.c.folder_id}/${s.c.model}`, completionOptions: { stream: false, temperature: .2, maxTokens: '4096', reasoningOptions: { mode: 'DISABLED' } },
        messages: [{ role: 'system', text: system + '\nВ этом режиме приложенных медиа нет. analysis=null. Не утверждай, что просмотрел видео; используй только описание проекта и переданный предыдущий анализ.' },
          { role: 'user', text: JSON.stringify(input) }], jsonObject: true } };
  }
  function parse(result) {
    const alternative = result.result?.alternatives?.[0];
    if (alternative?.status !== 'ALTERNATIVE_STATUS_FINAL' || typeof alternative?.message?.text !== 'string') deny(502, 'Яндекс не завершил план. Монтаж не изменён.');
    let value; try { value = JSON.parse(alternative.message.text); } catch { deny(502, 'Яндекс вернул неполный JSON. Монтаж не изменён.'); }
    const count = value => typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { value, usage: { inputTokens: count(result.result?.usage?.inputTextTokens), outputTokens: count(result.result?.usage?.completionTokens) } };
  }
  return { state, adminState, save, prepare, parse,
    current: s => row().revision === s.c.revision && !!row().enabled,
    verified: s => store.run('UPDATE ai_yandex_config SET verified_revision=? WHERE id=1 AND revision=?', s.c.revision, s.c.revision) };
}
