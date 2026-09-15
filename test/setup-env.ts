/**
 * Load .env for tests.
 *
 * Without this, a clean shell runs `npm test`, DATABASE_URL is unset, and the
 * database specs SKIP — reporting a green run that proved none of the things
 * those specs exist to prove. A silent skip is worse than a failure.
 *
 * Real environment variables always win, so CI can override.
 */
import { loadDotenv } from '../src/config/load-dotenv';
import path from 'node:path';

loadDotenv(path.join(__dirname, '..', '.env'));
