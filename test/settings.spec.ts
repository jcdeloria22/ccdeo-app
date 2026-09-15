/**
 * Office reference data.
 *
 * Signatories and proclaimed holidays decide what an issued document says and
 * which working days every calculated date lands on. So the things worth proving
 * are that an unknown key cannot be invented, and that every change leaves a
 * trail — "it was changed at some point" does not answer a question about a
 * document that has already gone out on paper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { AuditRepository } from '../src/audit/audit.repository';
import {
  SettingsRepository,
  SETTING_KEYS,
  UnknownSettingError,
} from '../src/settings/settings.repository';
import type { Role } from '../src/policy/roles';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const as = (role: Role, id = 'operator:single') => ({
  id,
  name: 'Jayz',
  email: 'jayz@example.com',
  role,
  authMode: 'password' as const,
});

describe('the known keys', () => {
  it('are the ones the Builder reads, and nothing else', () => {
    expect([...SETTING_KEYS]).toEqual(['builder.signatories', 'builder.holidays']);
  });

  it('refuse anything else, rather than storing it where nothing looks', () => {
    expect(() => SettingsRepository.assertKnown('builder.nonsense')).toThrow(UnknownSettingError);
    expect(() => SettingsRepository.assertKnown('')).toThrow(UnknownSettingError);
  });

  it('name the alternatives when they refuse', () => {
    try {
      SettingsRepository.assertKnown('typo');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/builder\.signatories, builder\.holidays/);
    }
  });
});

run('settings', () => {
  let pool: Pool;
  let settings: SettingsRepository;
  let audit: AuditRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table app_settings');
    settings = new SettingsRepository(pool);
    audit = new AuditRepository(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('returns nothing for a setting never written', async () => {
    expect(await settings.get('builder.signatories')).toBeNull();
  });

  it('stores a value and says who wrote it', async () => {
    const value = { chair: 'Engr. A', vice: 'Engr. B', de: 'Engr. C', so: 'S.O. 1' };
    const saved = await settings.put('builder.signatories', value, as('admin'));

    expect(saved.value).toEqual(value);
    expect(saved.updatedBy).toBe('operator:single');
    expect(saved.updatedByRole).toBe('admin');
    expect(saved.updatedAt).toBeInstanceOf(Date);
  });

  it('reads back exactly what was written', async () => {
    const got = await settings.get<{ chair: string }>('builder.signatories');
    expect(got?.value.chair).toBe('Engr. A');
  });

  it('replaces rather than accumulating', async () => {
    await settings.put('builder.signatories', { chair: 'Engr. Z' }, as('admin'));
    const got = await settings.get<Record<string, string>>('builder.signatories');
    expect(got?.value).toEqual({ chair: 'Engr. Z' });

    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from app_settings where key = 'builder.signatories'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('records the role the change was made under, not only who made it', async () => {
    const saved = await settings.put('builder.holidays', ['2026-11-02'], as('materials_engineer'));
    expect(saved.updatedByRole).toBe('materials_engineer');
  });

  it('holds a list as happily as an object', async () => {
    const got = await settings.get<string[]>('builder.holidays');
    expect(got?.value).toEqual(['2026-11-02']);

    await settings.put('builder.holidays', [], as('admin'));
    expect((await settings.get<string[]>('builder.holidays'))?.value).toEqual([]);
  });

  it('lists what has been set', async () => {
    const all = await settings.all();
    expect(all.map((s) => s.key).sort()).toEqual(['builder.holidays', 'builder.signatories']);
  });

  it('refuses an unknown key at the repository, not only at the route', async () => {
    await expect(settings.put('builder.nonsense', 1, as('admin'))).rejects.toBeInstanceOf(UnknownSettingError);
    await expect(settings.get('builder.nonsense')).rejects.toBeInstanceOf(UnknownSettingError);
  });

  /**
   * The reason these are on the server at all. A signatory name that turns out to
   * have been wrong on an issued resolution is answered by this trail.
   */
  it('audits every change, with the value that was set', async () => {
    const events = await audit.forSubject('setting', 'builder.signatories');
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.action === 'setting.changed')).toBe(true);
    expect(events[events.length - 1].detail).toEqual({ value: { chair: 'Engr. Z' } });
    expect(events[0].actorRole).toBe('admin');
  });

  it('leaves the audit chain whole', async () => {
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('writes no audit event when the write is refused', async () => {
    const before = (await audit.list(1000)).length;
    await expect(settings.put('builder.nonsense', 1, as('admin'))).rejects.toThrow();
    expect((await audit.list(1000)).length).toBe(before);
  });
});
