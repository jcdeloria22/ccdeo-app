/**
 * The reviewer's rules.
 *
 * These are ported unchanged from the reviewer in use, and that is the point of
 * testing them: an XP total earned under the old rules has to keep meaning what
 * it meant. A change here is a change to somebody's record.
 */
import { describe, it, expect } from 'vitest';
import {
  accuracy,
  blankProgress,
  buildBank,
  buildRecall,
  fmtTime,
  hydrate,
  poolFor,
  recordAnswer,
  recordSession,
  score,
  shuffle,
  SET_SIZE,
  type Progress,
  type Question,
} from './engine';

const q = (over: Partial<Question> = {}): Question => ({
  id: 'q1',
  topic: 'soils',
  q: 'What is the maximum liquid limit for Item 200?',
  choices: ['35', '25', '12'],
  answer: 0,
  ...over,
});

describe('building a bank', () => {
  it('keeps questions with three or four choices', () => {
    const { bank, dropped } = buildBank([q({ choices: ['a', 'b', 'c'] }), q({ id: 'q2', q: 'Second?', choices: ['a', 'b', 'c', 'd'] })]);
    expect(bank).toHaveLength(2);
    expect(dropped).toBe(0);
  });

  /**
   * Two-choice questions once slipped through and rendered a blank option that
   * could never be right. They are dropped, and the count is reported rather than
   * swallowed — 83 questions once vanished from a bank with no error at all.
   */
  it('drops a question with too few or too many choices, and counts it', () => {
    const { bank, dropped } = buildBank([
      q({ choices: ['yes', 'no'] }),
      q({ id: 'q2', q: 'Five?', choices: ['a', 'b', 'c', 'd', 'e'] }),
      q({ id: 'q3', q: 'Fine?' }),
    ]);
    expect(bank).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it('drops a question whose answer points outside its choices', () => {
    const { bank, dropped } = buildBank([q({ answer: 7 }), q({ id: 'q2', q: 'Negative?', answer: -1 })]);
    expect(bank).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  /** "ASTM C150" and "ASTM C 150" are the same question. */
  it('merges duplicates that differ only in punctuation and spacing', () => {
    const { bank, duplicates } = buildBank([
      q({ id: 'a', q: 'What does ASTM C150 cover?' }),
      q({ id: 'b', q: 'What does ASTM C 150 cover?' }),
      q({ id: 'c', q: 'what   does astm-c150 cover???' }),
    ]);
    expect(bank).toHaveLength(1);
    expect(duplicates).toBe(2);
  });

  it('survives a bank that is not an array', () => {
    expect(buildBank(undefined).bank).toEqual([]);
    expect(buildBank({ nope: true }).bank).toEqual([]);
  });

  it('keeps only recall items that have both a question and an answer', () => {
    expect(
      buildRecall([
        { id: 'r1', topic: 'qc', q: 'What is a QCP?', a: 'A Quality Control Program.' },
        { id: 'r2', topic: 'qc', q: 'No answer', a: '' },
      ]),
    ).toHaveLength(1);
  });
});

describe('scoring', () => {
  it('gives nothing for a wrong answer, however fast', () => {
    expect(score(false, 0, 0.5)).toEqual({ right: false, points: 0, multiplier: 1, speedBonus: false });
  });

  it('gives 100 for a correct answer with no streak and no hurry', () => {
    const s = score(true, 1, 30);
    expect(s.points).toBe(100);
    expect(s.multiplier).toBe(1);
    expect(s.speedBonus).toBe(false);
  });

  it('adds 25 for answering within eight seconds', () => {
    expect(score(true, 1, 8).points).toBe(125);
    expect(score(true, 1, 8.01).points).toBe(100);
  });

  it('raises the multiplier every fifth in a row', () => {
    expect(score(true, 4, 30).multiplier).toBe(1);
    expect(score(true, 5, 30).multiplier).toBe(1.25);
    expect(score(true, 10, 30).multiplier).toBe(1.5);
    expect(score(true, 20, 30).multiplier).toBe(2);
  });

  it('stops the multiplier at three times, however long the streak', () => {
    expect(score(true, 40, 30).multiplier).toBe(3);
    expect(score(true, 400, 30).multiplier).toBe(3);
    expect(score(true, 400, 1).points).toBe(325);
  });
});

describe('recording an answer', () => {
  it('counts it, and counts the topic', () => {
    const next = recordAnswer(blankProgress(), q(), true, 125, true, 1);
    expect(next.answered).toBe(1);
    expect(next.correct).toBe(1);
    expect(next.xp).toBe(125);
    expect(next.fast).toBe(1);
    expect(next.topics.soils).toEqual({ n: 1, c: 1 });
  });

  it('remembers a question that was missed', () => {
    const next = recordAnswer(blankProgress(), q(), false, 0, false, 0);
    expect(next.missed).toEqual(['q1']);
    expect(next.correct).toBe(0);
    expect(next.topics.soils).toEqual({ n: 1, c: 0 });
  });

  it('forgets it once it is answered correctly', () => {
    const missed = recordAnswer(blankProgress(), q(), false, 0, false, 0);
    const fixed = recordAnswer(missed, q(), true, 100, false, 1);
    expect(fixed.missed).toEqual([]);
  });

  it('does not list the same missed question twice', () => {
    let p = recordAnswer(blankProgress(), q(), false, 0, false, 0);
    p = recordAnswer(p, q(), false, 0, false, 0);
    expect(p.missed).toEqual(['q1']);
  });

  it('keeps the best streak ever, not the current one', () => {
    let p = recordAnswer(blankProgress(), q(), true, 100, false, 7);
    p = recordAnswer(p, q({ id: 'q2' }), false, 0, false, 0);
    expect(p.bestStreak).toBe(7);
  });

  it('leaves the sheet it was given untouched', () => {
    const before = blankProgress();
    recordAnswer(before, q(), true, 100, false, 1);
    expect(before.answered).toBe(0);
    expect(before.topics).toEqual({});
  });
});

describe('recording a session', () => {
  const run = { mode: 'quick' as const, correct: 8, total: 20, score: 1025, seconds: 6, best: 5 };

  it('counts the run and files it in the history', () => {
    const p = recordSession(blankProgress(), run);
    expect(p.runs).toBe(1);
    expect(p.hist).toHaveLength(1);
    expect(p.hist[0]).toMatchObject({ correct: 8, total: 20, pct: 40, score: 1025, secs: 6, streak: 5 });
  });

  it('counts an exam set separately', () => {
    expect(recordSession(blankProgress(), { ...run, mode: 'exam' }).exams).toBe(1);
    expect(recordSession(blankProgress(), run).exams).toBe(0);
  });

  it('counts a perfect run only when everything was right', () => {
    expect(recordSession(blankProgress(), { ...run, correct: 20 }).perfect).toBe(1);
    expect(recordSession(blankProgress(), run).perfect).toBe(0);
  });

  it('keeps the best score on a numbered set, never a worse later one', () => {
    let p = recordSession(blankProgress(), { ...run, mode: 'set', setIdx: 2, correct: 18, total: 20 });
    expect(p.setsDone[2]).toEqual({ best: 18, total: 20 });

    p = recordSession(p, { ...run, mode: 'set', setIdx: 2, correct: 11, total: 20 });
    expect(p.setsDone[2].best, 'a worse attempt must not overwrite a better one').toBe(18);

    p = recordSession(p, { ...run, mode: 'set', setIdx: 2, correct: 20, total: 20 });
    expect(p.setsDone[2].best).toBe(20);
  });

  it('newest first, and never more than fifty', () => {
    let p = blankProgress();
    for (let i = 0; i < 60; i++) p = recordSession(p, { ...run, correct: i });
    expect(p.hist).toHaveLength(50);
    expect(p.hist[0].correct).toBe(59);
  });
});

describe('choosing what to ask', () => {
  const bank = Array.from({ length: 250 }, (_, i) =>
    q({ id: `q${i}`, q: `Question ${i}?`, topic: i % 2 ? 'soils' : 'concrete' }),
  );
  const topics = ['soils', 'concrete'];

  it('asks twenty for a quick drill', () => {
    expect(poolFor('quick', bank, blankProgress(), topics)).toHaveLength(20);
  });

  it('asks a full set for an exam', () => {
    expect(poolFor('exam', bank, blankProgress(), topics)).toHaveLength(SET_SIZE);
  });

  it('asks only the questions in a numbered set', () => {
    const pool = poolFor('set', bank, blankProgress(), topics, 2);
    expect(pool).toHaveLength(50); // 250 questions, set 3 is the remainder
    for (const item of pool) expect(bank.slice(200, 300)).toContain(item);
  });

  it('asks only what was missed, when retrying', () => {
    const p: Progress = { ...blankProgress(), missed: ['q3', 'q7'] };
    const pool = poolFor('missed', bank, p, topics);
    expect(pool.map((x) => x.id).sort()).toEqual(['q3', 'q7']);
  });

  /**
   * The THREE weakest topics by accuracy, not the single worst — with only two
   * topics on record both qualify, which is why this uses five.
   */
  it('drills the three weakest topics, and leaves the strong ones alone', () => {
    const five = ['soils', 'concrete', 'asphalt', 'qc', 'steel'];
    const wide = five.flatMap((topic) =>
      Array.from({ length: 20 }, (_, i) => q({ id: `${topic}${i}`, q: `${topic} ${i}?`, topic })),
    );
    const p: Progress = {
      ...blankProgress(),
      topics: {
        soils: { n: 10, c: 1 },     // 10% — weakest
        concrete: { n: 10, c: 3 },  // 30%
        asphalt: { n: 10, c: 5 },   // 50%
        qc: { n: 10, c: 9 },        // 90% — strong
        steel: { n: 10, c: 10 },    // 100% — strong
      },
    };

    const asked = new Set(poolFor('weak', wide, p, five).map((x) => x.topic));
    expect([...asked].sort()).toEqual(['asphalt', 'concrete', 'soils']);
    expect(asked.has('qc')).toBe(false);
    expect(asked.has('steel')).toBe(false);
  });

  it('ignores a topic with too little on record to judge', () => {
    const p: Progress = {
      ...blankProgress(),
      // Two answers is not a verdict, so this falls back to everything.
      topics: { soils: { n: 2, c: 0 } },
    };
    const pool = poolFor('weak', bank, p, topics);
    expect(new Set(pool.map((x) => x.topic)).size).toBeGreaterThan(1);
  });

  it('falls back to everything when no topic has been tried enough', () => {
    const p: Progress = { ...blankProgress(), topics: { soils: { n: 1, c: 0 } } };
    const pool = poolFor('weak', bank, p, topics);
    expect(new Set(pool.map((x) => x.topic)).size).toBeGreaterThan(1);
  });

  it('returns nothing to retry when nothing was missed', () => {
    expect(poolFor('missed', bank, blankProgress(), topics)).toEqual([]);
  });
});

describe('the score sheet', () => {
  it('reads an older sheet without losing what it did not have', () => {
    const p = hydrate({ answered: 12, correct: 6, xp: 500 });
    expect(p.answered).toBe(12);
    expect(p.topics).toEqual({});
    expect(p.missed).toEqual([]);
    expect(p.recall).toEqual({ seen: 0, known: 0, topics: {} });
  });

  it('treats nothing stored as a blank sheet', () => {
    expect(hydrate(null)).toEqual(blankProgress());
    expect(hydrate(undefined)).toEqual(blankProgress());
    expect(hydrate('nonsense')).toEqual(blankProgress());
  });

  it('reports no accuracy before anything is answered, rather than zero', () => {
    expect(accuracy(blankProgress())).toBeNull();
    expect(accuracy({ ...blankProgress(), answered: 4, correct: 3 })).toBe(75);
  });
});

describe('helpers', () => {
  it('keeps every item when shuffling, and leaves the original alone', () => {
    const xs = [1, 2, 3, 4, 5];
    const out = shuffle(xs);
    expect(out.sort()).toEqual(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5]);
  });

  it('formats a time somebody can read', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(6)).toBe('0:06');
    expect(fmtTime(75)).toBe('1:15');
    expect(fmtTime(-5)).toBe('0:00');
  });
});
