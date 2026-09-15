/**
 * AWS Signature Version 4, for talking to R2.
 *
 * Written out rather than pulling in the AWS SDK. That is a deliberate trade and
 * worth stating: the SDK is tens of megabytes of dependency for five operations
 * against one bucket, and this project has kept to eight dependencies and no
 * native builds on purpose — the same reasoning that chose scrypt over bcrypt.
 *
 * Hand-rolling a signing algorithm is only reasonable when two things hold, and
 * both do here:
 *
 *  1. **It fails loudly.** A wrong signature is a 403 from the bucket. There is
 *     no mode where a miscalculation quietly grants access it should not — the
 *     failure is a broken upload, visible immediately, not a silent hole.
 *  2. **It is checkable.** The algorithm is specified exactly and AWS publishes
 *     test vectors. `sigv4.spec.ts` verifies this implementation against the
 *     published presigned-URL example, so "it looks right" is not the standard.
 *
 * R2 speaks the S3 API with region `auto`. Nothing here is R2-specific.
 */
import { createHash, createHmac } from 'node:crypto';

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Percent-encoding as the specification requires, which is not what
 * `encodeURIComponent` does: it leaves `!'()*` alone and those must be encoded.
 * The path variant keeps `/` because a key's slashes are structure.
 */
export function uriEncode(value: string, keepSlashes = false): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlashes && ch === '/')) {
      out += ch;
      continue;
    }
    for (const byte of Buffer.from(ch, 'utf8')) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** `20130524T000000Z` and `20130524`. */
export function amzDate(now: Date): { long: string; short: string } {
  const long = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

/** Query parameters sorted by name then value, each side encoded. */
function canonicalQuery(params: ReadonlyArray<readonly [string, string]>): string {
  return [...params]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Lower-cased names, values trimmed, sorted — the signature depends on it. */
function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(''),
    signed: entries.map(([k]) => k).join(';'),
  };
}

export function signingKey(secret: string, short: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, short), region), service), 'aws4_request');
}

export interface SignInput {
  method: string;
  /** Already-encoded path, beginning with `/`. */
  path: string;
  query?: ReadonlyArray<readonly [string, string]>;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED_PAYLOAD. */
  payloadHash: string;
  region: string;
  service: string;
  credentials: Credentials;
  now: Date;
}

/**
 * Sign a request, returning the headers to send.
 *
 * Used for the operations the server performs itself — reading an object back to
 * re-hash it, and deleting one. The browser never does this; it gets a presigned
 * URL instead.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const { long, short } = amzDate(input.now);
  const headers: Record<string, string> = {
    ...input.headers,
    'x-amz-date': long,
    'x-amz-content-sha256': input.payloadHash,
  };

  const { canonical, signed } = canonicalHeaders(headers);
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.query ?? []),
    canonical,
    signed,
    input.payloadHash,
  ].join('\n');

  const scope = `${short}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(
    signingKey(input.credentials.secretAccessKey, short, input.region, input.service),
    stringToSign,
  ).toString('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signed}, Signature=${signature}`,
  };
}

export interface PresignInput {
  method: string;
  host: string;
  /** Already-encoded path, beginning with `/`. */
  path: string;
  expiresIn: number;
  region: string;
  service: string;
  credentials: Credentials;
  now: Date;
  /** Extra query parameters to include in the signature. */
  query?: ReadonlyArray<readonly [string, string]>;
}

/**
 * A URL that carries its own authority for a limited time.
 *
 * This is what makes "the API never proxies file bytes" possible: the browser
 * PUTs straight to the bucket with this, and the app's credentials never leave
 * the server. Only `host` is signed, so the caller may not change the target;
 * everything else a client could tamper with is in the signature too.
 */
export function presign(input: PresignInput): string {
  const { long, short } = amzDate(input.now);
  const scope = `${short}/${input.region}/${input.service}/aws4_request`;

  const query: Array<readonly [string, string]> = [
    ...(input.query ?? []),
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`],
    ['X-Amz-Date', long],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ];

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(query),
    `host:${input.host}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(
    signingKey(input.credentials.secretAccessKey, short, input.region, input.service),
    stringToSign,
  ).toString('hex');

  return `https://${input.host}${input.path}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}
