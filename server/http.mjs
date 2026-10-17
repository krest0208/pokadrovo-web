export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const deny = (status, message) => { throw new HttpError(status, message); };
export const cookie = (req, name) => String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
export const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
export function appendCookie(res, name, value, seconds, secure, sameSite = 'Lax') {
  const previous = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : [previous]), `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${seconds}${secure ? '; Secure' : ''}`]);
}
export async function body(req, maximum = 16384) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) deny(415, 'Нужен JSON-запрос.');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > maximum) deny(413, 'Слишком большой запрос.'); chunks.push(chunk); }
  try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!b || Array.isArray(b) || typeof b !== 'object') throw Error(); return b; }
  catch { deny(400, 'Некорректный JSON.'); }
}