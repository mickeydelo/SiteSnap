import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import path from 'node:path';

// Server-only shared account. Changing the password also invalidates existing sessions.
export const LOGIN_CREDENTIALS = Object.freeze({
  username: 'nuveen',
  password: 'FvWSA4T89DnYi804',
});
const COOKIE_NAME = 'halux_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const signingKey = createHash('sha256').update(`halux-session:v1:${LOGIN_CREDENTIALS.password}`).digest();

function equal(left, right) {
  const digest = value => createHash('sha256').update(String(value ?? '')).digest();
  return timingSafeEqual(digest(left), digest(right));
}

function sign(payload) {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}

export function createSession(now = Date.now()) {
  const payload = `${now + SESSION_MS}.${randomBytes(24).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

export function validSession(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 200) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiry, nonce, signature] = parts;
  return /^\d+$/.test(expiry) && Number(expiry) > now
    && Number(expiry) <= now + SESSION_MS
    && /^[\w-]{32}$/.test(nonce) && equal(signature, sign(`${expiry}.${nonce}`));
}

export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\s\x00-\x1f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://halux.invalid');
    if (url.origin !== 'https://halux.invalid' || /^\/(?:login|logout)(?:\/|$)/i.test(url.pathname)) return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

export function installLogin(app, uiDirectory) {
  const authenticated = request => {
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim())
      .find(value => value.startsWith(`${COOKIE_NAME}=`));
    return validSession(cookie?.slice(COOKIE_NAME.length + 1));
  };
  const cookieOptions = request => ({
    httpOnly: true,
    secure: process.env.VERCEL === '1' || request.secure,
    sameSite: 'lax',
    path: '/',
  });

  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.get('origin');
      let sameOrigin = true;
      try {
        sameOrigin = !origin || new URL(origin).host === request.get('host');
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || request.get('sec-fetch-site') === 'cross-site') {
        return response.status(403).json({ error: 'Cross-site requests are not allowed.' });
      }
    }
    next();
  });

  app.get(['/login', '/login.html'], (request, response) => {
    if (authenticated(request)) return response.redirect(303, safeReturnPath(request.query.next));
    return response.sendFile(path.join(uiDirectory, 'login.html'));
  });

  app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (request, response) => {
    const next = safeReturnPath(request.body?.next);
    const usernameMatches = equal(request.body?.username, LOGIN_CREDENTIALS.username);
    const passwordMatches = equal(request.body?.password, LOGIN_CREDENTIALS.password);
    if (!usernameMatches || !passwordMatches) {
      return response.redirect(303, `/login?error=1&next=${encodeURIComponent(next)}`);
    }
    response.cookie(COOKIE_NAME, createSession(), { ...cookieOptions(request), maxAge: SESSION_MS });
    return response.redirect(303, next);
  });

  app.post('/logout', (request, response) => {
    response.clearCookie(COOKIE_NAME, cookieOptions(request));
    return response.redirect(303, '/login');
  });

  for (const directory of ['styles', 'assets']) {
    app.use(`/${directory}`, express.static(path.join(uiDirectory, directory), { cacheControl: false }));
  }
  app.get('/scripts/login.js', (_request, response) => response.sendFile(path.join(uiDirectory, 'scripts/login.js')));

  app.use((request, response, next) => {
    if (authenticated(request)) return next();
    if (request.path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
      return response.status(401).json({ code: 'LOGIN_REQUIRED', error: 'Please sign in to continue.' });
    }
    return response.redirect(303, `/login?next=${encodeURIComponent(safeReturnPath(request.originalUrl))}`);
  });
}
