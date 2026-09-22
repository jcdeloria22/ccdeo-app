/**
 * Create an account from the command line.
 *
 * This is how the first administrator exists. There is deliberately no
 * bootstrap-from-environment path: a password in an environment variable is a
 * password in the platform's dashboard, in its audit log, and in every process
 * listing on the machine, and it stays there long after it has been changed.
 *
 * By default the password is **generated here and printed once**. Nothing else
 * ever prints it, it is not written to a file, and the account is flagged
 * `must_change_password` so the person who receives it replaces it before they
 * can do anything else — which means whoever ran this command does not end up
 * holding a working credential for someone else's account.
 *
 *   npm run user:create -- --email me@dpwh.gov.ph --name "Jayz" --role admin
 *
 * In a deployed container there is no TypeScript and no `src/`, so the compiled
 * form is the one that works there — `npm run user:create:prod`, or directly:
 *
 *   node dist/auth/create-user.cli.js --email me@dpwh.gov.ph --name "Jayz" --role admin
 *
 * `--password` exists for the case where you are creating your own account and
 * would rather choose. It is read from the environment variable it names, not
 * from the argument, so it does not land in shell history:
 *
 *   NEWPASS='...' npm run user:create -- --email ... --password-env NEWPASS
 */
import { randomBytes } from 'node:crypto';
import { loadDotenv } from '../config/load-dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { migrate } from '../db/migrate';
import { UsersRepository } from './users.repository';
import { ROLES } from '../policy/roles';
import type { Actor } from '../operator/operator';

/** A generated password: 24 random bytes, base64url. Comfortably unguessable. */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const USAGE = `
Create an account.

  npm run user:create -- --email <address> --name "<full name>" --role <role>

  --role            one of: ${ROLES.join(', ')}
  --password-env    read the password from this environment variable instead of
                    generating one (keeps it out of shell history)
  --must-change     force a password change at first sign-in (default: true for a
                    generated password, false for one you supplied)
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    console.log(USAGE);
    return;
  }

  const email = arg(argv, 'email');
  const name = arg(argv, 'name');
  const role = arg(argv, 'role') ?? 'admin';
  const passwordEnv = arg(argv, 'password-env');

  if (!email || !name) {
    console.error('Both --email and --name are required.\n' + USAGE);
    process.exitCode = 1;
    return;
  }

  const supplied = passwordEnv ? process.env[passwordEnv] : undefined;
  if (passwordEnv && !supplied) {
    console.error(`--password-env ${passwordEnv} was given but ${passwordEnv} is not set.`);
    process.exitCode = 1;
    return;
  }

  const password = supplied ?? generatePassword();
  const mustChange = argv.includes('--must-change') ? true : supplied === undefined;

  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env);

  try {
    await migrate(pool);
    const users = new UsersRepository(pool);

    /*
     * The actor for this act is the command line itself. It is recorded as the
     * creator so the row is not attributed to a person who was not involved.
     */
    const actor: Actor = {
      id: 'cli',
      name: 'Command line',
      email: env.OPERATOR_EMAIL ?? 'cli@localhost',
      role: 'admin',
      authMode: env.AUTH_MODE,
    };

    const user = await users.create({ email, name, role, password, mustChangePassword: mustChange }, actor);

    console.log(`\ncreated ${user.email}`);
    console.log(`  name  ${user.name}`);
    console.log(`  role  ${user.role}`);

    if (supplied) {
      console.log('\n  password: taken from the environment variable you named; not shown here.');
    } else {
      console.log('\n  password (shown once, not stored anywhere else):\n');
      console.log(`      ${password}\n`);
      console.log('  Give it to them over something other than email if you can, and they will be');
      console.log('  required to change it the first time they sign in.');
    }
    if (mustChange) console.log('\n  This account must change its password before it can do anything else.');
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  // The message, not the stack: a stack here is noise, and the interesting
  // failures (duplicate address, weak password, unknown role) already explain
  // themselves.
  console.error(`\n${(e as Error).message}\n`);
  process.exitCode = 1;
});
