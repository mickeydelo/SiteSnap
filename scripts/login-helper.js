import assert from 'node:assert/strict';
import { LOGIN_CREDENTIALS } from '../core/auth.js';

export async function loginFetch(origin) {
  const response = await fetch(`${origin}/login`, {
    method: 'POST',
    body: new URLSearchParams(LOGIN_CREDENTIALS),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 303, 'Login must succeed');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('halux_session='), 'Login must issue a session cookie');
  return (url, options = {}) => {
    assert.equal(new URL(url).origin, new URL(origin).origin, 'Never send login cookies to another origin');
    const headers = new Headers(options.headers);
    headers.set('Cookie', cookie);
    return fetch(url, { ...options, headers });
  };
}
