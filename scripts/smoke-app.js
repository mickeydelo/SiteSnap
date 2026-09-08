import assert from 'node:assert/strict';
import { loginFetch } from './login-helper.js';

delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.SITESNAP_CAPTURE_KEY;

const { default: app } = await import('../index.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

const origin = `http://127.0.0.1:${server.address().port}`;
const authenticatedFetch = await loginFetch(origin);

try {
  for (const [route, contentType] of [
    ['/', 'text/html'],
    ['/run.html?site=nuveen', 'text/html'],
    ['/styles/index.css', 'text/css'],
    ['/styles/01-settings/_colors.css', 'text/css'],
    ['/styles/04-components/_button.css', 'text/css'],
    ['/assets/halux-prism.svg', 'image/svg\\+xml'],
    ['/scripts/home.js', 'javascript'],
    ['/scripts/run.js', 'javascript'],
    ['/scripts/stream.js', 'javascript'],
    ['/api/health', 'application/json'],
    ['/api/sites', 'application/json'],
    ['/api/config/nuveen', 'application/json'],
  ]) {
    const response = await authenticatedFetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', new RegExp(contentType), route);
    assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/, route);
  }

  const redirect = await authenticatedFetch(`${origin}/run?site=nuveen`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/run.html?site=nuveen');

  const warmup = await authenticatedFetch(`${origin}/api/warmup`, { method: 'POST' });
  assert.equal(warmup.status, 204);

  const invalidJson = await authenticatedFetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, 'INVALID_JSON');

  const missingRoute = await authenticatedFetch(`${origin}/api/not-a-route`);
  assert.equal(missingRoute.status, 404);
  assert.equal((await missingRoute.json()).code, 'API_NOT_FOUND');

  console.log('Local HTTP/UI smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
