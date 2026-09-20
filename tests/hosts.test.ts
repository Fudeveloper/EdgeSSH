import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64 } from '../src/accounts/crypto.ts';
import { APIError } from '../src/accounts/http.ts';
import { hostsRoute } from '../src/accounts/hosts.ts';
import type { Env } from '../src/types.ts';

interface StoredHost {
  id: string;
  account_id: string;
  encrypted_payload: string;
  updated_at: number;
}

class FakeStatement {
  private values: unknown[] = [];
  private readonly database: FakeDatabase;
  private readonly sql: string;

  constructor(database: FakeDatabase, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]): FakeStatement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (!this.sql.startsWith('SELECT id, encrypted_payload, updated_at FROM hosts WHERE account_id')) throw new Error(`Unexpected all(): ${this.sql}`);
    const accountId = this.values[0];
    const rows = [...this.database.rows.values()]
      .filter((row) => row.account_id === accountId)
      .sort((left, right) => right.updated_at - left.updated_at)
      .map(({ id, encrypted_payload, updated_at }) => ({ id, encrypted_payload, updated_at }) as T);
    return { results: rows };
  }

  async first<T>(): Promise<T | null> {
    if (!this.sql.startsWith('SELECT id, encrypted_payload, updated_at FROM hosts WHERE id')) throw new Error(`Unexpected first(): ${this.sql}`);
    const [id, accountId] = this.values;
    const row = this.database.rows.get(String(id));
    if (!row || row.account_id !== accountId) return null;
    return { id: row.id, encrypted_payload: row.encrypted_payload, updated_at: row.updated_at } as T;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.startsWith('INSERT INTO hosts')) {
      const [id, accountId, encryptedPayload, updatedAt] = this.values;
      const count = [...this.database.rows.values()].filter((row) => row.account_id === accountId).length;
      if (count >= 200) return { meta: { changes: 0 } };
      this.database.rows.set(String(id), {
        id: String(id), account_id: String(accountId), encrypted_payload: String(encryptedPayload), updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE hosts SET encrypted_payload = ?, updated_at = ?')) {
      const [encryptedPayload, updatedAt, id, accountId] = this.values;
      const row = this.database.rows.get(String(id));
      if (!row || row.account_id !== accountId) return { meta: { changes: 0 } };
      row.encrypted_payload = String(encryptedPayload);
      row.updated_at = Number(updatedAt);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('DELETE FROM hosts')) {
      const [id, accountId] = this.values;
      const row = this.database.rows.get(String(id));
      return { meta: { changes: row?.account_id === accountId && this.database.rows.delete(String(id)) ? 1 : 0 } };
    }
    throw new Error(`Unexpected run(): ${this.sql}`);
  }
}

class FakeDatabase {
  readonly rows = new Map<string, StoredHost>();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

const key = base64(crypto.getRandomValues(new Uint8Array(32)));

function environment(database: FakeDatabase): Env {
  return { DB: database as unknown as D1Database, ENCRYPTION_KEY: key } as Env;
}

function request(method: string, body?: unknown): Request {
  return new Request('https://ssh.example.com/api/hosts', {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const input = {
  name: '测试主机', group: '个人', host: '192.0.2.10', port: 22, username: 'root',
  authMethod: 'password', password: 'correct horse battery staple', fingerprint: '',
  initialCommand: '', termType: 'xterm-256color', encoding: 'utf-8',
};

test('correctly configured host storage creates, reads and updates an encrypted host', async () => {
  const database = new FakeDatabase();
  const env = environment(database);

  const createdResponse = await hostsRoute(request('POST', input), env, 'account-a', '/api/hosts');
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json() as { host: Record<string, unknown> }).host;
  assert.equal(created.name, input.name);
  assert.equal(created.hasCredential, true);
  assert.equal('password' in created, false);

  const stored = database.rows.get(String(created.id));
  assert.ok(stored);
  assert.equal(stored.encrypted_payload.includes(input.password), false);
  assert.equal(stored.encrypted_payload.includes(input.host), false);

  const ownList = await hostsRoute(request('GET'), env, 'account-a', '/api/hosts');
  assert.equal((await ownList.json() as { hosts: unknown[] }).hosts.length, 1);
  const otherList = await hostsRoute(request('GET'), env, 'account-b', '/api/hosts');
  assert.deepEqual(await otherList.json(), { hosts: [] });

  const updatedResponse = await hostsRoute(
    request('PUT', { ...input, name: '已更新主机', password: undefined }),
    env,
    'account-a',
    `/api/hosts/${created.id}`,
  );
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json() as { host: { name: string } }).host.name, '已更新主机');

  const credentials = await hostsRoute(request('POST'), env, 'account-a', `/api/hosts/${created.id}/credentials`);
  assert.deepEqual(await credentials.json(), { password: input.password });
  await assert.rejects(
    hostsRoute(request('POST'), env, 'account-b', `/api/hosts/${created.id}/credentials`),
    (error) => error instanceof APIError && error.status === 404,
  );
});

test('missing D1 binding returns an actionable configuration error', async () => {
  await assert.rejects(
    hostsRoute(request('POST', input), { ENCRYPTION_KEY: key } as Env, 'account-a', '/api/hosts'),
    (error) => error instanceof APIError && error.status === 503 && error.message.includes('DB 绑定'),
  );
});
