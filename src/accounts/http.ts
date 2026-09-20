import { jsonError, secureResponse } from '../http-security.ts';
import { HostEncryptionKeyError, HostPayloadDecryptionError } from './crypto.ts';

export class APIError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return secureResponse(Response.json(value, { status, headers: responseHeaders }));
}

export async function readJSON(request: Request, maxBytes = 160 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new APIError('请使用 JSON 请求。', 415);
  if (!request.body) throw new APIError('请求内容不能为空。');
  // 流式限制实际大小，不信任可缺省或伪造的 Content-Length。
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new APIError('请求内容过大。', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new APIError('JSON 格式无效。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError('请求格式无效。');
  return body as Record<string, unknown>;
}

export function apiFailure(error: unknown): Response {
  if (error instanceof APIError) return jsonError(error.message, error.status);
  if (error instanceof HostEncryptionKeyError) return jsonError('主机存储尚未正确配置，请检查 ENCRYPTION_KEY。', 503);
  if (error instanceof HostPayloadDecryptionError) return jsonError('主机资料无法解密，请确认 ENCRYPTION_KEY 未被更换。', 503);
  return jsonError('服务暂时不可用，请稍后重试。', 500);
}
