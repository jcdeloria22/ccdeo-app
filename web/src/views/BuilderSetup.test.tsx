/**
 * The Builder's letters and reference data.
 *
 * The letters test exists because of a bug it would have caught: `buildProse`
 * and `buildPacc` read a `cfg.sched` that the standalone Builder never built, so
 * every letter it attempted failed on an undefined property. The schedule is
 * derived from the opening date by `rules.deriveSchedule` — that call is what is
 * asserted, because it is the thing that was missing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Letters, Setup } from './BuilderSetup';
import type { Builder as Kit } from '../builder/load';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Calls {
  derive: { opening: string; opts: { extraHolidays?: string[] } }[];
  prose: unknown[];
  pacc: unknown[];
}

function fakeKit(calls: Calls): Kit {
  const pkg = { blob: async () => new Blob(['docx']) };
  return {
    rules: {
      deriveSchedule: (opening: unknown, opts: unknown) => {
        calls.derive.push({ opening: String(opening), opts: opts as { extraHolidays?: string[] } });
        return { opening, bidEvalText: 'Sep 16-17', postQualText: 'Sep 18-22', paccRow: ['a', 'b', 'c'] };
      },
      letterDate: (d: unknown) => `formatted ${String(d)}`,
    },
    builders: {},
    letters: {
      buildProse: (_p: unknown, cfg: unknown) => calls.prose.push(cfg),
      buildPacc: (_p: unknown, cfg: unknown) => calls.pacc.push(cfg),
    },
    docxkit: { openDocx: async () => pkg },
    extract: {},
    core: {},
    templates: {
      tplBacres: new ArrayBuffer(8),
      tplNotice: new ArrayBuffer(8),
      tplCebuContractors: new ArrayBuffer(8),
      tplPICE: new ArrayBuffer(8),
      tplAuditor: new ArrayBuffer(8),
      tplPACC: new ArrayBuffer(8),
    },
    contractors: { a: {}, b: {} },
    JSZip: class {
      file() {}
      async generateAsync() {
        return new Blob(['zip']);
      }
    } as unknown as Kit['JSZip'],
    pdfjsLib: {},
  } as unknown as Kit;
}

const blankCalls = (): Calls => ({ derive: [], prose: [], pacc: [] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the witness letters', () => {
  it('will not build without a contract, and says which tab to fix it on', async () => {
    const calls = blankCalls();
    render(<Letters kit={fakeKit(calls)} contracts={[]} holidays={[]} say={() => {}} />);

    const btn = screen.getByRole('button', { name: 'Build the four letters' });
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.getAttribute('title')).toBe('Load at least one contract first');
    expect(screen.getByText(/cannot be written without at least one/)).toBeTruthy();
    expect(screen.getByText(/Build documents tab/)).toBeTruthy();
  });

  it('will not build without the dates it prints', async () => {
    const calls = blankCalls();
    render(<Letters kit={fakeKit(calls)} contracts={[{ contractId: '26HH0041' }]} holidays={[]} say={() => {}} />);

    const btn = screen.getByRole('button', { name: 'Build the four letters' });
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.getAttribute('title')).toBe('A letter date and an opening date are needed');
  });

  /** The bug this file exists for. */
  it('derives the schedule from the opening date, using the holidays on file', async () => {
    const calls = blankCalls();
    const user = userEvent.setup();
    render(
      <Letters
        kit={fakeKit(calls)}
        contracts={[{ contractId: '26HH0041' }]}
        holidays={['2026-11-02']}
        say={() => {}}
      />,
    );

    await user.type(screen.getByLabelText('Letter date'), '2026-09-01');
    await user.type(screen.getByLabelText('Opening date'), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Build the four letters' }));

    await waitFor(() => expect(calls.derive).toHaveLength(1));
    expect(calls.derive[0].opening).toBe('2026-09-15');
    expect(calls.derive[0].opts.extraHolidays).toEqual(['2026-11-02']);
  });

  it('hands every letter the schedule, so none fails on an undefined sched', async () => {
    const calls = blankCalls();
    const user = userEvent.setup();
    render(
      <Letters kit={fakeKit(calls)} contracts={[{ contractId: '26HH0041' }]} holidays={[]} say={() => {}} />,
    );

    await user.type(screen.getByLabelText('Letter date'), '2026-09-01');
    await user.type(screen.getByLabelText('Opening date'), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Build the four letters' }));

    await waitFor(() => expect(calls.prose).toHaveLength(3));
    expect(calls.pacc).toHaveLength(1);
    for (const cfg of [...calls.prose, ...calls.pacc]) {
      const c = cfg as { sched?: { paccRow?: unknown }; prebid?: string; contracts?: unknown[] };
      expect(c.sched, 'a letter was built without a schedule — the original bug').toBeDefined();
      expect(c.sched?.paccRow).toBeDefined();
      expect(c.prebid).toBeDefined();
      expect(c.contracts).toHaveLength(1);
    }
  });

  it('falls back to the opening date when no pre-bid date is given', async () => {
    const calls = blankCalls();
    const user = userEvent.setup();
    render(
      <Letters kit={fakeKit(calls)} contracts={[{ contractId: '26HH0041' }]} holidays={[]} say={() => {}} />,
    );

    await user.type(screen.getByLabelText('Letter date'), '2026-09-01');
    await user.type(screen.getByLabelText('Opening date'), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Build the four letters' }));

    await waitFor(() => expect(calls.prose.length).toBeGreaterThan(0));
    expect((calls.prose[0] as { prebid: string }).prebid).toBe('formatted 2026-09-15');
  });
});

describe('setup', () => {
  const stub = (signatories: unknown, holidays: unknown, onPut?: (k: string, v: unknown) => void) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { value: unknown };
          onPut?.(url, body.value);
          return json({ setting: { key: url, value: body.value, updatedAt: '2026-09-15T10:00:00Z', updatedBy: 'x', updatedByRole: 'admin' } });
        }
        if (url.includes('signatories')) {
          return json({ setting: signatories === null ? null : { key: 'builder.signatories', value: signatories, updatedAt: '2026-09-15T10:00:00Z', updatedBy: 'x', updatedByRole: 'admin' } });
        }
        return json({ setting: holidays === null ? null : { key: 'builder.holidays', value: holidays, updatedAt: '2026-09-15T10:00:00Z', updatedBy: 'x', updatedByRole: 'admin' } });
      }),
    );

  it('shows every template as loaded', async () => {
    stub(null, null);
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);

    await waitFor(() => expect(screen.getByText('BAC Resolution')).toBeTruthy());
    const chips = [...document.querySelectorAll('.remlist .level')].map((e) => e.textContent);
    expect(chips).toHaveLength(6);
    expect(chips.every((c) => c === 'Loaded')).toBe(true);
  });

  it('loads signatories from the server and says when they last changed', async () => {
    stub({ chair: 'Engr. A. Santos', vice: '', de: '', so: '' }, []);
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);

    await waitFor(() => expect((screen.getByLabelText('BAC Chairperson') as HTMLInputElement).value).toBe('Engr. A. Santos'));
    expect(screen.getByText(/The change is audited/)).toBeTruthy();
  });

  it('explains that the notice date decides which signatory prints', async () => {
    stub(null, null);
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);
    await waitFor(() => expect(screen.getByText(/never by today’s date/)).toBeTruthy());
  });

  it('saves a changed signatory to the server', async () => {
    const puts: { key: string; value: unknown }[] = [];
    stub({ chair: 'Old', vice: '', de: '', so: '' }, [], (k, v) => puts.push({ key: k, value: v }));
    const user = userEvent.setup();
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);

    await waitFor(() => expect((screen.getByLabelText('BAC Chairperson') as HTMLInputElement).value).toBe('Old'));
    await user.clear(screen.getByLabelText('BAC Chairperson'));
    await user.type(screen.getByLabelText('BAC Chairperson'), 'New');
    await user.click(screen.getByRole('button', { name: 'Save signatories' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].key).toContain('builder.signatories');
    expect((puts[0].value as { chair: string }).chair).toBe('New');
  });

  it('will not add the same holiday twice, and says why', async () => {
    stub(null, ['2026-11-02']);
    const user = userEvent.setup();
    render(<Setup kit={fakeKit(blankCalls())} holidays={['2026-11-02']} setHolidays={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText('Date')).toBeTruthy());
    await user.type(screen.getByLabelText('Date'), '2026-11-02');

    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toHaveProperty('disabled', true);
    expect(add.getAttribute('title')).toBe('That date is already listed');
  });

  it('explains why proclaimed holidays matter', async () => {
    stub(null, []);
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);
    await waitFor(() => expect(screen.getByText(/moves every date calculated from it/)).toBeTruthy());
    expect(screen.getByText('None added.')).toBeTruthy();
  });

  it('counts the contractors on file', async () => {
    stub(null, []);
    render(<Setup kit={fakeKit(blankCalls())} holidays={[]} setHolidays={() => {}} />);
    await waitFor(() => expect(screen.getByText(/2 on file/)).toBeTruthy());
    expect(screen.getByText(/skipped rather than addressed to a guess/)).toBeTruthy();
  });
});
