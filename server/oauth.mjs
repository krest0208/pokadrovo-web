import { createHmac, createPublicKey, verify as verifySignature } from 'node:crypto';

export const PROVIDERS = ['google', 'facebook', 'instagram'];
const urls = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', profile: 'https://openidconnect.googleapis.com/v1/userinfo' },
  facebook: { authorize: 'https://www.facebook.com', api: 'https://graph.facebook.com' },
  instagram: { authorize: 'https://www.instagram.com/oauth/authorize', token: 'https://api.instagram.com/oauth/access_token', api: 'https://graph.instagram.com' }
};
export function authorizeUrl(provider, config, redirect, state, challenge, nonce) {
  const base = provider === 'facebook' ? `${urls.facebook.authorize}/${config.graphVersion}/dialog/oauth` : urls[provider].authorize;
  const url = new URL(base);
  const params = { client_id: config.clientId, redirect_uri: redirect, response_type: 'code', state };
  if (provider === 'google') Object.assign(params, { scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', nonce, prompt: 'select_account' });
  if (provider === 'facebook') params.scope = 'public_profile,email';
  if (provider === 'instagram') Object.assign(params, { scope: 'instagram_business_basic', enable_fb_login: '0', force_authentication: '1' });
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

/** All network destinations are fixed provider endpoints, never supplied by a browser. */
export function createOAuthClient(request = fetch) {
  let cachedKeys = null, cacheUntil = 0;
  async function readJson(url, init = {}) {
    const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error('OAuth provider rejected request');
    // Bound response size even without Content-Length.
    const reader = response.body?.getReader(); let size = 0, text = '';
    if (reader) { const decoder = new TextDecoder(); try { while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 262144) throw Error('OAuth response too large'); text += decoder.decode(r.value, { stream: true }); } text += decoder.decode(); } finally { await reader.cancel().catch(() => {}); } }
    else text = await response.text();
    if (text.length > 262144) throw Error('OAuth response too large');
    const value = JSON.parse(text); if (!value || value.error) throw Error('OAuth response error'); return value;
  }
  async function googleIdentity(idToken, config, nonce, now) {
    if (typeof idToken !== 'string' || idToken.length > 20000) throw Error('Missing ID token');
    const parts = idToken.split('.'); if (parts.length !== 3) throw Error('Invalid JWT');
    const head = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw Error('Invalid signing algorithm');
    if (!cachedKeys || now > cacheUntil || !cachedKeys.some(k => k.kid === head.kid)) {
      const data = await readJson('https://www.googleapis.com/oauth2/v3/certs');
      if (!Array.isArray(data.keys)) throw Error('Invalid provider keys'); cachedKeys = data.keys; cacheUntil = now + 3600000;
    }
    const key = cachedKeys.find(k => k.kid === head.kid && k.kty === 'RSA');
    if (!key || !verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw Error('Invalid ID token signature');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.clientId) || (claims.azp && claims.azp !== config.clientId) || (audiences.length > 1 && claims.azp !== config.clientId)) throw Error('Wrong token audience');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.nonce !== nonce) throw Error('Invalid token issuer or nonce');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now || typeof claims.iat !== 'number' || claims.iat * 1000 > now + 60000 || claims.iat * 1000 < now - 3600000) throw Error('Expired ID token');
    if (typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255) throw Error('Missing subject');
    return claims;
  }
  async function exchange(provider, config, code, redirect, verifier, nonce, now = Date.now()) {
    if (!PROVIDERS.includes(provider)) throw Error('Unknown provider');
    let data;
    const params = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirect, grant_type: 'authorization_code' });
    if (provider === 'google') params.set('code_verifier', verifier);
    const endpoint = provider === 'facebook' ? `${urls.facebook.api}/${config.graphVersion}/oauth/access_token` : urls[provider].token;
    if (provider === 'instagram') {
      const form = new FormData(); for (const [k, v] of params) form.set(k, v);
      data = await readJson(endpoint, { method: 'POST', body: form });
      if (Array.isArray(data.data)) data = data.data[0];
    } else data = await readJson(endpoint, { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!data || typeof data.access_token !== 'string' || data.access_token.length > 16384) throw Error('Missing access token');
    const headers = { Authorization: `Bearer ${data.access_token}` };
    if (provider === 'google') {
      const claims = await googleIdentity(data.id_token, config, nonce, now);
      const profile = await readJson(urls.google.profile, { headers });
      if (profile.sub !== claims.sub) throw Error('Subject mismatch');
      return { subject: claims.sub, name: String(profile.name || 'Автор').slice(0, 80), email: profile.email_verified === true ? profile.email : null, emailVerified: profile.email_verified === true };
    }
    if (provider === 'facebook') {
      const debug = new URL(`${urls.facebook.api}/${config.graphVersion}/debug_token`);
      debug.searchParams.set('input_token', data.access_token);
      const checked = await readJson(debug.href, { headers: { Authorization: `Bearer ${config.clientId}|${config.clientSecret}` } });
      const detail = checked.data;
      if (!detail?.is_valid || String(detail.app_id) !== config.clientId || !detail.user_id || (detail.expires_at && detail.expires_at * 1000 <= now) || (detail.data_access_expires_at && detail.data_access_expires_at * 1000 <= now)) throw Error('Invalid Facebook token');
      const url = new URL(`${urls.facebook.api}/${config.graphVersion}/me`);
      url.search = new URLSearchParams({ fields: 'id,name,email', appsecret_proof: createHmac('sha256', config.clientSecret).update(data.access_token).digest('hex') }).toString();
      const p = await readJson(url.href, { headers });
      if (String(p.id) !== String(detail.user_id)) throw Error('Facebook subject mismatch');
      // Email from a provider is never used to silently link another existing account.
      return { subject: String(p.id), name: String(p.name || 'Автор').slice(0, 80), email: null, emailVerified: false };
    }
    const url = new URL(`${urls.instagram.api}/${config.graphVersion}/me`);
    url.searchParams.set('fields', 'user_id,username,account_type');
    const p = await readJson(url.href, { headers });
    const subject = String(p.user_id || p.id || '');
    if (!subject || !/^[0-9]{1,60}$/.test(subject) || (data.user_id && String(data.user_id) !== subject)) throw Error('Invalid Instagram identity');
    if (p.account_type && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(p.account_type)) throw Error('Instagram requires a professional account');
    return { subject, name: String(p.username || 'Автор Instagram').slice(0, 80), email: null, emailVerified: false };
  }
  return { exchange };
}