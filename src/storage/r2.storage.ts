/**
 * Cloudflare R2, behind the same interface the filesystem store implements.
 *
 *   > Storage: Cloudflare R2, jurisdiction apac. … Uploads go browser →
 *   > pre-signed PUT → bucket; the API never proxies file bytes.
 *
 * Which is exactly what this does: `presignPut` returns a URL carrying its own
 * time-limited authority, the browser PUTs to it, and the app's credentials
 * never leave the server. The API reads an object back only to re-hash it, which
 * is how a claim about what was uploaded is checked rather than believed.
 *
 * R2 speaks the S3 API with region `auto`. Signing is in `sigv4.ts`, verified
 * against AWS's published vectors.
 *
 * **No credential is ever logged or included in an error.** A failure reports the
 * status and the key, which is what a person debugging needs, and nothing that
 * would turn a log file into a way into the bucket.
 */
import { createHash } from 'node:crypto';
import {
  ContentMismatchError,
  ObjectNotFoundError,
  type PresignedUpload,
  type Storage,
  type StoredObject,
} from './storage';
import { presign, signRequest, uriEncode, UNSIGNED_PAYLOAD, type Credentials } from './sigv4';

export interface R2Config {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Overridable for a compatible store (MinIO locally, say). */
  readonly endpoint?: string;
}

const REGION = 'auto';
const SERVICE = 's3';

export class R2Storage implements Storage {
  private readonly credentials: Credentials;
  private readonly host: string;

  constructor(private readonly config: R2Config) {
    this.credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    this.host = config.endpoint
      ? new URL(config.endpoint).host
      : `${config.accountId}.r2.cloudflarestorage.com`;
  }

  /**
   * Content-addressed, and fanned out two levels.
   *
   * Identical to the filesystem store's layout on purpose: the same blob has the
   * same key in development and in production, so a key in an old audit row
   * still means something after the move.
   */
  key(sha256: string): string {
    return `blobs/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }

  /** `/bucket/key`, each segment encoded but the slashes kept as structure. */
  private pathFor(key: string): string {
    return `/${uriEncode(this.config.bucket)}/${uriEncode(key, true)}`;
  }

  async presignPut(sha256: string, expiresIn = 900): Promise<PresignedUpload> {
    const key = this.key(sha256);
    return {
      url: presign({
        method: 'PUT',
        host: this.host,
        path: this.pathFor(key),
        expiresIn,
        region: REGION,
        service: SERVICE,
        credentials: this.credentials,
        now: new Date(),
      }),
      key,
      expiresIn,
    };
  }

  private async send(method: string, key: string, body?: Buffer): Promise<Response> {
    const path = this.pathFor(key);
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : UNSIGNED_PAYLOAD;

    const headers = signRequest({
      method,
      path,
      headers: {
        host: this.host,
        ...(body ? { 'content-length': String(body.length) } : {}),
      },
      payloadHash,
      region: REGION,
      service: SERVICE,
      credentials: this.credentials,
      now: new Date(),
    });

    return fetch(`https://${this.host}${path}`, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${key} failed: ${res.status}`);

    /*
     * The hash comes from the key, not from the object's ETag. R2's ETag is MD5
     * for a single-part upload and something else entirely for a multipart one,
     * so trusting it would be right until a large file arrived. The key is
     * derived from SHA-256 by construction, and `get` re-hashes the bytes when
     * it actually matters.
     */
    return {
      key,
      size: Number(res.headers.get('content-length') ?? 0),
      sha256: key.split('/').pop() ?? '',
    };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send('GET', key);
    if (res.status === 404) throw new ObjectNotFoundError(key);
    if (!res.ok) throw new Error(`R2 GET ${key} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Direct upload. Used by the scan path and by tests; a real upload goes
   * browser → presigned URL → bucket and never passes through here.
   *
   * Refuses to replace different content at the same key. That cannot normally
   * happen — the key is the hash of the content — so if it does, something is
   * wrong enough that overwriting would destroy evidence.
   */
  async put(bytes: Buffer): Promise<StoredObject> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = this.key(sha256);

    const existing = await this.head(key);
    if (existing) {
      const current = await this.get(key);
      if (createHash('sha256').update(current).digest('hex') !== sha256) throw new ContentMismatchError(key);
      return existing;
    }

    const res = await this.send('PUT', key, bytes);
    if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status}`);
    return { key, size: bytes.length, sha256 };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    // 204 on success, 404 when it was already gone — both mean "not there now".
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
  }
}
