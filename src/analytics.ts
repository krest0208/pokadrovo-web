/** First-party, opt-in product telemetry. Never sends files, names, prompts or API keys. */
type Metric = { kind: 'site_view'|'editor_open'|'project_saved'|'export_completed'|'ai_request'; project?:string; mode?:string; format?:string };
const CONSENT = 'pokadrovo.analytics.consent.v1';
const id = () => globalThis.crypto?.randomUUID?.() || 'event-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
async function initialise() {
  if (!/^https?:$/.test(location.protocol) || !['/', '/studio', '/profile'].includes(location.pathname)) return;
  const privacy = navigator as Navigator & { globalPrivacyControl?:boolean };
  let enabled = false, alive = false, started = false, choice = '', editor:Element|null = null;
  let queue:Metric[] = [], sending = false;
  try {
    const r = await fetch('/api/health', { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(2500) });
    if (!r.ok || !(await r.json()).analyticsEnabled) return;
    enabled = true; choice = localStorage.getItem(CONSENT) || '';
  } catch { return; }
  const disabledByBrowser = () => privacy.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const send = (path:string, data:unknown) => fetch('/api/metrics/' + path, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-PK-Metrics':'1'}, body:JSON.stringify(data), signal:AbortSignal.timeout(5000) });
  async function flush() {
    if (sending || !alive || disabledByBrowser()) return;
    sending = true;
    try {
      while (queue.length && alive) {
        const e = queue.shift()!;
        const device = window.innerWidth < 600 ? 'mobile' : window.innerWidth < 1000 ? 'tablet' : 'desktop';
        const response = await send('event', { ...e, id:id(), device });
        if (!response.ok || (await response.json()).disabled) { alive = false; queue = []; break; }
      }
    } catch { queue = []; } finally { sending = false; }
  }
  const record = (event:Metric) => {
    if (!alive || !enabled || disabledByBrowser()) return;
    if (queue.length < 30) queue.push(event);
    void flush();
  };
  async function allow() {
    if (disabledByBrowser()) return;
    choice = 'yes'; try { localStorage.setItem(CONSENT, choice); } catch {}
    try {
      const r = await send('start', { consent:true }); if (!r.ok || (await r.json()).disabled) return;
      alive = true; record({kind:'site_view'});
      const current = document.querySelector('.pe');
      if (current) record({kind:'editor_open', mode:(current.querySelector('[data-project="ratio"]') as HTMLSelectElement|null)?.value === '9:16' ? 'reels' : 'video'});
      editor = current; started = true;
    } catch { alive = false; }
  }
  const style = document.createElement('style');
  style.textContent = '.pk-privacy-trigger{position:fixed;bottom:9px;left:12px;z-index:80;border:1px solid #d7e2f1;border-radius:6px;background:#fff;color:#5e7593;padding:6px 9px;font:10px system-ui;cursor:pointer}.pk-privacy-dialog{position:fixed;bottom:42px;left:12px;z-index:81;max-width:390px;width:calc(100vw - 24px);border:1px solid #cbdcf3;border-radius:12px;background:#fff;color:#284465;box-shadow:0 10px 35px #163e762e;padding:19px;font:12px/1.6 system-ui}.pk-privacy-dialog p{margin:8px 0 14px;color:#7487a2}.pk-privacy-dialog button{padding:8px 10px;border:1px solid #ccdbee;border-radius:7px;background:#edf4ff;color:#255aa6;margin-right:7px;font:11px system-ui;cursor:pointer}';
  document.head.append(style);
  const button = document.createElement('button'); button.className = 'pk-privacy-trigger'; button.textContent = 'Приватность'; button.type = 'button';
  const panel = document.createElement('section'); panel.className = 'pk-privacy-dialog'; panel.setAttribute('aria-label','Настройка статистики');
  const title = document.createElement('strong'); title.textContent = 'Поможете улучшить студию?';
  const note = document.createElement('p');
  note.textContent = disabledByBrowser() ? 'События выключены настройкой DNT/GPC вашего браузера.' : 'Разрешить статистику посещений, сохранений и экспортов? Видео, названия файлов, промпты и пароли не передаются. Отказ не мешает монтажу.';
  const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Разрешить'; yes.disabled = disabledByBrowser();
  const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Без статистики';
  panel.append(title,note,yes,no); document.body.append(button,panel);
  panel.hidden = choice !== '' || disabledByBrowser();
  button.onclick = () => { panel.hidden = !panel.hidden; };
  yes.onclick = () => { panel.hidden = true; if (!alive) void allow(); };
  no.onclick = () => { alive = false; choice = 'no'; queue = []; panel.hidden = true; try { localStorage.setItem(CONSENT, choice); } catch {} void send('forget', {}).catch(()=>{}); };
  window.addEventListener('pokadrovo:metric', event => {
    const e = (event as CustomEvent<Metric>).detail;
    if (!e || !['project_saved','export_completed','ai_request'].includes(e.kind)) return;
    record({ kind:e.kind, ...(e.project ? {project:String(e.project).slice(0,120)} : {}), ...(e.mode ? {mode:e.mode} : {}), ...(e.format ? {format:e.format} : {}) });
  });
  const observer = new MutationObserver(() => {
    if (editor && document.contains(editor)) return;
    const next = document.querySelector('.pe');
    if (next && next !== editor && started) record({kind:'editor_open',mode:(next.querySelector('[data-project="ratio"]') as HTMLSelectElement|null)?.value==='9:16'?'reels':'video'});
    editor = next;
  });
  observer.observe(document.body, {childList:true,subtree:true});
  if (choice === 'yes' && !disabledByBrowser()) await allow();
}
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void initialise(), {once:true});
  else void initialise();
}
export {};
