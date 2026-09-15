/**
 * The reviewer's screen.
 *
 * The scoring rules are proven in `reviewer/engine.test.ts` without a DOM. What
 * is checked here is what only the screen can get wrong: that a bank nobody
 * asked for is never fetched, that questions dropped as malformed are reported
 * rather than silently vanishing, that a recall answer stays hidden until it is
 * asked for, that a reset is confirmed before it destroys anything, and that a
 * drill costs one save at the end rather than one per question.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Reviewer from './Reviewer';
import * as load from '../reviewer/load';
import type { BankSource } from '../reviewer/load';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A small stand-in bank.
 *
 * Deliberately not real spec questions: a fixture is not a source, and a number
 * invented for a test must never be mistaken for one that was verified.
 */
const QUESTIONS = [
  {
    id: 'q1',
    topic: 'soils',
    q: 'Which sample is described as disturbed?',
    choices: ['An auger sample', 'A Shelby tube sample', 'A block sample'],
    answer: 0,
    explain: 'Augering destroys the structure of the soil.',
    src: 'Fixture, not a specification',
  },
  {
    id: 'q2',
    topic: 'concrete',
    q: 'Which test measures the consistency of fresh concrete?',
    choices: ['Slump', 'Los Angeles abrasion', 'Sieve analysis'],
    answer: 0,
  },
  {
    id: 'q3',
    topic: 'asphalt',
    q: 'Which of these is a bituminous binder?',
    choices: ['Portland cement', 'Asphalt cement', 'Hydrated lime'],
    answer: 1,
  },
];

const RECALL = [{ id: 'r1', topic: 'qc', q: 'What does QCP stand for?', a: 'Quality Control Program.' }];

const source = (over: Partial<BankSource> = {}): BankSource => ({
  questions: QUESTIONS,
  recall: RECALL,
  ...over,
});

/** A sheet as the server hands it back, before `hydrate` fills in the rest. */
const stored = (state: Record<string, unknown>) => ({
  progress: { bank: 'me', state, updatedAt: '2026-09-15T02:00:00.000Z' },
});

/** Every call the screen makes, so a test can count them as well as answer them. */
let calls: { url: string; method: string }[] = [];

function stubApi(get: unknown = { progress: null }) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.startsWith('/quiz/')) {
        if (method === 'GET') return json(get);
        if (method === 'PUT') return json({ progress: { bank: 'me', state: {}, updatedAt: '' } });
        if (method === 'DELETE') return json({ cleared: true });
      }
      throw new Error(`unstubbed ${method} ${url}`);
    }),
  );
}

const put = () => calls.filter((c) => c.method === 'PUT');
const del = () => calls.filter((c) => c.method === 'DELETE');

beforeEach(() => stubApi());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loading', () => {
  it('says what it is fetching, rather than showing a blank tab', async () => {
    let resolve!: (s: BankSource) => void;
    vi.spyOn(load, 'loadBank').mockReturnValue(new Promise<BankSource>((r) => (resolve = r)));

    render(<Reviewer bank="me" />);
    expect(screen.getByText(/Fetching the question bank/)).toBeTruthy();

    resolve(source());
    await waitFor(() => expect(screen.getByText(/Choose a drill/)).toBeTruthy());
  });

  /** A missing vendored bank is a setup problem with a fix; say the fix. */
  it('explains a failure to load instead of showing an empty screen', async () => {
    vi.spyOn(load, 'loadBank').mockRejectedValue(
      new Error('Could not load /data/me-questions.js. Run npm run sync:vendored.'),
    );
    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/npm run sync:vendored/)).toBeTruthy();
  });

  it('fetches only the bank that was opened', async () => {
    const spy = vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="pe" />);
    await waitFor(() => expect(screen.getByText('PE Reviewer')).toBeTruthy());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('pe');
    expect(calls.every((c) => c.url.startsWith('/quiz/pe'))).toBe(true);
  });

  it('counts what it loaded', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText(/3 questions/)).toBeTruthy());
    expect(screen.getByText(/1 recall item/)).toBeTruthy();
  });

  /**
   * 83 questions once disappeared from a bank with no error at all. Dropping
   * them is right; dropping them quietly is the bug.
   */
  it('says so when questions were malformed, rather than quietly shrinking the bank', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(
      source({ questions: [...QUESTIONS, { id: 'bad', topic: 'soils', q: 'Two choices?', choices: ['a', 'b'], answer: 0 }] }),
    );
    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText(/1 question\(s\) in this bank are malformed/)).toBeTruthy());
  });
});

describe('the figures', () => {
  it('shows what the server has, not an empty sheet', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    stubApi(stored({ answered: 120, correct: 90, bestStreak: 11, runs: 4 }));

    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText('120')).toBeTruthy());
    expect(screen.getByText('75')).toBeTruthy(); // 90 of 120
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('shows a dash for accuracy rather than 0% before anything is answered', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText(/Choose a drill/)).toBeTruthy());
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('labels the topics of the reviewer that is open', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="pe" />);
    await waitFor(() => expect(screen.getByText('Contracts & Procurement')).toBeTruthy());
    expect(screen.queryByText('Soils & Aggregates')).toBeNull();
  });
});

describe('resetting', () => {
  it('is refused, with a reason, while there is nothing to reset', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset figures' })).toBeTruthy());
    const button = screen.getByRole('button', { name: 'Reset figures' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toBe('Nothing to reset yet');
  });

  /** It destroys a record that cannot be rebuilt, so backing out must be free. */
  it('destroys nothing when the confirmation is declined', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    stubApi(stored({ answered: 120, correct: 90 }));

    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText('120')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Reset figures' }));

    expect(del()).toHaveLength(0);
    expect(screen.getByText('120')).toBeTruthy();
  });

  it('says what will be lost before it is lost', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    stubApi(stored({ answered: 120, correct: 90 }));

    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText('120')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Reset figures' }));

    const asked = confirm.mock.calls[0][0] as string;
    expect(asked).toMatch(/ME Reviewer/);
    expect(asked).toMatch(/Cannot be undone/);
  });

  it('clears the row on the server and zeroes the screen', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    stubApi(stored({ answered: 120, correct: 90, bestStreak: 11 }));

    render(<Reviewer bank="me" />);
    await waitFor(() => expect(screen.getByText('120')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Reset figures' }));

    await waitFor(() => expect(del()).toHaveLength(1));
    expect(del()[0].url).toBe('/quiz/me');
    await waitFor(() => expect(screen.queryByText('120')).toBeNull());
    expect(screen.getByRole('button', { name: 'Reset figures' })).toHaveProperty('disabled', true);
  });
});

describe('a drill', () => {
  const answerCorrectly = async () => {
    const right = QUESTIONS.map((q) => q.choices[q.answer]);
    const button = screen
      .getAllByRole('button')
      .find((b) => right.some((text) => b.textContent?.includes(text)));
    await userEvent.click(button!);
  };

  it('asks one question at a time, and scores it', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick 20' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Quick 20' }));

    await waitFor(() => expect(screen.getByText('1 / 3')).toBeTruthy());
    await answerCorrectly();

    // 100 for the answer plus 25 for answering it inside eight seconds.
    await waitFor(() => expect(screen.getByText(/✓ Correct \+125/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  /**
   * A drill is saved once, when it ends. Saving per answer would be a request
   * per question — twenty of them for a quick drill.
   */
  it('costs one save at the end, not one per question', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick 20' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Quick 20' }));

    for (let i = 0; i < QUESTIONS.length; i++) {
      await waitFor(() => expect(screen.getByText(`${i + 1} / 3`)).toBeTruthy());
      await answerCorrectly();
      expect(put(), 'nothing should be saved mid-drill').toHaveLength(0);
      await userEvent.click(screen.getByRole('button', { name: i + 1 === QUESTIONS.length ? 'Finish' : 'Next' }));
    }

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(put()[0].url).toBe('/quiz/me');
    expect(screen.getByText(/3 \/ 3 \(100%\)/)).toBeTruthy();
  });

  it('refuses a drill it has nothing to fill, and says why', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry missed' })).toBeTruthy());
    const retry = screen.getByRole('button', { name: 'Retry missed' });
    expect(retry).toHaveProperty('disabled', true);
    expect(retry.getAttribute('title')).toBe('You have not missed anything yet');
  });
});

describe('the recall drill', () => {
  it('does not show the answer until it is asked for', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Recall drill' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Recall drill' }));

    await waitFor(() => expect(screen.getByText('What does QCP stand for?')).toBeTruthy());
    expect(screen.queryByText('Quality Control Program.'), 'the answer must not be on screen yet').toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.getByText('Quality Control Program.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I knew it' })).toBeTruthy();
  });

  it('saves the sheet once the last item is graded', async () => {
    vi.spyOn(load, 'loadBank').mockResolvedValue(source());
    render(<Reviewer bank="me" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Recall drill' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Recall drill' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show the answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'I knew it' }));

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(screen.getByText(/1 \/ 1 known/)).toBeTruthy();
  });
});
