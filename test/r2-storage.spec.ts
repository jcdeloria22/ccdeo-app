/**
 * The R2 store.
 *
 * Driven against a stubbed bucket rather than a real one: what is worth proving
 * is the contract the rest of the system depends on — that a key is derived from
 * content and matches the filesystem store's layout, that an upload URL carries
 * its own authority and nothing else, that a missing object is a typed error
 * rather than an empty buffer, and that no credential ever reaches a URL, a
 * header this code logs, or an error message.
 *
 * The signing itself is verified against AWS's published vectors in
 * `sigv4.spec.ts`; this checks how the store uses it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { R2Storage } from '../src/storage/r2.storage';
import { FilesystemStorage } from '../src/storage/filesystem.storage';
import { ContentMismatchError, ObjectNotFoundError } from '../src/storage/storage';

const CONFIG = {
  accountId: 'acct123',
  bucket: 'dpwh-documents',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const store = () => new R2Storage(CONFIG);
const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/** A bucket that remembers what it was asked and answers as R2 would. */
function bucket(objects: Record<string, Buffer> = {}) {
  const seen: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string> });

      const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ''));
      const body = objects[key];

      if (method === 'PUT') {
        objects[key] = Buffer.from((init?.body as Uint8Array) ?? []);
        return new Response(null, { status: 200 });
      }
      if (method === 'DELETE') {
        delete objects[key];
        return new Response(null, { status: 204 });
      }
      if (!body) return new Response(null, { status: 404 });
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': String(body.length) } });
      }
      return new Response(new Uint8Array(body), { status: 200 });
    }),
  );
  return { seen, objects };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the key', () => {
  /**
   * The same blob must have the same key in development and in production, or a
   * key recorded in an old audit row stops meaning anything after the move.
   */
  it('is identical to the filesystem store’s, so a recorded key survives the move', () => {
    const local = new FilesystemStorage('/tmp/whatever');
    const sha = hashOf('a quality control programme');
    expect(store().key(sha)).toBe(local.key(sha));
  });

  it('is derived from the content, two levels deep', () => {
    const sha = hashOf('x');
    expect(store().key(sha)).toBe(`blobs/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`);
  });
});

describe('the upload URL', () => {
  it('points at the bucket and the content-addressed key', async () => {
    const sha = hashOf('report');
    const { url, key } = await store().presignPut(sha);
    const parsed = new URL(url);

    expect(parsed.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe(`/${CONFIG.bucket}/${key}`);
    expect(parsed.protocol).toBe('https:');
  });

  /** The whole point of presigning: the API never handles the bytes. */
  it('carries its own authority and expires', async () => {
    const { url, expiresIn } = await store().presignPut(hashOf('report'), 600);
    const parsed = new URL(url);

    expect(expiresIn).toBe(600);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the secret', async () => {
    const { url } = await store().presignPut(hashOf('report'));
    expect(url).not.toContain(CONFIG.secretAccessKey);
    expect(url).not.toContain(encodeURIComponent(CONFIG.secretAccessKey));
  });

  it('is an https URL, never the development file+put:// placeholder', async () => {
    const { url } = await store().presignPut(hashOf('report'));
    expect(url.startsWith('https://')).toBe(true);
    expect(url).not.toContain('file+put');
  });
});

describe('reading an object back', () => {
  it('returns the bytes that were stored', async () => {
    const bytes = Buffer.from('a trial section report');
    const key = store().key(hashOf('a trial section report'));
    bucket({ [key]: bytes });

    expect((await store().get(key)).equals(bytes)).toBe(true);
  });

  /** Re-hashing is how a claim about an upload is checked rather than believed. */
  it('returns bytes that still hash to the key they were stored under', async () => {
    const text = 'a trial section report';
    const sha = hashOf(text);
    const key = store().key(sha);
    bucket({ [key]: Buffer.from(text) });

    const back = await store().get(key);
    expect(createHash('sha256').update(back).digest('hex')).toBe(sha);
  });

  it('raises a typed error for something that is not there, rather than empty bytes', async () => {
    bucket({});
    await expect(store().get('blobs/00/00/missing')).rejects.toThrow(ObjectNotFoundError);
  });

  it('reports the size without fetching the body', async () => {
    const key = store().key(hashOf('big'));
    const { seen } = bucket({ [key]: Buffer.alloc(4096) });

    const head = await store().head(key);
    expect(head?.size).toBe(4096);
    expect(seen.at(-1)?.method).toBe('HEAD');
  });

  it('answers null for a head on something absent', async () => {
    bucket({});
    expect(await store().head('blobs/00/00/missing')).toBeNull();
  });
});

describe('storing bytes directly', () => {
  it('stores under the hash of the content', async () => {
    const { objects } = bucket({});
    const bytes = Buffer.from('mix design');
    const stored = await store().put(bytes);

    expect(stored.sha256).toBe(hashOf('mix design'));
    expect(stored.size).toBe(bytes.length);
    expect(objects[stored.key].equals(bytes)).toBe(true);
  });

  it('is idempotent — the same bytes twice is one object', async () => {
    const { objects } = bucket({});
    const bytes = Buffer.from('mix design');

    const a = await store().put(bytes);
    const b = await store().put(bytes);

    expect(a.key).toBe(b.key);
    expect(Object.keys(objects)).toHaveLength(1);
  });

  /**
   * Cannot normally happen, because the key is the hash of the content. If it
   * does, something is wrong enough that overwriting would destroy evidence.
   */
  it('refuses to replace different content at the same key', async () => {
    const sha = hashOf('the real report');
    const key = store().key(sha);
    bucket({ [key]: Buffer.from('something else entirely') });

    await expect(store().put(Buffer.from('the real report'))).rejects.toThrow(ContentMismatchError);
  });
});

describe('deleting', () => {
  it('removes the object', async () => {
    const key = store().key(hashOf('gone'));
    const { objects } = bucket({ [key]: Buffer.from('gone') });

    await store().delete(key);
    expect(objects[key]).toBeUndefined();
  });

  it('does not complain about something already absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(store().delete('blobs/00/00/missing')).resolves.toBeUndefined();
  });
});

describe('credentials', () => {
  it('never appear in a request URL', async () => {
    const key = store().key(hashOf('x'));
    const { seen } = bucket({ [key]: Buffer.from('x') });
    await store().get(key);

    for (const r of seen) expect(r.url).not.toContain(CONFIG.secretAccessKey);
  });

  it('never appear in an error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    try {
      await store().get('blobs/00/00/x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain(CONFIG.secretAccessKey);
      expect((e as Error).message).toContain('500');
    }
  });

  it('go in the authorization header, not the query string, for server-side calls', async () => {
    const key = store().key(hashOf('x'));
    const { seen } = bucket({ [key]: Buffer.from('x') });
    await store().get(key);

    const call = seen.at(-1)!;
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(new URL(call.url).searchParams.get('X-Amz-Signature')).toBeNull();
  });
});

describe('a compatible store that is not R2', () => {
  it('honours an explicit endpoint, so MinIO works locally', async () => {
    const minio = new R2Storage({ ...CONFIG, endpoint: 'http://localhost:9000' });
    const { url } = await minio.presignPut(hashOf('x'));
    expect(new URL(url).host).toBe('localhost:9000');
  });
});
