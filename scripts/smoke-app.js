import assert from 'node:assert/strict';

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

try {
  for (const [route, contentType] of [
    ['/', 'text/html'],
    ['/run.html?site=nuveen', 'text/html'],
    ['/styles/home.css', 'text/css'],
    ['/styles/run.css', 'text/css'],
    ['/scripts/home.js', 'javascript'],
    ['/scripts/run.js', 'javascript'],
    ['/scripts/stream.js', 'javascript'],
    ['/api/health', 'application/json'],
    ['/api/sites', 'application/json'],
    ['/api/config/nuveen', 'application/json'],
  ]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', new RegExp(contentType), route);
    assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/, route);
  }

  const redirect = await fetch(`${origin}/run?site=nuveen`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/run.html?site=nuveen');

  const warmup = await fetch(`${origin}/api/warmup`, { method: 'POST' });
  assert.equal(warmup.status, 204);

  const invalidJson = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, 'INVALID_JSON');

  const missingRoute = await fetch(`${origin}/api/not-a-route`);
  assert.equal(missingRoute.status, 404);
  assert.equal((await missingRoute.json()).code, 'API_NOT_FOUND');

  console.log('Local HTTP/UI smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
