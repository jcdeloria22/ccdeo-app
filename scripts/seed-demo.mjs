/**
 * Put believable work in the local database so the screens can be looked at.
 *
 *   npm run seed:demo
 *
 * DESTRUCTIVE. It clears documents, transitions, approvals and reminders, then
 * builds two contracts with documents sitting at Final for varying lengths and
 * runs the reminder engine over them. That produces overdue and warning
 * reminders, an approval-debt list, and a readiness figure that is honestly zero.
 *
 * It refuses to run against anything but a loopback database. The tables it
 * empties are append-only by design — the triggers refuse DELETE, so this has to
 * use TRUNCATE, which is exactly the blunt instrument that must never be pointed
 * at a real register.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const dist = (p) => require(path.join(ROOT, 'dist', p));

dist('config/load-dotenv').loadDotenv();

const { Pool } = require('pg');
const { ProjectsRepository } = dist('projects/projects.repository');
const { SlotsRepository } = dist('slots/slots.repository');
const { UploadsRepository } = dist('uploads/uploads.repository');
const { FilesystemStorage } = dist('storage/filesystem.storage');
const { DocumentsRepository } = dist('lifecycle/documents.repository');
const { AgeingRepository } = dist('ageing/ageing.repository');

/**
 * Loopback only.
 *
 * The same reasoning as the bind guard: this is safe on one machine and
 * catastrophic anywhere else, so it is refused rather than left to judgement.
 */
function assertLocal(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a URL: ${url}`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `Refusing to seed ${host}. This truncates tables and is only ever safe against a local database.`,
    );
  }
  return host;
}

const actor = (role) => ({
  id: 'operator:single',
  name: process.env.OPERATOR_NAME || 'Operator',
  email: process.env.OPERATOR_EMAIL || 'operator@example.com',
  role,
  authMode: 'none',
});

/** The scan gate is exercised properly elsewhere; here it just has to pass. */
const cleanScanner = {
  name: 'demo',
  available: async () => true,
  scan: async () => ({ verdict: 'clean', detail: null, scanner: 'demo', scannedAt: new Date() }),
};

const SLOTS = [
  { slotCode: 'qcp', name: 'Quality Control Program', required: true },
  { slotCode: 'mix-design', name: 'Concrete mix design', required: true },
  { slotCode: 'trial-section', name: 'Trial section report', required: true },
  { slotCode: 'mtr', name: 'Minimum test requirements summary', required: false },
];

const CONTRACTS = [
  { contractId: '26HH0041', name: 'Rehabilitation of Barangay Road, Section 1' },
  { contractId: '26HH0052', name: 'Drainage improvement, Phase 2' },
];

/** contract, slot, title, days sitting at Final — spread across both SLA bands. */
const WORK = [
  ['26HH0041', 'qcp', 'QCP — Rehabilitation of Barangay Road, Section 1', 22],
  ['26HH0041', 'mix-design', 'Class A concrete mix design, 24.1 MPa', 11],
  ['26HH0041', 'trial-section', 'Trial section — aggregate base course', 4],
  ['26HH0052', 'qcp', 'QCP — Drainage improvement, Phase 2', 9],
  ['26HH0052', 'mtr', 'MTR summary — Items 200, 201, 311', 3],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  const host = assertLocal(url);

  const pool = new Pool({ connectionString: url });
  const storage = new FilesystemStorage(path.join(ROOT, '.demo-blobs'));
  const projects = new ProjectsRepository(pool);
  const slots = new SlotsRepository(pool);
  const uploads = new UploadsRepository(pool, storage, cleanScanner);
  const docs = new DocumentsRepository(pool);
  const ageing = new AgeingRepository(pool);

  console.log(`Seeding ${host} — clearing documents, transitions, approvals and reminders.`);

  await pool.query(
    'truncate table reminder_acknowledgements, reminders, document_transitions, approvals, documents cascade',
  );
  await pool.query("delete from uploads where project_id in (select id from projects where contract_id like '26HH%')");
  await pool.query(
    "delete from project_slots where project_id in (select id from projects where contract_id like '26HH%')",
  );
  await pool.query("delete from projects where contract_id like '26HH%'");
  await pool.query(
    "delete from slot_template_items where template_id in (select id from slot_templates where code = 'demo-set')",
  );
  await pool.query("delete from slot_templates where code = 'demo-set'");

  const template = await slots.createVersion(
    { code: 'demo-set', name: 'Roads — standard set', items: SLOTS },
    actor('admin'),
  );
  await slots.publish(template.id);

  const ids = {};
  for (const c of CONTRACTS) {
    const p = await projects.create(c, actor('admin'));
    ids[c.contractId] = p.id;
    await slots.instantiate(p.id, 'demo-set');
  }

  for (const [contractId, slotCode, title, daysAgo] of WORK) {
    const projectId = ids[contractId];
    const u = await uploads.upload(
      { projectId, slotCode, filename: `${slotCode}.pdf`, bytes: Buffer.from(`${contractId}/${slotCode}/${title}`) },
      actor('admin'),
    );
    await uploads.scan(u.id);
    const d = await docs.create({ projectId, slotCode, title, uploadId: u.id }, actor('materials_engineer'));
    const final = await docs.transition(d.id, 'Final', actor('materials_engineer'));

    // Backdate the clock so the ageing engine has something to find.
    await pool.query("update documents set state_since = now() - ($2 || ' days')::interval where id = $1", [
      final.id,
      String(daysAgo),
    ]);
  }

  const raised = await ageing.run(new Date(), actor('admin'));
  const byLevel = raised.reduce((acc, r) => ({ ...acc, [r.level]: (acc[r.level] ?? 0) + 1 }), {});

  console.log(
    [
      '',
      `  contracts  ${CONTRACTS.length}`,
      `  documents  ${WORK.length}, all at Final`,
      `  reminders  ${raised.length} raised (${Object.entries(byLevel).map(([k, v]) => `${v} ${k}`).join(', ')})`,
      '',
      '  Readiness will read 0% — nothing is Signed. That is the point: Final is not readiness.',
      '  Sign something in the Register to watch it move.',
      '',
    ].join('\n'),
  );

  await pool.end();
}

main().catch((e) => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
