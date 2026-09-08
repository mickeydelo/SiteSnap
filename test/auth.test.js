import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { createSession, validSession, safeReturnPath, LOGIN_CREDENTIALS } from '../core/auth.js';

test('sessions reject tampering, malformed tokens, and expiration', () => {
  const now = Date.now();
  const token = createSession(now);
  assert.equal(validSession(token, now), true);
  assert.equal(validSession(token, now + 12 * 60 * 60 * 1000), false);
  assert.equal(validSession(`9${token}`, now), false);
  assert.equal(validSession(`${token.slice(0, -1)}!`, now), false);
  for (const value of [undefined, '', 'true', 'nuveen', '1.2.3', `${token}.extra`]) {
    assert.equal(validSession(value, now), false);
  }
});

test('login return paths remain on this site', () => {
  assert.equal(safeReturnPath('/run.html?site=nuveen'), '/run.html?site=nuveen');
  for (const value of ['https://example.com', '//example.com', '/\\example.com', '/\n/example.com', '/login', '/logout', '/a/../login', ['//example.com']]) {
    assert.equal(safeReturnPath(value), '/');
  }
});

test('login protects pages, APIs and files in local and hosted runtimes', async t => {
  const { default: app } = await import('../index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (route, options) => fetch(`${origin}${route}`, { redirect: 'manual', ...options });
  const login = (values, headers) => get('/login', {
    method: 'POST', body: new URLSearchParams(values), headers,
  });

  for (const route of ['/', '/index.html', '/run', '/run.html?site=nuveen', '/scripts/run.js', '/site-image/nuveen']) {
    const response = await get(route);
    assert.equal(response.status, 303, route);
    assert.match(response.headers.get('location'), /^\/login\?next=/);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  for (const route of ['/api/health', '/api/sites', '/api/config/nuveen', '/api/download/missing', '/api/thumbnail/missing/0', '/api/status/missing']) {
    const response = await get(route);
    assert.equal(response.status, 401, route);
    assert.equal((await response.json()).code, 'LOGIN_REQUIRED');
  }
  for (const route of ['/api/run', '/api/warmup']) {
    assert.equal((await get(route, { method: 'POST' })).status, 401);
  }
  for (const route of ['/login', '/styles/index.css', '/assets/halux-prism.svg', '/scripts/login.js']) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    assert.ok(!(await response.text()).includes(LOGIN_CREDENTIALS.password));
  }

  // Send unnormalized paths to ensure public asset mounts cannot escape into protected HTML.
  for (const route of ['/styles/..%2findex.html', '/assets/..%2fscripts/run.js']) {
    const status = await new Promise((resolve, reject) => {
      httpRequest(`${origin}${route}`, response => { response.resume(); resolve(response.statusCode); })
        .on('error', reject).end();
    });
    assert.equal(status, 303, route);
  }

  for (const values of [{}, { ...LOGIN_CREDENTIALS, password: 'wrong' }, { ...LOGIN_CREDENTIALS, username: 'wrong' }]) {
    const response = await login(values);
    assert.match(response.headers.get('location'), /^\/login\?error=1/);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await login(LOGIN_CREDENTIALS, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);

  const response = await login({ ...LOGIN_CREDENTIALS, next: '/run.html?site=nuveen' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/run.html?site=nuveen');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=43200/);
  const headers = { Cookie: setCookie.split(';')[0] };
  for (const route of ['/', '/run.html?site=nuveen', '/api/health', '/api/sites', '/api/config/nuveen', '/site-image/nuveen']) {
    const result = await get(route, { headers });
    assert.equal(result.status, 200, route);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(result.headers.get('vercel-cdn-cache-control'), 'no-store');
    assert.ok(!(await result.text()).includes(LOGIN_CREDENTIALS.password));
  }
  for (const token of ['invalid', createSession(Date.now() - 13 * 60 * 60 * 1000)]) {
    assert.equal((await get('/api/sites', { headers: { Cookie: `halux_session=${token}` } })).status, 401);
  }
  const logout = await get('/logout', { method: 'POST', headers });
  assert.equal(logout.headers.get('location'), '/login');
  assert.match(logout.headers.get('set-cookie'), /halux_session=;/);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  const externalNext = await login({ ...LOGIN_CREDENTIALS, next: '//evil.example' });
  assert.equal(externalNext.headers.get('location'), '/');

  const previousVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    assert.match((await login(LOGIN_CREDENTIALS)).headers.get('set-cookie'), /Secure/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});
