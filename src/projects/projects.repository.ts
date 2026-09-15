/**
 * DC-02 — projects, with the duplicate guard.
 *
 * The guard lives in the database as a unique constraint on a normalised key.
 * Checking "does it exist?" in application code before inserting is a race: two
 * requests can both read "no" and both insert. Here the second insert is refused
 * by Postgres and translated into a useful error.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';

export interface Project {
  readonly id: string;
  readonly contractId: string;
  readonly contractKey: string;
  readonly name: string;
  readonly location: string | null;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly createdByRole: string;
}

export interface NewProject {
  readonly contractId: string;
  readonly name: string;
  readonly location?: string | null;
}

/** Postgres' code for unique_violation. */
const UNIQUE_VIOLATION = '23505';

export class DuplicateProjectError extends Error {
  constructor(
    readonly contractId: string,
    readonly existing: Project | null,
  ) {
    super(
      existing
        ? `Contract ${contractId} already exists as "${existing.name}" (added ${existing.createdAt.toISOString().slice(0, 10)} by ${existing.createdBy}).`
        : `Contract ${contractId} already exists.`,
    );
    this.name = 'DuplicateProjectError';
  }
}

/** The same normalisation the database applies, for lookups and for tests. */
export function contractKey(contractId: string): string {
  return contractId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

interface Row {
  id: string;
  contract_id: string;
  contract_key: string;
  name: string;
  location: string | null;
  created_at: Date;
  created_by: string;
  created_by_role: string;
}

const toProject = (r: Row): Project => ({
  id: r.id,
  contractId: r.contract_id,
  contractKey: r.contract_key,
  name: r.name,
  location: r.location,
  createdAt: r.created_at,
  createdBy: r.created_by,
  createdByRole: r.created_by_role,
});

const COLUMNS = 'id, contract_id, contract_key, name, location, created_at, created_by, created_by_role';

export class ProjectsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewProject, actor: Actor): Promise<Project> {
    const contractId = input.contractId.trim();
    const name = input.name.trim();

    try {
      const { rows } = await this.pool.query<Row>(
        `insert into projects (contract_id, name, location, created_by, created_by_role)
         values ($1, $2, $3, $4, $5)
         returning ${COLUMNS}`,
        [contractId, name, input.location ?? null, actor.id, actor.role],
      );
      return toProject(rows[0]);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === UNIQUE_VIOLATION) {
        // Report what it collided with — "already exists" alone makes the
        // operator go looking.
        throw new DuplicateProjectError(contractId, await this.findByContractId(contractId));
      }
      throw err;
    }
  }

  async findByContractId(contractId: string): Promise<Project | null> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from projects where contract_key = $1`,
      [contractKey(contractId)],
    );
    return rows.length ? toProject(rows[0]) : null;
  }

  async findById(id: string): Promise<Project | null> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from projects where id = $1`, [id]);
    return rows.length ? toProject(rows[0]) : null;
  }

  async list(limit = 100, offset = 0): Promise<Project[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from projects order by created_at desc limit $1 offset $2`,
      [limit, offset],
    );
    return rows.map(toProject);
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('select count(*)::text as n from projects');
    return Number(rows[0].n);
  }
}
