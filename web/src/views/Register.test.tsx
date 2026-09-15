/**
 * The register — reading it, and doing work in it.
 *
 * This screen is where someone actually operates the system, so most of what is
 * checked here is whether it explains itself: an empty state that says what to do
 * next, a control that is disabled with a reason, a refusal shown in the words
 * the server used rather than swallowed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Register from './Register';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const readiness = (over = {}) => ({
  requiredTotal: 3,
  signed: 1,
  waived: 0,
  closedOut: 1,
  awaitingApproval: 2,
  inProgress: 0,
  empty: 0,
  optionalTotal: 0,
  optionalSigned: 0,
  ratio: 1 / 3,
  percent: 33,
  complete: false,
  ...over,
});

const LIFECYCLE = {
  states: ['Draft', 'In Review', 'Final', 'Signed', 'Archived', 'Superseded', 'Void'],
  terminal: ['Archived', 'Superseded', 'Void'],
  mainLine: ['Draft', 'In Review', 'Final', 'Signed', 'Archived'],
  transitions: [
    { from: 'Draft', to: 'In Review', capability: 'document.edit', requiresReason: false, note: 'submitted' },
    {
      from: 'Draft',
      to: 'Final',
      capability: 'document.finalize',
      requiresReason: false,
      freezesContent: true,
      rolesAllowed: ['materials_engineer', 'admin'],
      note: 'freezes content',
    },
    {
      from: 'Final',
      to: 'Signed',
      capability: 'document.approve',
      requiresReason: false,
      isApproval: true,
      rolesAllowed: ['approver', 'admin'],
      note: 'the signature event',
    },
    { from: 'Final', to: 'Draft', capability: 'document.reject', requiresReason: true, note: 'rejected' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ list --- */

describe('the list', () => {
  const stubList = (rows: unknown[], extra?: (url: string, init?: RequestInit) => Response | undefined) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (url.startsWith('/projects')) return json({ rows, total: rows.length });
        if (url.startsWith('/lifecycle')) return json(LIFECYCLE);
        throw new Error(`unstubbed ${url}`);
      }),
    );

  it('shows each contract with what it still owes', async () => {
    stubList([
      { project: { id: 'p1', contractId: '26HH0041', name: 'Barangay Road' }, readiness: readiness() },
    ]);
    render(<Register projectId={null} />);

    await waitFor(() => expect(screen.getByText('Barangay Road')).toBeTruthy());
    expect(screen.getByText(/1 of 3 closed out/)).toBeTruthy();
    expect(screen.getByText(/2 awaiting signature/)).toBeTruthy();
  });

  /** A contract with no set is not 0% — it is unmeasured, and the row says what to do. */
  it('tells you a contract has no document set yet', async () => {
    stubList([
      {
        project: { id: 'p1', contractId: '26HH0041', name: 'Barangay Road' },
        readiness: readiness({ requiredTotal: 0, percent: null, ratio: null, closedOut: 0, signed: 0, awaitingApproval: 0 }),
      },
    ]);
    render(<Register projectId={null} />);
    await waitFor(() => expect(screen.getByText(/No document set chosen yet/)).toBeTruthy());
    expect(screen.getByText('no set')).toBeTruthy();
  });

  it('says what to do when the register is empty', async () => {
    stubList([]);
    render(<Register projectId={null} />);
    await waitFor(() => expect(screen.getByText(/No contracts yet/)).toBeTruthy());
    expect(screen.getByText(/Add the first one above/)).toBeTruthy();
  });

  it('will not submit a half-filled contract form, and says why', async () => {
    stubList([]);
    const user = userEvent.setup();
    render(<Register projectId={null} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'New contract' }));
    const create = screen.getByRole('button', { name: 'Create contract' });
    expect(create).toHaveProperty('disabled', true);
    expect(create.getAttribute('title')).toBe('Fill in both fields first');

    await user.type(screen.getByLabelText('Contract number'), '26HH0041');
    expect(screen.getByRole('button', { name: 'Create contract' })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Project name'), 'Barangay Road');
    expect(screen.getByRole('button', { name: 'Create contract' })).toHaveProperty('disabled', false);
  });

  /** The duplicate guard is a real rule; the screen has to pass its words through. */
  it('shows the server refusal when a contract number is already taken', async () => {
    stubList([], (_url, init) =>
      init?.method === 'POST'
        ? json({ statusCode: 409, error: 'DuplicateProjectError', message: 'Contract 26HH0041 already exists' }, 409)
        : undefined,
    );
    const user = userEvent.setup();
    render(<Register projectId={null} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'New contract' }));
    await user.type(screen.getByLabelText('Contract number'), '26HH0041');
    await user.type(screen.getByLabelText('Project name'), 'Barangay Road');
    await user.click(screen.getByRole('button', { name: 'Create contract' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/already exists/)).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- detail --- */

describe('a contract', () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    project: { id: 'p1', contractId: '26HH0041', name: 'Barangay Road' },
    readiness: {
      projectId: 'p1',
      contractId: '26HH0041',
      name: 'Barangay Road',
      readiness: readiness(),
      slots: [
        { slotCode: 'qcp', required: true, outcome: 'awaiting-approval' },
        { slotCode: 'mix-design', required: true, outcome: 'waived' },
      ],
    },
    slots: [
      { slotCode: 'qcp', name: 'Quality Control Program', required: true, state: 'Filled', waivedReason: null },
      { slotCode: 'mix-design', name: 'Mix design', required: true, state: 'Waived', waivedReason: 'No concrete works' },
    ],
    documents: [
      {
        id: 'd1',
        slotCode: 'qcp',
        title: 'QCP rev 1',
        state: 'Final',
        stateSince: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        contentHash: 'abcdef0123456789',
        supersededBy: null,
      },
    ],
    ...over,
  });

  const stubDetail = (data: unknown, extra?: (url: string, init?: RequestInit) => Response | undefined) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (url.startsWith('/lifecycle')) return json(LIFECYCLE);
        if (url.startsWith('/projects/')) return json(data);
        throw new Error(`unstubbed ${url}`);
      }),
    );

  it('offers to choose a set when the contract has none', async () => {
    stubDetail(detail({ slots: [], documents: [], readiness: null }));
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByText(/No document set chosen yet/)).toBeTruthy());
    expect(screen.getByText(/nothing is required of it/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a document set' })).toBeTruthy();
  });

  it('shows each slot with what readiness makes of it, not the raw slot state', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('26HH0041'));
    const chips = [...document.querySelectorAll('.slot .level')].map((e) => e.textContent);
    // qcp is "Filled" in the database, but a clean upload is not an approval.
    expect(chips).toContain('Awaiting signature');
    expect(chips).toContain('Waived');
  });

  it('gives the reason a slot was waived', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/Waived — No concrete works/)).toBeTruthy());
  });

  it('offers to upload into every slot', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);
    await waitFor(() => expect(document.querySelectorAll('.filebtn').length).toBe(2));
  });

  /**
   * The lifecycle is taught on the screen: where the document is, what can happen
   * next, and in words rather than state names.
   */
  it('shows where the document has got to', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByText('QCP rev 1')).toBeTruthy());
    const track = document.querySelector('.track') as HTMLElement;
    expect([...track.querySelectorAll('.track-step')].map((e) => e.textContent)).toEqual([
      'Draft',
      'In Review',
      'Final',
      'Signed',
      'Archived',
    ]);
    expect(track.querySelector('.track-now')?.textContent).toBe('Final');
  });

  it('names the next steps in plain words, and says who may take them', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign it off' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Send back' })).toBeTruthy();
    // The role is spelled the way a person says it, not as the database stores it.
    expect(screen.getByText(/Only the approver or an administrator may do this/)).toBeTruthy();
    expect(screen.queryByText(/materials_engineer/)).toBeNull();
  });

  it('asks for a reason before a move that needs one', async () => {
    stubDetail(detail());
    const user = userEvent.setup();
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send back' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Send back' }));

    const reason = await screen.findByLabelText('Reason');
    expect(reason).toBeTruthy();
    expect(screen.getByText(/kept on the record permanently/)).toBeTruthy();

    const panel = reason.closest('.panel') as HTMLElement;
    const confirm = within(panel).getByRole('button', { name: 'Send back' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(confirm.getAttribute('title')).toBe('Type a reason first');
  });

  it('sends the move, with the reason, when one is given', async () => {
    const calls: { url: string; body: unknown }[] = [];
    stubDetail(detail(), (url, init) => {
      if (init?.method === 'POST' && url.includes('/transition')) {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return json({ document: { id: 'd1', state: 'Draft' } });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send back' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    await user.type(await screen.findByLabelText('Reason'), 'Sieve analysis missing');

    const panel = (await screen.findByLabelText('Reason')).closest('.panel') as HTMLElement;
    await user.click(within(panel).getByRole('button', { name: 'Send back' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('/documents/d1/transition');
    expect(calls[0].body).toEqual({ to: 'Draft', reason: 'Sieve analysis missing' });
  });

  it('shows the rule when the server refuses a move', async () => {
    stubDetail(detail(), (url, init) =>
      init?.method === 'POST' && url.includes('/transition')
        ? json(
            {
              statusCode: 403,
              error: 'RoleNotPermittedError',
              message: 'Role viewer may not perform Final → Signed: restricted to approver, admin',
            },
            403,
          )
        : undefined,
    );
    const user = userEvent.setup();
    render(<Register projectId="p1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign it off' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Sign it off' }));

    await waitFor(() => expect(screen.getByText(/restricted to approver, admin/)).toBeTruthy());
  });

  it('says plainly when a document can go no further', async () => {
    stubDetail(
      detail({
        documents: [
          {
            id: 'd1',
            slotCode: 'qcp',
            title: 'QCP rev 1',
            state: 'Archived',
            stateSince: new Date().toISOString(),
            contentHash: 'abc',
            supersededBy: null,
          },
        ],
      }),
    );
    render(<Register projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/Nothing more can happen to this document/)).toBeTruthy());
  });

  it('keeps superseded versions visible, and explains why', async () => {
    stubDetail(
      detail({
        documents: [
          {
            id: 'd0',
            slotCode: 'qcp',
            title: 'QCP rev 0',
            state: 'Superseded',
            stateSince: new Date().toISOString(),
            contentHash: 'old',
            supersededBy: 'd1',
          },
        ],
      }),
    );
    render(<Register projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Older versions')).toBeTruthy());
    expect(screen.getByText(/must not disappear when it is replaced/)).toBeTruthy();
  });

  it('offers a way back to the list', async () => {
    stubDetail(detail());
    render(<Register projectId="p1" />);
    await waitFor(() => expect(screen.getByRole('link', { name: /All contracts/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /All contracts/ }).getAttribute('href')).toBe('#/register');
  });

  it('reports a contract that does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/lifecycle')) return json(LIFECYCLE);
        return json({ message: 'No project p9' }, 404);
      }),
    );
    render(<Register projectId="p9" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/No project p9/)).toBeTruthy();
  });
});
