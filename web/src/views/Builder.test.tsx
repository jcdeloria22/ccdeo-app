/**
 * The Document Builder's surface.
 *
 * The layers underneath are vendored byte-identically and already proven against
 * 43 real BAC resolutions — re-testing them here would test the copy, not the
 * code. What is new, and therefore what is checked, is this file: that nothing
 * loads until the tab is opened, that a failure to load says what to do about it,
 * and that a built document can be filed into the register.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Builder from './Builder';
import * as load from '../builder/load';
import type { Builder as Kit } from '../builder/load';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A stand-in for the vendored libraries, shaped the way load.ts hands them over.
 *
 * The real ones work by mutation: `setState` keeps a reference to the caller's
 * state object and `mergeContract` pushes into it. The view depends on that, so
 * the fake has to do it too — a fake whose mergeContract is a no-op would make
 * the paste test pass for the wrong reason, or fail for the wrong one.
 */
function fakeKit(over: Partial<Kit> = {}): Kit {
  const pkg = { blob: async () => new Blob(['docx']) };
  let held: { contracts: unknown[] } | null = null;

  return {
    rules: { pickWinner: () => ({ name: 'ALEGRIA' }) },
    builders: { buildResolution: () => ({ resNo: '41' }), buildNotice: () => undefined },
    letters: {},
    docxkit: { openDocx: async () => pkg },
    extract: {},
    core: {
      setState: (s: unknown) => {
        held = s as { contracts: unknown[] };
      },
      parsePasted: (text: unknown) =>
        String(text).trim() ? [{ contractId: '26HH0041', name: 'Barangay Road', bidders: [] }] : [],
      mergeContract: (c: unknown) => {
        held?.contracts.push(c);
      },
      normalize: (c: unknown) => c,
      validate: () => ({ blockers: [] }),
      findAddressee: () => ({ short: 'ALEGRIA' }),
      shortOf: () => 'ALEGRIA',
      dataEntryCsv: () => 'a,b',
      stamp: () => '2026-09-15',
    },
    templates: { tplBacres: new ArrayBuffer(8), tplNotice: new ArrayBuffer(8) },
    contractors: {},
    JSZip: class {
      file() {}
      async generateAsync() {
        return new Blob(['zip']);
      }
    } as unknown as Kit['JSZip'],
    pdfjsLib: {},
    ...over,
  } as Kit;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/projects/')) {
        return json({
          project: { id: 'p1', contractId: '26HH0041', name: 'Barangay Road' },
          readiness: null,
          slots: [{ slotCode: 'qcp', name: 'Quality Control Program', required: true, state: 'Pending', waivedReason: null }],
          documents: [],
        });
      }
      if (url.startsWith('/projects')) {
        return json({ rows: [{ project: { id: 'p1', contractId: '26HH0041', name: 'Barangay Road' }, readiness: null }], total: 1 });
      }
      throw new Error(`unstubbed ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loading', () => {
  it('says what it is fetching, rather than showing a blank tab', async () => {
    let resolve!: (k: Kit) => void;
    vi.spyOn(load, 'loadBuilder').mockReturnValue(new Promise<Kit>((r) => (resolve = r)));

    render(<Builder />);
    expect(screen.getByText(/Fetching the templates and libraries/)).toBeTruthy();
    expect(screen.getByText(/happens once per visit/)).toBeTruthy();

    resolve(fakeKit());
    await waitFor(() => expect(screen.getByText(/abstract in, paperwork out/)).toBeTruthy());
  });

  /** A missing vendored file is a setup problem with a fix; say the fix. */
  it('explains a failure to load instead of showing an empty screen', async () => {
    vi.spyOn(load, 'loadBuilder').mockRejectedValue(
      new Error('Could not load /builder/rules.js. Run npm run sync:vendored.'),
    );
    render(<Builder />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/npm run sync:vendored/)).toBeTruthy();
  });

  it('reports what it loaded', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    render(<Builder />);
    await waitFor(() => expect(screen.getByText(/2 templates loaded/)).toBeTruthy());
  });
});

describe('reading contracts', () => {
  it('will not build with nothing to build from, and says why', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    render(<Builder />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Build them' })).toBeTruthy());
    const build = screen.getByRole('button', { name: 'Build them' });
    expect(build).toHaveProperty('disabled', true);
    expect(build.getAttribute('title')).toBe('Read an abstract or paste rows first');
  });

  it('takes pasted rows', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    const user = userEvent.setup();
    render(<Builder />);

    await waitFor(() => expect(screen.getByLabelText(/Or paste the rows/)).toBeTruthy());
    await user.type(screen.getByLabelText(/Or paste the rows/), '26HH0041 | 23,422,000.00');
    await user.click(screen.getByRole('button', { name: 'Use pasted rows' }));

    await waitFor(() => expect(screen.getByText(/Contracts read \(1\)/)).toBeTruthy());
    expect(screen.getByText(/1 row\(s\) pasted/)).toBeTruthy();
  });

  it('says so when a paste is unreadable rather than silently doing nothing', async () => {
    const kit = fakeKit();
    vi.spyOn(load, 'loadBuilder').mockResolvedValue({
      ...kit,
      core: { ...kit.core, parsePasted: () => [] },
    } as Kit);
    const user = userEvent.setup();
    render(<Builder />);

    await waitFor(() => expect(screen.getByLabelText(/Or paste the rows/)).toBeTruthy());
    await user.type(screen.getByLabelText(/Or paste the rows/), 'not a contract row');
    await user.click(screen.getByRole('button', { name: 'Use pasted rows' }));

    await waitFor(() => expect(screen.getByText(/Nothing readable in that paste/)).toBeTruthy());
  });
});

describe('building', () => {
  const pasteAndBuild = async () => {
    const user = userEvent.setup();
    render(<Builder />);
    await waitFor(() => expect(screen.getByLabelText(/Or paste the rows/)).toBeTruthy());
    await user.type(screen.getByLabelText(/Or paste the rows/), '26HH0041 | 1');
    await user.click(screen.getByRole('button', { name: 'Use pasted rows' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build them' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Build them' }));
    return user;
  };

  it('builds the documents and offers them individually and as a zip', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    await pasteAndBuild();

    await waitFor(() => expect(screen.getByText(/What it built/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Download all as .zip' })).toBeTruthy();
    expect(screen.getByText('BAC RES 41.docx')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Download' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'File it…' }).length).toBeGreaterThan(0);
  });

  /** The winner having no address on file is ordinary; it is logged, not an error. */
  it('skips a notice with no addressee and says which contract', async () => {
    const kit = fakeKit();
    vi.spyOn(load, 'loadBuilder').mockResolvedValue({
      ...kit,
      core: { ...kit.core, findAddressee: () => null },
    } as Kit);
    await pasteAndBuild();
    // The contract number is in the log line, so the reader knows which one it was.
    await waitFor(() => expect(screen.getByText(/no addressee on file for the winner/)).toBeTruthy());
    expect(document.querySelector('.buildlog')?.textContent).toMatch(/26HH0041: no addressee/);
  });

  it('refuses to build when the data is not ready, and shows what is missing', async () => {
    const kit = fakeKit();
    vi.spyOn(load, 'loadBuilder').mockResolvedValue({
      ...kit,
      core: { ...kit.core, validate: () => ({ blockers: ['26HH0041: no opening date'] }) },
    } as Kit);
    await pasteAndBuild();
    await waitFor(() => expect(screen.getByText(/no opening date/)).toBeTruthy());
    expect(screen.queryByText(/What it built/)).toBeNull();
  });
});

describe('filing what it built', () => {
  it('offers the contracts in the register, and their slots', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    const user = userEvent.setup();
    render(<Builder />);
    await waitFor(() => expect(screen.getByLabelText(/Or paste the rows/)).toBeTruthy());
    await user.type(screen.getByLabelText(/Or paste the rows/), '26HH0041 | 1');
    await user.click(screen.getByRole('button', { name: 'Use pasted rows' }));
    await user.click(screen.getByRole('button', { name: 'Build them' }));

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'File it…' })[0]).toBeTruthy());
    await user.click(screen.getAllByRole('button', { name: 'File it…' })[0]);

    await waitFor(() => expect(screen.getByLabelText('Contract')).toBeTruthy());
    expect(screen.getByText(/uploaded into the slot you choose, scanned, and recorded as a Draft/)).toBeTruthy();

    const file = screen.getByRole('button', { name: 'File it' });
    expect(file).toHaveProperty('disabled', true);
    expect(file.getAttribute('title')).toBe('Choose a contract and a slot first');

    await user.selectOptions(screen.getByLabelText('Contract'), 'p1');
    await waitFor(() => expect(screen.getByLabelText(/Which document is it/)).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Quality Control Program' })).toBeTruthy();
  });
});

/**
 * The paste format.
 *
 * The parser is vendored and takes field two as the ABC. The placeholder used to
 * show the contract name there, which reads naturally and is wrong — following it
 * produced "Unnamed, 0 bidders" with no explanation. These pin the guidance to
 * what `parsePasted` actually accepts, so the two cannot drift apart again.
 */
describe('the contract review list', () => {
  /**
   * `contractName` is what the resolution prints and what the data-entry sheet
   * carries. The list read `c.name` — a *bidder's* property — so every row said
   * "Unnamed" even when the abstract had supplied the name, and the only place
   * to discover the real one was the built .docx.
   */
  it('shows the name the built document will carry', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(
      fakeKit({
        core: {
          ...fakeKit().core,
          parsePasted: () => [
            { contractId: '26HH0041', contractName: 'Rehabilitation of Barangay Road', bidders: [{ name: 'ALEGRIA' }] },
          ],
        } as Kit['core'],
      }),
    );
    render(<Builder />);

    const box = await screen.findByLabelText(/Or paste the rows/);
    await userEvent.type(box, '26HH0041');
    await userEvent.click(screen.getByRole('button', { name: 'Use pasted rows' }));

    expect(screen.getByText('Rehabilitation of Barangay Road')).toBeTruthy();
    expect(screen.queryByText('Unnamed')).toBeNull();
  });

  it('says why a row has no name instead of labelling it Unnamed', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(
      fakeKit({
        core: {
          ...fakeKit().core,
          parsePasted: () => [{ contractId: '26HH0041', contractName: '', bidders: [] }],
        } as Kit['core'],
      }),
    );
    render(<Builder />);

    const box = await screen.findByLabelText(/Or paste the rows/);
    await userEvent.type(box, '26HH0041');
    await userEvent.click(screen.getByRole('button', { name: 'Use pasted rows' }));

    expect(screen.getByText('Not named yet')).toBeTruthy();
    expect(screen.getByText(/pasted rows carry no name/)).toBeTruthy();
  });
});

describe('the paste format guidance', () => {
  it('shows an example whose second field is an amount, not a name', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    render(<Builder />);

    const box = (await screen.findByLabelText(/Or paste the rows/)) as HTMLTextAreaElement;
    const fields = box.placeholder.split('	');

    expect(fields[0], 'first field is the contract id').toMatch(/^\d{2}[A-Z]{2}\d{4}$/);
    expect(fields[1], 'second field is the ABC, so it must parse as money').toMatch(/^[\d,]+\.\d{2}$/);
    expect(Number(fields[1].replace(/[^0-9.]/g, ''))).toBeGreaterThan(0);
  });

  it('names the separators, and warns off the comma', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    render(<Builder />);

    await screen.findByLabelText(/Or paste the rows/);
    expect(screen.getByText(/never a bare comma/)).toBeTruthy();
    expect(screen.getByText(/contract ID · ABC · advertised/)).toBeTruthy();
  });

  it('says the contract name does not come from the paste', async () => {
    vi.spyOn(load, 'loadBuilder').mockResolvedValue(fakeKit());
    render(<Builder />);

    await screen.findByLabelText(/Or paste the rows/);
    expect(screen.getByText(/The contract name is not taken from the paste/)).toBeTruthy();
  });
});
