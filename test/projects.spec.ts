/**
 * DC-02 — projects and the duplicate guard, against a real PostgreSQL.
 *
 * These are skipped when DATABASE_URL is unset, so the suite stays green before a
 * database exists. They are NOT written against an in-memory stand-in: the guard
 * being tested *is* a database constraint, and a fake would prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { ProjectsRepository, DuplicateProjectError, contractKey } from '../src/projects/projects.repository';
import { seededOperator } from '../src/operator/operator';
import { loadEnv } from '../src/config/env';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

if (!url) {
  // eslint-disable-next-line no-console
  console.warn('DATABASE_URL not set — DC-02 database tests skipped');
}

run('DC-02 projects', () => {
  let pool: Pool;
  let repo: ProjectsRepository;

  const actor = seededOperator(
    loadEnv({
      AUTH_MODE: 'none',
      OPERATOR_NAME: 'Jayz',
      OPERATOR_EMAIL: 'jayz@example.com',
    } as NodeJS.ProcessEnv),
    'materials_engineer',
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table projects cascade');
    repo = new ProjectsRepository(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('creates a project and returns it', async () => {
    const p = await repo.create({ contractId: '26HH0025', name: 'Construction of Bridge, Sitio Dita' }, actor);
    expect(p.contractId).toBe('26HH0025');
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records the actor and the role the act was performed under', async () => {
    const p = await repo.findByContractId('26HH0025');
    expect(p?.createdBy).toBe(actor.id);
    expect(p?.createdByRole).toBe('materials_engineer');
  });

  it('refuses an exact duplicate', async () => {
    await expect(repo.create({ contractId: '26HH0025', name: 'Anything' }, actor)).rejects.toBeInstanceOf(
      DuplicateProjectError,
    );
  });

  // The identifier arrives typed by hand, off a scan, or pasted. These are all
  // one contract, and the guard has to know that.
  const sameContract = ['26hh0025', '26-HH-0025', ' 26HH0025 ', '26 HH 0025', '26.hh.0025'];
  for (const variant of sameContract) {
    it(`treats ${JSON.stringify(variant)} as the same contract`, async () => {
      await expect(repo.create({ contractId: variant, name: 'Variant' }, actor)).rejects.toBeInstanceOf(
        DuplicateProjectError,
      );
    });
  }

  it('says what the collision was, not merely that there was one', async () => {
    try {
      await repo.create({ contractId: '26hh0025', name: 'Variant' }, actor);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('Construction of Bridge');
      expect((e as Error).message).toContain('26hh0025');
    }
  });

  it('allows a genuinely different contract', async () => {
    const p = await repo.create({ contractId: '26HH0079', name: 'Another contract' }, actor);
    expect(p.contractId).toBe('26HH0079');
    expect(await repo.count()).toBe(2);
  });

  it('finds by any punctuation of the same id', async () => {
    const a = await repo.findByContractId('26HH0079');
    const b = await repo.findByContractId('26-hh-0079');
    expect(a?.id).toBe(b?.id);
  });

  it('rejects blank ids and names at the database, not just in code', async () => {
    await expect(repo.create({ contractId: '   ', name: 'x' }, actor)).rejects.toThrow();
    await expect(repo.create({ contractId: '26HH9999', name: '   ' }, actor)).rejects.toThrow();
  });

  it('lists newest first', async () => {
    const list = await repo.list();
    expect(list[0].contractId).toBe('26HH0079');
  });
});

describe('contractKey', () => {
  it('normalises the way the database does', () => {
    expect(contractKey('26-hh-0025')).toBe('26HH0025');
    expect(contractKey(' 26 HH 0025 ')).toBe('26HH0025');
  });
});
