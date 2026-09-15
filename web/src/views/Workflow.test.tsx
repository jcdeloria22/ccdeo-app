/**
 * The ME Workflow's screen.
 *
 * The rules for reading the content are proven in `workflow/content.test.ts`.
 * What is checked here is what only the screen can get wrong: that a step's
 * detail is not on screen until it is opened, that the testing tables say what
 * tier they are and that the generator does not read them, that a tick reaches
 * the server and is taken back off the screen if it does not, and that the
 * study path states where progress is actually kept — the vendored intro says
 * "this browser only", which was true of the standalone file and is not true
 * here.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Workflow from './Workflow';
import * as load from '../reviewer/load';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const WORKFLOW = {
  FLOW_META: {
    materials: {
      intro: 'The materials cycle. <b>QC is the contractor\u2019s; QA is DPWH\u2019s.</b>',
      legend: [
        ['var(--blu)', 'Contractor QC'],
        ['var(--grn)', 'DPWH QA'],
      ],
      labels: { qc: 'Contractor QC', qa: 'DPWH QA' },
    },
    geotech: { intro: 'Subsurface investigation.', legend: [['var(--cyan)', 'Planning']], labels: { plan: 'Planning' } },
    pe: { intro: 'The project lifecycle.', legend: [['var(--pur)', 'Module']], labels: { mod: 'Module' } },
  },
  FLOWS: {
    materials: [
      {
        ph: 'Before delivery',
        when: 'Pre-construction',
        steps: [
          {
            r: 'qc',
            t: 'Submit the Quality Control Program',
            d: 'The contractor submits the QCP before the first delivery.',
            who: 'Contractor Materials Engineer',
            out: 'Approved QCP',
            note: 'Only the DPWH ME recommends acceptance.',
            refs: ['QCP', 'MTR Vol II'],
          },
        ],
      },
    ],
    geotech: [{ ph: 'Desk study', when: 'Before mobilization', steps: [] }],
    pe: [{ ph: 'Module 1', when: 'Days 1-4', steps: [] }],
  },
  MATS: [
    {
      id: 'soils',
      ic: '\u26f0\ufe0f',
      n: 'Soils & Embankment',
      s: 'Item 104',
      rows: [['Field Density Test', 'AASHTO T 191', '3 per 500 m\u00b2 per layer', '95% of MDD']],
      note: 'Unsuitable material is named in the specification.',
    },
  ],
  DAYS: { MTT: { 1: 'Sampling', 2: 'Concrete', 5: 'Acceptance' }, PE: { 1: 'Environmental clearance' } },
  STUDY_INTRO: { MTT: 'Progress is saved in this browser only.', PE: 'Four modules.' },
};

const INVENTORY = {
  generated: '2026-08-26 20:01',
  root: 'D:\\References',
  totalFiles: 3,
  totalBytes: 3_590_726_846,
  byDomain: { materials: 2, policy: 1 },
  byTrack: { MTT: 2, 'DPWH Issuances': 1 },
  byKind: { lecture: 2, issuance: 1 },
  byExt: { pdf: 3 },
  byMaterial: { soils: 2, 'n/a': 1 },
  files: [
    { p: 'MTT\\Day 1\\sampling.pdf', n: 'sampling.pdf', t: 'MTT', g: 'Day 1', x: 'pdf', dm: 'materials', m: 'soils', k: 'lecture', s: 1_048_576, d: '2026-08-26', day: 1 },
    { p: 'MTT\\Day 2\\concrete.pdf', n: 'concrete.pdf', t: 'MTT', g: 'Day 2', x: 'pdf', dm: 'materials', m: 'soils', k: 'lecture', s: 2_097_152, d: '2026-08-26', day: 2 },
    { p: 'Issuances\\DO 075 s.2024.pdf', n: 'DO 075 s.2024.pdf', t: 'DPWH Issuances', g: '(top level)', x: 'pdf', dm: 'policy', m: 'n/a', k: 'issuance', s: 512, d: '2026-08-26', day: 0 },
  ],
};

/** The generator's verified record, in the shape the controller returns it. */
const RULES = {
  version: 'mtr-vol-ii-2012ed-2016-12',
  items: ['200', '201'],
  rules: [
    {
      id: 'qc.200.cbr-abrasion',
      item: '200',
      test: 'CBR and abrasion',
      frequency: '1 per 3,000 m³',
      perQuantity: 3000,
      basisUnit: 'm3',
      provenance: { sourceDocument: 'MTR Vol II', sourceSection: 'Item 200', sourceYear: 2016, tier: 2, verifiedBy: 'Jayz', verifiedOn: '2026-08-25' },
      acceptance: {
        requirement: 'Soaked CBR not less than 30% (AASHTO T 193).',
        provenance: {
          sourceDocument: 'DPWH Standard Specifications, Volume II',
          sourceSection: '§200.2',
          sourceYear: 2013,
          tier: 1,
          verifiedBy: 'extracted-from-source-pdf',
          verifiedOn: '2026-09-15',
          countersignedBy: 'Jayz',
          countersignedOn: '2026-09-15',
          caveat: 'read from the 2013 edition held in the vault',
        },
      },
    },
    {
      /* A frequency with no limit read from a source is not a verification. */
      id: 'qc.201.frequency-only',
      item: '201',
      test: 'Grading',
      frequency: '1 per 300 m³',
      perQuantity: 300,
      basisUnit: 'm3',
      provenance: { sourceDocument: 'MTR Vol II', sourceSection: 'Item 201', sourceYear: 2016, tier: 2, verifiedBy: 'Jayz', verifiedOn: '2026-08-25' },
    },
  ],
};

let calls: { url: string; method: string; body?: string }[] = [];

function stubApi(get: unknown = { progress: null }, putFails = false, rulesFails = false) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url === '/generators/qcp/rules') {
        return rulesFails ? json({ message: 'nope' }, 500) : json(RULES);
      }
      if (url.startsWith('/quiz/workflow')) {
        if (method === 'GET') return json(get);
        if (method === 'PUT') {
          return putFails ? json({ message: 'The database is not reachable.' }, 503) : json({ progress: {} });
        }
      }
      throw new Error(`unstubbed ${method} ${url}`);
    }),
  );
}

const puts = () => calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  stubApi();
  vi.spyOn(load, 'loadWorkflow').mockResolvedValue({ workflow: WORKFLOW, inventory: INVENTORY });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = async (tab: string) => userEvent.click(await screen.findByRole('button', { name: tab }));

describe('loading', () => {
  it('says what it is fetching rather than showing a blank tab', async () => {
    vi.spyOn(load, 'loadWorkflow').mockReturnValue(new Promise(() => {}));
    render(<Workflow />);
    expect(screen.getByText(/Fetching the workflow content and the file index/)).toBeTruthy();
  });

  it('explains a failure to load instead of showing an empty screen', async () => {
    vi.spyOn(load, 'loadWorkflow').mockRejectedValue(
      new Error('Could not load /data/workflow-data.js. Run npm run sync:vendored.'),
    );
    render(<Workflow />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/npm run sync:vendored/)).toBeTruthy();
  });

  it('counts what it has, across all three flows', async () => {
    render(<Workflow />);
    await waitFor(() => expect(screen.getByText(/1 steps · 1 testing rows · 3 files/)).toBeTruthy());
  });
});

describe('the process flows', () => {
  it('keeps a step\u2019s detail closed until it is opened', async () => {
    render(<Workflow />);
    await waitFor(() => expect(screen.getByText('Submit the Quality Control Program')).toBeTruthy());

    expect(screen.queryByText(/before the first delivery/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Submit the Quality Control Program/ }));

    expect(screen.getByText(/before the first delivery/)).toBeTruthy();
    expect(screen.getByText('Contractor Materials Engineer')).toBeTruthy();
    expect(screen.getByText('Approved QCP')).toBeTruthy();
    expect(screen.getByText(/Only the DPWH ME recommends acceptance/)).toBeTruthy();
    expect(screen.getByText('MTR Vol II')).toBeTruthy();
  });

  it('marks the open state for a screen reader, not only with a plus sign', async () => {
    render(<Workflow />);
    const step = await screen.findByRole('button', { name: /Submit the Quality Control Program/ });
    expect(step.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(step);
    expect(step.getAttribute('aria-expanded')).toBe('true');
  });

  /** The intro carries the author's emphasis, but never as live markup. */
  it('renders the authored emphasis as text', async () => {
    render(<Workflow />);
    await waitFor(() => expect(screen.getByText(/QC is the contractor/)).toBeTruthy());
    expect(document.querySelector('.flowintro script')).toBeNull();
  });

  it('switches flows without carrying the last one\u2019s steps across', async () => {
    render(<Workflow />);
    await waitFor(() => expect(screen.getByText('Before delivery')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Geotechnical investigation' }));
    expect(screen.getByText('Desk study')).toBeTruthy();
    expect(screen.queryByText('Before delivery')).toBeNull();
  });
});

describe('the testing requirements', () => {
  /**
   * These tables are lecture material. The platform's own generator does not
   * read them, and the screen has to say so — a study aid that looks like an
   * authority is exactly how an unverified value reaches a signed document.
   */
  it('says what tier the figures are, and that the generator does not use them', async () => {
    render(<Workflow />);
    await open('Testing requirements');

    expect(screen.getByText(/Tier 0/)).toBeTruthy();
    expect(screen.getByText(/confirm a value against the DPWH Standard Specifications/i)).toBeTruthy();
    expect(screen.getByText(/The QCP generator does not read this table/)).toBeTruthy();
  });

  it('draws the rows it was given', async () => {
    render(<Workflow />);
    await open('Testing requirements');

    expect(screen.getByText('Field Density Test')).toBeTruthy();
    expect(screen.getByText('AASHTO T 191')).toBeTruthy();
    expect(screen.getByText('95% of MDD')).toBeTruthy();
    expect(screen.getByText(/Unsuitable material is named/)).toBeTruthy();
  });
});

describe('what this project has verified', () => {
  /**
   * The vendored table still records the Item 200 soaked CBR as unresolved
   * between editions. It was settled from the 2013 Standard Specifications, and
   * a study screen that contradicts the project's own verified record is worse
   * than one that says nothing — so the record is shown beside the table.
   */
  it('shows the verified limits beside the study tables, and says which to trust', async () => {
    render(<Workflow />);
    await open('Testing requirements');

    await waitFor(() => expect(screen.getByText('Verified by this project')).toBeTruthy());
    expect(screen.getByText(/Where one of these differs from a table above, this is the one to trust/)).toBeTruthy();
    expect(screen.getByText(/Countersigned by Jayz on 2026-09-15/)).toBeTruthy();
    expect(screen.getByText(/may be cited on an issued document/)).toBeTruthy();
  });

  it('counts only the rules that actually carry a limit read from a source', async () => {
    render(<Workflow />);
    await open('Testing requirements');

    // Two rules, one of which is a frequency with no acceptance limit.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the 1 limits' })).toBeTruthy());
  });

  /** A record that is not signed off must say so, not stay silent about it. */
  it('says plainly when the limits have not been countersigned', async () => {
    const unsigned = JSON.parse(JSON.stringify(RULES));
    delete unsigned.rules[0].acceptance.provenance.countersignedBy;
    delete unsigned.rules[0].acceptance.provenance.countersignedOn;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/generators/qcp/rules') return json(unsigned);
        if (url.startsWith('/quiz/workflow')) return json({ progress: null });
        throw new Error(`unstubbed ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    render(<Workflow />);
    await open('Testing requirements');

    await waitFor(() => expect(screen.getByText(/Not yet countersigned/)).toBeTruthy());
    expect(screen.queryByText(/may be cited on an issued document/)).toBeNull();
  });

  it('cites the section for each limit, not just the value', async () => {
    render(<Workflow />);
    await open('Testing requirements');

    await userEvent.click(await screen.findByRole('button', { name: /Show the 1 limits/ }));
    expect(screen.getByText(/Soaked CBR not less than 30%/)).toBeTruthy();
    expect(screen.getByText(/§200\.2/)).toBeTruthy();
    expect(screen.getByText(/DPWH Standard Specifications, Volume II \(2013\)/)).toBeTruthy();
  });

  /** An annotation is not worth failing the whole screen for. */
  it('still shows the study tables when the verified record cannot be fetched', async () => {
    stubApi({ progress: null }, false, true);
    render(<Workflow />);
    await open('Testing requirements');

    expect(screen.getByText('Field Density Test')).toBeTruthy();
    expect(screen.queryByText('Verified by this project')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the study path', () => {
  it('lists only days with files, and names the one the syllabus has but the index cannot fill', async () => {
    render(<Workflow />);
    await open('Study path');

    expect(screen.getByText(/Day 1 — Sampling/)).toBeTruthy();
    expect(screen.getByText(/Day 2 — Concrete/)).toBeTruthy();
    expect(screen.queryByText(/Day 5 — Acceptance/)).toBeNull();
    expect(screen.getByText(/Day 5 is in the syllabus but has no files in the index/)).toBeTruthy();
    expect(screen.getByText(/Nothing was invented to fill it/)).toBeTruthy();
  });

  /**
   * The vendored intro says "saved in this browser only". That was true of the
   * standalone file; here the ticks go to the server. The data file is not
   * edited, so the screen must not repeat the stale sentence.
   */
  it('states where progress is actually kept, not what the vendored copy said', async () => {
    render(<Workflow />);
    await open('Study path');

    expect(screen.getByText(/kept on the server/)).toBeTruthy();
    expect(screen.queryByText(/saved in this browser only/i)).toBeNull();
  });

  it('keeps a day\u2019s files closed until they are asked for', async () => {
    render(<Workflow />);
    await open('Study path');

    expect(screen.queryByText('sampling.pdf')).toBeNull();
    const day = screen.getByText(/Day 1 — Sampling/).closest('.card') as HTMLElement;
    await userEvent.click(within(day).getByRole('button', { name: 'Files' }));

    expect(screen.getByText('sampling.pdf')).toBeTruthy();
    expect(screen.getByText('1.0 MB')).toBeTruthy();
  });

  it('sends a tick to the server as it is made', async () => {
    render(<Workflow />);
    await open('Study path');

    await userEvent.click(screen.getAllByRole('checkbox')[0]);

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toBe('/quiz/workflow');
    expect(JSON.parse(puts()[0].body as string).state.days['MTT-1']).toBe(1);
  });

  /** A tick the server refused must not sit on screen looking saved. */
  it('takes the tick back off the screen if the server refused it', async () => {
    stubApi({ progress: null }, true);
    render(<Workflow />);
    await open('Study path');

    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    await userEvent.click(box);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/database is not reachable/)).toBeTruthy();
    expect(box.checked, 'the tick must not remain after a refused save').toBe(false);
  });

  it('shows the ticks the server already had', async () => {
    stubApi({ progress: { bank: 'workflow', state: { days: { 'MTT-1': 1 } }, updatedAt: '' } });
    render(<Workflow />);
    await open('Study path');

    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false);
  });

  it('keeps one track\u2019s ticks out of the other\u2019s', async () => {
    stubApi({ progress: { bank: 'workflow', state: { days: { 'MTT-1': 1 } }, updatedAt: '' } });
    render(<Workflow />);
    await open('Study path');
    await userEvent.click(screen.getByRole('button', { name: 'PE Field Engineer Compre' }));

    // The PE track has no dated files in this index, so there is nothing to tick.
    expect(screen.getByText(/No days in the index for this track/)).toBeTruthy();
    expect(screen.getByText(/Day 1 is in the syllabus/)).toBeTruthy();
  });
});

describe('the library', () => {
  it('says where the index came from and that nothing here writes to it', async () => {
    render(<Workflow />);
    await open('Library');

    expect(screen.getByText(/3 files, 3.3 GB/)).toBeTruthy();
    expect(screen.getByText(/scan\.ps1/)).toBeTruthy();
    expect(screen.getByText(/read-only by design/)).toBeTruthy();
  });

  it('filters on a facet and says how many are shown', async () => {
    render(<Workflow />);
    await open('Library');

    expect(screen.getByText('DO 075 s.2024.pdf')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Track'), 'MTT');

    expect(screen.queryByText('DO 075 s.2024.pdf')).toBeNull();
    expect(screen.getByText(/2 of 3 shown/)).toBeTruthy();
  });

  it('searches the folder as well as the file name', async () => {
    render(<Workflow />);
    await open('Library');

    await userEvent.type(screen.getByLabelText('Search'), 'Issuances');
    await waitFor(() => expect(screen.getByText(/1 of 3 shown/)).toBeTruthy());
    expect(screen.getByText('DO 075 s.2024.pdf')).toBeTruthy();
  });

  it('says so plainly when a filter matches nothing', async () => {
    render(<Workflow />);
    await open('Library');

    await userEvent.type(screen.getByLabelText('Search'), 'zzzz');
    await waitFor(() => expect(screen.getByText(/Nothing matches those filters/)).toBeTruthy());
  });

  it('offers each facet with its count, so an empty filter is visible before it is chosen', async () => {
    render(<Workflow />);
    await open('Library');

    expect(within(screen.getByLabelText('Domain')).getByText('Materials (2)')).toBeTruthy();
    expect(within(screen.getByLabelText('Kind')).getByText('issuance (1)')).toBeTruthy();
  });

  /**
   * Found in the browser against the real index: the domain names were applied
   * to every select, so the `other` *kind* rendered as "Other" among lowercase
   * neighbours. Each facet keeps its own vocabulary.
   */
  it('does not label one facet with another facet’s names', async () => {
    stubApi();
    vi.spyOn(load, 'loadWorkflow').mockResolvedValue({
      workflow: WORKFLOW,
      inventory: { ...INVENTORY, byDomain: { other: 1 }, byKind: { other: 2 } },
    });
    render(<Workflow />);
    await open('Library');

    expect(within(screen.getByLabelText('Domain')).getByText('Other (1)')).toBeTruthy();
    expect(within(screen.getByLabelText('Kind')).getByText('other (2)')).toBeTruthy();
  });
});
