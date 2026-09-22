import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64url, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../src/types.ts';
import { currentAccount } from '../src/accounts/auth.ts';
import { authRoute } from '../src/accounts/auth-routes.ts';
import { githubCallback, githubLogin } from '../src/accounts/github-auth.ts';
import { encryptHost, decryptHost } from '../src/accounts/crypto.ts';

const origin = 'https://ssh.example.com';
const env = {
  AUTH_PROVIDER: 'github', APP_ORIGIN: origin, ADMIN_ACCOUNT_ID: 'legacy-access-owner',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-client-secret', GITHUB_ADMIN_ID: '123',
  ACCESS_TEAM_DOMAIN: 'test-oauth.cloudflareaccess.com', ACCESS_AUD: 'access-audience',
} as Env;
const request = (path: string, cookie = '', headers = {}) => new Request(`${origin}${path}`, {
  headers: { Cookie: cookie, ...headers },
});
const cookieValue = (response: Response, name: string) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))!.split(';')[0];

async function start() {
  const response = await githubLogin(request('/auth/login'), env);
  const authorization = new URL(response.headers.get('Location')!);
  return { response, authorization, cookie: cookieValue(response, '__Host-edgessh-oauth') };
}

function exchange(id = 123): typeof fetch {
  return async (url, init) => {
    if (String(url).endsWith('/access_token')) {
      assert.equal(init?.method, 'POST');
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('client_secret'), env.GITHUB_CLIENT_SECRET);
      assert.equal(body.get('redirect_uri'), `${origin}/auth/callback`);
      assert.equal(body.get('code_verifier')?.length, 43);
      return Response.json({ access_token: 'private-github-token' });
    }
    assert.equal(String(url), 'https://api.github.com/user');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-github-token');
    return Response.json({ id, login: 'administrator' });
  };
}

async function login() {
  const flow = await start();
  const response = await githubCallback(request(`/auth/callback?code=valid&state=${flow.authorization.searchParams.get('state')}`, flow.cookie), env, exchange());
  assert.equal(response.status, 302);
  return { response, cookie: cookieValue(response, '__Host-edgessh-session') };
}

test('OAuth starts with random state, S256 PKCE and no privileged scopes', async () => {
  const first = await start();
  const second = await start();
  assert.equal(first.authorization.origin, 'https://github.com');
  assert.equal(first.authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
  assert.equal(first.authorization.searchParams.get('scope'), '');
  assert.equal(first.authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(first.authorization.searchParams.get('state'), second.authorization.searchParams.get('state'));
  const payload = decodeJwt(first.cookie.split('=')[1]);
  const challenge = base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(payload.verifier)))));
  assert.equal(challenge, first.authorization.searchParams.get('code_challenge'));
  assert.equal(payload.state, first.authorization.searchParams.get('state'));
  assert.ok(first.response.headers.get('Set-Cookie')?.includes('Secure; HttpOnly; SameSite=Lax'));
  assert.equal(first.authorization.toString().includes(env.GITHUB_CLIENT_SECRET!), false);
});

test('callback binds state to its browser cookie before any token exchange', async () => {
  const flow = await start();
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw Error('must not fetch'); };
  for (const [query, cookie] of [
    ['code=valid&state=wrong', flow.cookie],
    [`code=valid&state=${flow.authorization.searchParams.get('state')}`, ''],
    [`code=valid&state=${flow.authorization.searchParams.get('state')}`, `${flow.cookie}tampered`],
    ['error=access_denied', flow.cookie],
  ]) {
    const response = await githubCallback(request(`/auth/callback?${query}`, cookie), env, fetcher);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/);
  }
  assert.equal(calls, 0);
});

test('only the numeric GitHub administrator receives a session', async () => {
  const flow = await start();
  const denied = await githubCallback(request(`/auth/callback?code=valid&state=${flow.authorization.searchParams.get('state')}`, flow.cookie), env, exchange(456));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.getSetCookie().some((value) => value.startsWith('__Host-edgessh-session=')), false);
  const { response, cookie } = await login();
  const account = await currentAccount(request('/api/auth/me', cookie), env);
  assert.deepEqual(account, { id: env.ADMIN_ACCOUNT_ID, username: 'administrator' });
  assert.equal(response.headers.get('Location'), '/');
  assert.equal(cookie.includes('private-github-token'), false);
  assert.equal(decodeJwt(cookie.split('=')[1]).sub, '123');
});

test('wrong signing key, tampered cookies and changed administrator cannot access APIs', async () => {
  const { cookie } = await login();
  for (const [token, settings] of [
    [`${cookie}tampered`, env],
    [cookie, { ...env, ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') }],
    [cookie, { ...env, GITHUB_ADMIN_ID: '456' }],
    [cookie, { ...env, APP_ORIGIN: 'https://another.example.com' }],
  ] as const) {
    await assert.rejects(currentAccount(request('/api/hosts', token), settings), (error: Error & { status: number }) => error.status === 401);
  }
});

test('flow cookie is not a session and providers never accept each others credentials', async () => {
  const flow = await start();
  await assert.rejects(currentAccount(request('/api/hosts', flow.cookie.replace('__Host-edgessh-oauth=', '__Host-edgessh-session=')), env), /过期/);
  await assert.rejects(currentAccount(request('/api/hosts', 'CF_Authorization=access-token', { 'Cf-Access-Jwt-Assertion': 'access-token' }), env), /GitHub 登录/);
  const { cookie } = await login();
  await assert.rejects(currentAccount(request('/api/hosts', cookie), { ...env, AUTH_PROVIDER: 'cloudflare' }), /Cloudflare Access/);
  await assert.rejects(currentAccount(request('/api/hosts', cookie), { ...env, AUTH_PROVIDER: 'unknown' }), /登录方式/);
  const callback = await authRoute(request('/auth/callback?code=anything'), { ...env, AUTH_PROVIDER: 'cloudflare' });
  assert.equal(callback?.status, 404);
});

test('OAuth rejects an unexpected callback origin and hides upstream errors', async () => {
  await assert.rejects(githubLogin(new Request('https://wrong.example.com/auth/login'), env), /正式入口/);
  assert.equal((await githubCallback(new Request('https://wrong.example.com/auth/callback?code=x'), env)).status, 400);
  const flow = await start();
  const response = await githubCallback(request(`/auth/callback?code=valid&state=${flow.authorization.searchParams.get('state')}`, flow.cookie), env,
    async () => { throw Error('client-secret-and-token-in-internal-error'); });
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('client-secret'), false);
});

test('logout clears both cookies, and Cloudflare mode delegates only its own logout', async () => {
  const req = new Request(`${origin}/api/auth/logout`, { method: 'POST', headers: { Origin: origin } });
  for (const provider of ['github', 'cloudflare']) {
    const response = (await authRoute(req, { ...env, AUTH_PROVIDER: provider }))!;
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.ok(response.headers.getSetCookie().every((value) => value.includes('Max-Age=0')));
    assert.equal((await response.json() as { redirect: string }).redirect, provider === 'github' ? '/' : '/cdn-cgi/access/logout');
  }
  assert.equal((await authRoute(request('/api/auth/logout'), env))?.status, 405);
});

test('Cloudflare and GitHub administrators decrypt the same existing host without rewriting data', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
  try {
    const token = await new SignJWT({ email: 'admin@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(env.ACCESS_AUD!).setSubject('original-subject').setExpirationTime('5m').sign(privateKey);
    const cloudflare = await currentAccount(request('/api/auth/me', `CF_Authorization=${token}`), { ...env, AUTH_PROVIDER: 'cloudflare' });
    const { cookie } = await login();
    const github = await currentAccount(request('/api/auth/me', cookie), env);
    assert.equal(cloudflare.id, github.id);
    const secret = { host: 'example.com', password: 'test-password' };
    const ciphertext = await encryptHost(secret, env.ENCRYPTION_KEY, cloudflare.id, 'host-1');
    assert.deepEqual(await decryptHost(ciphertext, env.ENCRYPTION_KEY, github.id, 'host-1'), secret);
  } finally { globalThis.fetch = originalFetch; }
});

test('expired sessions are rejected even with a correct signature', async () => {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', base64url.decode(env.ENCRYPTION_KEY), 'HKDF', false, ['deriveBits']);
  const key = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('edgessh:v1'), info: encoder.encode('github-oauth-cookie'),
  }, material, 256));
  const token = await new SignJWT({ sub: '123', username: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(origin).setAudience(`edgessh:session:${env.GITHUB_CLIENT_ID}:123`)
    .setIssuedAt(1).setExpirationTime(2).sign(key);
  await assert.rejects(currentAccount(request('/api/auth/me', `__Host-edgessh-session=${token}`), env), /过期/);
});
