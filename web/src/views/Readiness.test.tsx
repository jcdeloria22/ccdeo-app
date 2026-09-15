/**
 * Readiness, and the rule the whole product turns on.
 *
 *   > Readiness counts Signed only, never Final. Approval debt is displayed
 *   > separately and never folded into a completion percentage.
 *
 * The backend enforces that arithmetically. What these tests add is that the
 * screen does not undo it — a bar that visually includes what is awaiting a
 * signature would tell the same lie the arithmetic was written to avoid.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Readiness from './Readiness';
import type { ApprovalDebtItem, ProjectReadiness } from '../api';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const project = (over: Partial<ProjectReadiness> = {}): ProjectReadiness => ({
  projectId: 'p1',
  contractId: '26HH0041',
  name: 'Barangay Road',
  readiness: {
    requiredTotal: 4,
    signed: 0,
    waived: 0,
    closedOut: 0,
    awaitingApproval: 3,
    inProgress: 0,
    empty: 1,
    optionalTotal: 0,
    optionalSigned: 0,
    ratio: 0,
    percent: 0,
    complete: false,
    ...(over.readiness ?? {}),
  },
  slots: [],
  ...over,
});

const debtItem = (over: Partial<ApprovalDebtItem> = {}): ApprovalDebtItem => ({
  documentId: 'd1',
  projectId: 'p1',
  contractId: '26HH0041',
  slotCode: 'qcp',
  title: 'QCP',
  since: new Date(Date.now() - 22 * 86_400_000).toISOString(),
  ...over,
});

const stub = (projects: ProjectReadiness[], items: ApprovalDebtItem[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.startsWith('/readiness/debt') ? json({ items }) : json({ projects }))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the readiness figure', () => {
  /** Three documents at Final, nothing signed: the figure is zero. */
  it('stays at zero while everything is only Final', async () => {
    stub([project()], [debtItem(), debtItem({ documentId: 'd2' }), debtItem({ documentId: 'd3' })]);
    render(<Readiness />);

    await waitFor(() => expect(screen.getByText('Barangay Road')).toBeTruthy());
    const row = screen.getByText('Barangay Road').closest('.prow') as HTMLElement;
    expect(row.querySelector('.prow-pct')?.textContent).toBe('0%');
    expect(row.querySelector('.meter i')?.getAttribute('style')).toContain('width: 0%');
  });

  it('never draws the bar past what is closed out', async () => {
    stub(
      [project({ readiness: { ...project().readiness, signed: 2, closedOut: 2, awaitingApproval: 2, percent: 50, ratio: 0.5 } })],
      [],
    );
    render(<Readiness />);

    await waitFor(() => expect(screen.getByText('Barangay Road')).toBeTruthy());
    const row = screen.getByText('Barangay Road').closest('.prow') as HTMLElement;
    // 2 of 4 closed out, 2 more awaiting signature — the bar shows 50, not 100.
    expect(row.querySelector('.meter i')?.getAttribute('style')).toContain('width: 50%');
  });

  it('calls a contract with no slot set "no set", not complete', async () => {
    stub([project({ readiness: { ...project().readiness, requiredTotal: 0, awaitingApproval: 0, empty: 0, ratio: null, percent: null } })], []);
    render(<Readiness />);
    await waitFor(() => expect(screen.getByText('no set')).toBeTruthy());
  });

  it('marks awaiting-signature in its own right, not as progress', async () => {
    stub([project()], []);
    render(<Readiness />);
    await waitFor(() => expect(screen.getByText(/3 awaiting signature/)).toBeTruthy());
    expect(screen.getByText(/3 awaiting signature/).className).toContain('debt');
  });
});

describe('approval debt', () => {
  it('is listed in full, with how long each has waited', async () => {
    stub(
      [project()],
      [
        debtItem(),
        debtItem({
          documentId: 'd2',
          slotCode: 'mix-design',
          title: 'Mix design',
          since: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        }),
      ],
    );
    render(<Readiness />);

    await waitFor(() => expect(screen.getByText(/Mix design/)).toBeTruthy());
    // Scoped to the debt list: the contract rows above are list items too.
    expect(document.querySelectorAll('.remlist li')).toHaveLength(2);
    expect(screen.getByText(/waiting 22 days/)).toBeTruthy();
    expect(screen.getByText(/waiting 4 days/)).toBeTruthy();
  });

  it('says plainly when nothing is waiting', async () => {
    stub([project({ readiness: { ...project().readiness, awaitingApproval: 0 } })], []);
    render(<Readiness />);
    await waitFor(() => expect(screen.getByText(/Nothing waiting/)).toBeTruthy());
  });

  it('spells out that it is counted nowhere above', async () => {
    stub([project()], [debtItem()]);
    render(<Readiness />);
    await waitFor(() => expect(screen.getByText(/Counted nowhere above/)).toBeTruthy());
  });
});

describe('failure', () => {
  it('reports it rather than showing an empty portfolio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503, statusText: 'Unavailable' })));
    render(<Readiness />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/No contracts yet/)).toBeNull();
  });
});
