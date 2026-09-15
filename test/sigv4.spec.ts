/**
 * Signature Version 4, checked against AWS's own published example.
 *
 * Hand-rolling a signing algorithm is only defensible if it is verified against
 * something authoritative rather than against itself. The vector below is the
 * presigned-URL example from the AWS documentation — credentials, bucket, date
 * and expected signature all published — so a mistake anywhere in canonical
 * request, scope, signing-key derivation or encoding produces a different
 * signature and fails here.
 *
 * The credentials are AWS's documentation examples. They are not secrets and
 * have never been valid.
 */
import { describe, it, expect } from 'vitest';
import { amzDate, presign, signingKey, signRequest, uriEncode, UNSIGNED_PAYLOAD } from '../src/storage/sigv4';

const EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const AT = new Date(Date.UTC(2013, 4, 24, 0, 0, 0));

describe('the published AWS example', () => {
  /**
   * "Example: Query String Request Authentication" — a presigned GET for
   * examplebucket/test.txt, valid 24 hours from 2013-05-24T00:00:00Z. The
   * expected signature is AWS's, not ours.
   */
  it('produces the signature AWS documents for a presigned GET', () => {
    const url = presign({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      expiresIn: 86400,
      region: 'us-east-1',
      service: 's3',
      credentials: EXAMPLE,
      now: AT,
    });

    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('carries every parameter the bucket needs to check it', () => {
    const url = new URL(
      presign({
        method: 'PUT',
        host: 'account.r2.cloudflarestorage.com',
        path: '/bucket/blobs/ab/cd/abcd',
        expiresIn: 900,
        region: 'auto',
        service: 's3',
        credentials: EXAMPLE,
        now: AT,
      }),
    );

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`${EXAMPLE.accessKeyId}/20130524/auto/s3/aws4_request`);
    expect(url.searchParams.get('X-Amz-Date')).toBe('20130524T000000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  /** The signing key is derived per day, region and service. */
  it('derives the documented signing key', () => {
    const key = signingKey(EXAMPLE.secretAccessKey, '20130524', 'us-east-1', 's3');
    expect(key.toString('hex')).toBe('dbb893acc010964918f1fd433add87c70e8b0db6be30c1fbeafefa5ec6ba8378');
  });
});

describe('what the signature covers', () => {
  const base = {
    method: 'PUT' as const,
    host: 'account.r2.cloudflarestorage.com',
    path: '/bucket/blobs/ab/cd/abcd',
    expiresIn: 900,
    region: 'auto',
    service: 's3',
    credentials: EXAMPLE,
    now: AT,
  };

  const signatureOf = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');

  /** Each of these must change the signature, or it is not actually covered. */
  it('covers the method, so a PUT URL cannot be replayed as a DELETE', () => {
    expect(signatureOf(presign(base))).not.toBe(signatureOf(presign({ ...base, method: 'DELETE' })));
  });

  it('covers the key, so one URL cannot be pointed at another object', () => {
    expect(signatureOf(presign(base))).not.toBe(signatureOf(presign({ ...base, path: '/bucket/blobs/ff/ee/ffee' })));
  });

  it('covers the host, so a URL cannot be aimed at another bucket', () => {
    expect(signatureOf(presign(base))).not.toBe(signatureOf(presign({ ...base, host: 'elsewhere.example.com' })));
  });

  it('covers the expiry, so the window cannot be widened', () => {
    expect(signatureOf(presign(base))).not.toBe(signatureOf(presign({ ...base, expiresIn: 86400 })));
  });

  it('changes with the moment it was signed', () => {
    const later = new Date(AT.getTime() + 60_000);
    expect(signatureOf(presign(base))).not.toBe(signatureOf(presign({ ...base, now: later })));
  });

  it('never puts the secret in the URL', () => {
    const url = presign(base);
    expect(url).not.toContain(EXAMPLE.secretAccessKey);
    expect(url).toContain(EXAMPLE.accessKeyId); // the id is public by design
  });
});

describe('encoding', () => {
  /**
   * `encodeURIComponent` leaves `!'()*` alone and the specification requires
   * them encoded. Getting this wrong produces a signature mismatch only for keys
   * containing those characters — which is exactly the kind of bug that passes
   * every test until a real filename hits it.
   */
  it('encodes the characters encodeURIComponent leaves behind', () => {
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(encodeURIComponent("!'()*")).toBe("!'()*"); // what we must not do
  });

  it('leaves the unreserved set alone', () => {
    expect(uriEncode('abcXYZ019-._~')).toBe('abcXYZ019-._~');
  });

  it('encodes a slash unless it is part of a path', () => {
    expect(uriEncode('a/b')).toBe('a%2Fb');
    expect(uriEncode('a/b', true)).toBe('a/b');
  });

  it('encodes spaces as %20, never as +', () => {
    expect(uriEncode('a b')).toBe('a%20b');
  });

  it('handles multi-byte characters a byte at a time', () => {
    expect(uriEncode('ñ')).toBe('%C3%B1');
  });
});

describe('the timestamp', () => {
  it('is the compact form the algorithm expects', () => {
    expect(amzDate(AT)).toEqual({ long: '20130524T000000Z', short: '20130524' });
  });
});

describe('signing a request the server makes itself', () => {
  it('returns an authorization header naming the algorithm, scope and signed headers', () => {
    const headers = signRequest({
      method: 'GET',
      path: '/bucket/blobs/ab/cd/abcd',
      headers: { host: 'account.r2.cloudflarestorage.com' },
      payloadHash: UNSIGNED_PAYLOAD,
      region: 'auto',
      service: 's3',
      credentials: EXAMPLE,
      now: AT,
    });

    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/auto\/s3\//);
    expect(headers.authorization).toMatch(/SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('never leaks the secret into a header', () => {
    const headers = signRequest({
      method: 'GET',
      path: '/bucket/x',
      headers: { host: 'h' },
      payloadHash: UNSIGNED_PAYLOAD,
      region: 'auto',
      service: 's3',
      credentials: EXAMPLE,
      now: AT,
    });
    expect(JSON.stringify(headers)).not.toContain(EXAMPLE.secretAccessKey);
  });
});
