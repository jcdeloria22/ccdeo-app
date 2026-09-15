/**
 * Study progress.
 *
 * This is the one store in the platform that is deliberately not audited and
 * deliberately opaque, so what is worth proving is narrow: that a score sheet
 * belongs to one person and one reviewer and cannot leak into another, that
 * saving replaces rather than accumulates, and that a reset actually removes the
 * row instead of leaving one behind claiming somebody studied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { QuizProgressRepository, BANKS, UnknownBankError } from '../src/reviewer/quiz-progress.repository';
import type { Role } from '../src/policy/roles';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const as = (id: string, role: Role = 'materials_engineer') => ({
  id,
  name: 'Jayz',
  email: 'jayz@example.com',
  role,
  authMode: 'password' as const,
});

describe('the known study records', () => {
  it('are the three that exist, and nothing else', () => {
    expect([...BANKS]).toEqual(['me', 'pe', 'workflow']);
  });

  /**
   * The bank arrives from the URL, so this is the check that keeps a typo from
   * quietly becoming a third reviewer nobody can find again.
   */
  it('refuse a record that does not exist rather than storing it where nothing looks', () => {
    expect(() => QuizProgressRepository.assertBank('ce')).toThrow(UnknownBankError);
    expect(() => QuizProgressRepository.assertBank('')).toThrow(UnknownBankError);
    expect(() => QuizProgressRepository.assertBank('ME')).toThrow(UnknownBankError);
  });

  it('name the alternatives when they refuse', () => {
    try {
      QuizProgressRepository.assertBank('typo');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/me, pe, workflow/);
    }
  });
});

run('quiz progress', () => {
  let pool: Pool;
  let progress: QuizProgressRepository;

  /*
   * Synthetic actor ids, and only these rows are removed.
   *
   * Not `operator:single`: that is the real actor in single-operator mode, so a
   * suite that truncated this table — or wrote as that actor — would delete the
   * owner's actual revision history every time it ran. The whole point of moving
   * progress off localStorage was that it stops being disposable.
   */
  const jayz = as('test:quiz-a');
  const other = as('test:quiz-b');
  const mine = [jayz.id, other.id];

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('delete from quiz_progress where actor_id = any($1)', [mine]);
    progress = new QuizProgressRepository(pool);
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from quiz_progress where actor_id = any($1)', [mine]);
    await pool.end();
  });

  it('returns nothing for a reviewer never opened', async () => {
    expect(await progress.get('me', jayz)).toBeNull();
  });

  it('stores a score sheet and reads it back unchanged', async () => {
    const sheet = {
      xp: 1025,
      answered: 20,
      correct: 8,
      bestStreak: 5,
      topics: { soils: { n: 12, c: 5 }, concrete: { n: 8, c: 3 } },
      missed: ['q17', 'q92'],
      hist: [{ d: 1_757_900_000_000, mode: 'quick', correct: 8, total: 20, pct: 40 }],
    };

    const saved = await progress.put('me', sheet, jayz);
    expect(saved.bank).toBe('me');
    expect(saved.updatedAt).toBeInstanceOf(Date);

    const got = await progress.get('me', jayz);
    expect(got?.state).toEqual(sheet);
  });

  /**
   * The reviewer saves the whole sheet at the end of a session. If that inserted
   * instead of replacing, a second session would leave two rows and the older
   * one could win — so the row count is asserted, not just the value.
   */
  it('replaces the sheet rather than accumulating rows', async () => {
    await progress.put('me', { xp: 2050, answered: 40 }, jayz);

    const got = await progress.get('me', jayz);
    expect(got?.state).toEqual({ xp: 2050, answered: 40 });

    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from quiz_progress where actor_id = $1 and bank = 'me'",
      [jayz.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('moves updated_at forward on a later save', async () => {
    const first = await progress.put('pe', { xp: 100 }, jayz);
    const second = await progress.put('pe', { xp: 200 }, jayz);
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
  });

  it('keeps the two reviewers apart', async () => {
    expect((await progress.get('me', jayz))?.state).toEqual({ xp: 2050, answered: 40 });
    expect((await progress.get('pe', jayz))?.state).toEqual({ xp: 200 });
  });

  it('keeps one person out of another person’s figures', async () => {
    await progress.put('me', { xp: 7 }, other);
    expect((await progress.get('me', other))?.state).toEqual({ xp: 7 });
    expect((await progress.get('me', jayz))?.state).toEqual({ xp: 2050, answered: 40 });
  });

  it('refuses to read or write an unknown reviewer', async () => {
    await expect(progress.get('ce', jayz)).rejects.toThrow(UnknownBankError);
    await expect(progress.put('ce', { xp: 1 }, jayz)).rejects.toThrow(UnknownBankError);
    await expect(progress.clear('ce', jayz)).rejects.toThrow(UnknownBankError);
  });

  /**
   * Reset. The row is removed, not zeroed — and only the one row: the reset
   * button on the ME screen says it clears that reviewer only, and that promise
   * is what this asserts.
   */
  it('clears one reviewer for one person, and leaves the rest alone', async () => {
    expect(await progress.clear('me', jayz)).toBe(true);

    expect(await progress.get('me', jayz)).toBeNull();
    expect((await progress.get('pe', jayz))?.state).toEqual({ xp: 200 });
    expect((await progress.get('me', other))?.state).toEqual({ xp: 7 });
  });

  it('says so plainly when there was nothing to clear', async () => {
    expect(await progress.clear('me', jayz)).toBe(false);
  });

  it('starts clean after a reset rather than restoring the old sheet', async () => {
    const after = await progress.put('me', { xp: 0, answered: 0 }, jayz);
    expect(after.state).toEqual({ xp: 0, answered: 0 });
  });
});
