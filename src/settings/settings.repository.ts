/**
 * Office reference data, and a record of who changed it.
 *
 * Small on purpose: a key, a JSON value, and an audit event on every write.
 * These settings decide what appears on issued documents — a signatory's name, a
 * proclaimed non-working day that moves every calculated date — so "who changed
 * this, and when" is the part that matters, not the storage.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';
import { AuditRepository } from '../audit/audit.repository';

export interface Setting<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly updatedByRole: string;
}

/** The keys the Builder reads. Unknown keys are refused rather than stored. */
export const SETTING_KEYS = ['builder.signatories', 'builder.holidays'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export class UnknownSettingError extends Error {
  constructor(key: string) {
    super(`No setting called "${key}". Known settings: ${SETTING_KEYS.join(', ')}.`);
    this.name = 'UnknownSettingError';
  }
}

interface Row {
  key: string;
  value: unknown;
  updated_at: Date;
  updated_by: string;
  updated_by_role: string;
}

const toSetting = <T>(r: Row): Setting<T> => ({
  key: r.key,
  value: r.value as T,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  updatedByRole: r.updated_by_role,
});

export class SettingsRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.audit = new AuditRepository(pool);
  }

  static assertKnown(key: string): asserts key is SettingKey {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new UnknownSettingError(key);
  }

  async get<T>(key: string): Promise<Setting<T> | null> {
    SettingsRepository.assertKnown(key);
    const { rows } = await this.pool.query<Row>(
      'select key, value, updated_at, updated_by, updated_by_role from app_settings where key = $1',
      [key],
    );
    return rows.length ? toSetting<T>(rows[0]) : null;
  }

  async all(): Promise<Setting[]> {
    const { rows } = await this.pool.query<Row>(
      'select key, value, updated_at, updated_by, updated_by_role from app_settings order by key',
    );
    return rows.map((r) => toSetting(r));
  }

  /**
   * Write a setting, and record the change.
   *
   * The audit event carries the value that was set. A signatory list that turns
   * out to have been wrong on an issued document is answered by the trail, and
   * "it was changed at some point" does not answer it.
   */
  async put<T>(key: string, value: T, actor: Actor): Promise<Setting<T>> {
    SettingsRepository.assertKnown(key);

    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows } = await c.query<Row>(
        `insert into app_settings (key, value, updated_by, updated_by_role)
         values ($1, $2::jsonb, $3, $4)
         on conflict (key) do update
           set value = excluded.value,
               updated_at = now(),
               updated_by = excluded.updated_by,
               updated_by_role = excluded.updated_by_role
         returning key, value, updated_at, updated_by, updated_by_role`,
        [key, JSON.stringify(value), actor.id, actor.role],
      );
      await this.audit.append(
        { action: 'setting.changed', subjectType: 'setting', subjectId: key, detail: { value } },
        actor,
        c,
      );
      await c.query('commit');
      return toSetting<T>(rows[0]);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}
