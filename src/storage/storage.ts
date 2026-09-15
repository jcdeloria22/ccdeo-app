/**
 * DC-06 — object storage, behind the seam R2 will slot into.
 *
 *   > Storage: Cloudflare R2, jurisdiction apac. MinIO in Docker locally. Never
 *   > Railway's filesystem — it is ephemeral. Uploads go browser → pre-signed PUT
 *   > → bucket; the API never proxies file bytes.
 *
 * The interface is shaped for that even though the development implementation
 * writes to a local directory: blobs are addressed by content hash, and callers
 * get a URL to upload to rather than handing bytes to the API. Swapping in R2 is
 * one implementation of this interface.
 *
 *   > Blobs are immutable and content-addressed by SHA-256. New version = new
 *   > row, new hash. Never overwrite.
 *
 * So `key()` is derived from the content, and `put` refuses to change an existing
 * object rather than silently overwriting it.
 */
export interface PresignedUpload {
  /** Where the client PUTs the bytes. */
  readonly url: string;
  /** The key the object will have once uploaded. */
  readonly key: string;
  /** Seconds until the URL stops working. */
  readonly expiresIn: number;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly sha256: string;
}

export interface Storage {
  /** Content-addressed key for a hash. Same content, same key, always. */
  key(sha256: string): string;

  /** A URL the client uploads to. The API never sees the bytes. */
  presignPut(sha256: string, expiresIn?: number): Promise<PresignedUpload>;

  /** Whether the object is present, and its metadata. */
  head(key: string): Promise<StoredObject | null>;

  /** Read it back. Only used server-side for scanning and verification. */
  get(key: string): Promise<Buffer>;

  /**
   * Store bytes directly. Development and tests only — production uploads go
   * browser → bucket. Refuses to overwrite different content at the same key.
   */
  put(bytes: Buffer): Promise<StoredObject>;

  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No object at ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class ContentMismatchError extends Error {
  constructor(key: string) {
    super(
      `Refusing to overwrite ${key} with different content. Blobs are immutable and content-addressed; ` +
        'a new version is a new object.',
    );
    this.name = 'ContentMismatchError';
  }
}

export function sha256Of(bytes: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
