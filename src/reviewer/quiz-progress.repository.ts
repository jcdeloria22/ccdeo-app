/**
 * Study progress, per person and per surface.
 *
 * The state is opaque here on purpose: this stores and returns what the reviewer
 * gives it. The scoring rules — what a streak multiplier is worth, when a badge
 * is earned — belong to the reviewer, and splitting them across a repository and
 * a screen is how the two end up disagreeing.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';

/**
 * The study surfaces, not only the question banks.
 *
 * 'workflow' is the ME Workflow's study path — the ticks against each training
 * day. It is the same kind of record as a reviewer's score sheet: personal, not
 * audited, and wrong to lose to a cleared cache. See migration 0010.
 */
export const BANKS = ['me', 'pe', 'workflow'] as const;
export type Bank = (typeof BANKS)[number];

export class UnknownBankError extends Error {
  constructor(bank: string) {
    super(`No study record called "${bank}". Known records: ${BANKS.join(', ')}.`);
    this.name = 'UnknownBankError';
  }
}

export interface Progress {
  readonly bank: Bank;
  readonly state: Record<string, unknown>;
  readonly updatedAt: Date;
}

interface Row {
  bank: Bank;
  state: Record<string, unknown>;
  updated_at: Date;
}

const toProgress = (r: Row): Progress => ({ bank: r.bank, state: r.state, updatedAt: r.updated_at });

export class QuizProgressRepository {
  constructor(private readonly pool: Pool) {}

  static assertBank(bank: string): asserts bank is Bank {
    if ((BANKS as readonly string[]).includes(bank) === false) throw new UnknownBankError(bank);
  }

  async get(bank: string, actor: Actor): Promise<Progress | null> {
    QuizProgressRepository.assertBank(bank);
    const { rows } = await this.pool.query<Row>(
      'select bank, state, updated_at from quiz_progress where actor_id = $1 and bank = $2',
      [actor.id, bank],
    );
    return rows.length ? toProgress(rows[0]) : null;
  }

  async put(bank: string, state: Record<string, unknown>, actor: Actor): Promise<Progress> {
    QuizProgressRepository.assertBank(bank);
    const { rows } = await this.pool.query<Row>(
      `insert into quiz_progress (actor_id, bank, state)
       values ($1, $2, $3::jsonb)
       on conflict (actor_id, bank) do update set state = excluded.state, updated_at = now()
       returning bank, state, updated_at`,
      [actor.id, bank, JSON.stringify(state)],
    );
    return toProgress(rows[0]);
  }

  /**
   * Reset.
   *
   * The row is removed rather than overwritten with an empty score sheet: absent
   * and freshly-zeroed mean the same thing to the reviewer, and one of them does
   * not leave a row claiming somebody studied.
   */
  async clear(bank: string, actor: Actor): Promise<boolean> {
    QuizProgressRepository.assertBank(bank);
    const { rowCount } = await this.pool.query('delete from quiz_progress where actor_id = $1 and bank = $2', [
      actor.id,
      bank,
    ]);
    return (rowCount ?? 0) > 0;
  }
}
