/**
 * The fetch wrapper.
 *
 * The rule worth testing here is a product rule, not a plumbing one: a failed
 * request must throw. Returning `[]` would render an empty inbox, which looks
 * exactly like "nothing needs you" — the one thing this application must never
 * say by accident.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, readinessApi } from './api';

const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
  const spy = vi.fn(impl as never);
  vi.stubGlobal('fetch', spy);
  return spy;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a successful call', () => {
  it('returns the parsed body', async () => {
    mockFetch(() => json({ unread: 3, unreadOverdue: 2, unreadWarning: 1, total: 9 }));
    expect(await api.counts()).toEqual({ unread: 3, unreadOverdue: 2, unreadWarning: 1, total: 9 });
  });

  it('asks for JSON', async () => {
    const f = mockFetch(() => json({}));
    await api.counts();
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).accept).toBe('application/json');
  });
});

describe('query strings', () => {
  it('sends a filter when it is on', async () => {
    const f = mockFetch(() => json({ items: [], counts: {} }));
    await api.inbox({ unread: true });
    expect(f.mock.calls[0][0]).toBe('/reminders?unread=true');
  });

  /** `false` means "no filter", not "filter by false" — an omitted param, not `unread=false`. */
  it('omits a filter that is off rather than sending false', async () => {
    const f = mockFetch(() => json({ items: [], counts: {} }));
    await api.inbox({ unread: false });
    expect(f.mock.calls[0][0]).toBe('/reminders');
  });

  it('omits an absent projectId', async () => {
    const f = mockFetch(() => json({ items: [] }));
    await readinessApi.debt(undefined);
    expect(f.mock.calls[0][0]).toBe('/readiness/debt');
  });

  it('sends a projectId when given one', async () => {
    const f = mockFetch(() => json({ items: [] }));
    await readinessApi.debt('abc-123');
    expect(f.mock.calls[0][0]).toBe('/readiness/debt?projectId=abc-123');
  });
});

describe('a failed call', () => {
  it('throws rather than returning an empty result', async () => {
    mockFetch(() => json({ message: 'nope' }, 500));
    await expect(api.inbox()).rejects.toBeInstanceOf(ApiError);
  });

  it('carries the status and the server message', async () => {
    mockFetch(() => json({ message: 'limit must be a whole number between 1 and 500' }, 400));
    await expect(api.counts()).rejects.toThrow(/limit must be a whole number/);
    await api.counts().catch((e: ApiError) => expect(e.status).toBe(400));
  });

  it('joins an array of validation messages', async () => {
    mockFetch(() => json({ message: ['one is wrong', 'two is wrong'] }, 400));
    await expect(api.counts()).rejects.toThrow(/one is wrong; two is wrong/);
  });

  it('falls back to the status text when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(api.counts()).rejects.toThrow(/Bad Gateway/);
  });

  /** The server is on loopback and often simply not running. Say so. */
  it('explains a network failure instead of surfacing a raw TypeError', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.counts()).rejects.toThrow(/Could not reach the server.*127\.0\.0\.1:3000/s);
    await api.counts().catch((e: ApiError) => expect(e.status).toBe(0));
  });
});
