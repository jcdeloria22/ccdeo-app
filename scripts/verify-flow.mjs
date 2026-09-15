/**
 * Drive the whole register over HTTP, against a running server.
 *
 *   npm start          # in one terminal
 *   npm run verify:flow
 *
 * The unit tests prove each rule in isolation; this proves the rules survive the
 * trip through routing, the guard, the actor middleware and the exception filter
 * — which is where a correct repository and a wrong status code look identical.
 *
 * Every refusal below is expected. A run where they all succeed is a failure.
 */
import { createHash } from 'node:crypto';
const B = 'http://127.0.0.1:3000';
const j = async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
};
const step = (n, r, extra='') => console.log(String(r.status).padEnd(4), n.padEnd(34), extra || (r.d?.message ?? ''));

const bytes = Buffer.from('QCP for 26FL0001 — flow test ' + Date.now());
const sha = createHash('sha256').update(bytes).digest('hex');
const cid = '26FL' + String(Date.now()).slice(-4);

// Self-sufficient: the suite truncates slot templates, so this makes its own
// rather than depending on whatever the last seed left behind.
const tcode = 'flow-set';
let r = await j('POST', '/slot-templates', {
  code: tcode, name: 'Flow test set',
  items: [
    { slotCode: 'qcp', name: 'Quality Control Program', required: true },
    { slotCode: 'mix-design', name: 'Concrete mix design', required: true },
    { slotCode: 'trial-section', name: 'Trial section report', required: true },
  ],
});
step('draft slot template', r, r.d?.template?.status + ' v' + r.d?.template?.version);
r = await j('POST', `/slot-templates/${r.d.template.id}/publish`, {});
step('publish slot template', r, r.d?.template?.status);

r = await j('POST', '/projects', { contractId: cid, name: 'Flow test contract' });
step('create contract', r, r.d?.project?.contractId);
const pid = r.d.project.id;

r = await j('POST', `/projects/${pid}/slots`, { templateCode: tcode });
step('instantiate slots', r, (r.d?.slots ?? []).length + ' slots');

r = await j('POST', '/projects', { contractId: cid, name: 'Duplicate' });
step('duplicate refused', r, r.d?.error);

r = await j('POST', `/projects/${pid}/slots/qcp/uploads/presign`, { sha256: sha });
step('presign', r, r.d?.url);
const put = await fetch(B + r.d.url, { method: 'PUT', body: bytes });
step('PUT bytes to presigned url', { status: put.status }, (await put.json()).key);

r = await j('POST', `/projects/${pid}/slots/qcp/uploads/register`, { sha256: sha, filename: 'qcp.pdf' });
step('register upload', r, 'scan=' + r.d?.upload?.scanState);
const uid = r.d.upload.id;

r = await j('POST', `/projects/${pid}/slots/qcp/uploads/${uid}/scan`, {});
step('scan', r, 'scan=' + r.d?.upload?.scanState);

r = await j('POST', '/documents', { projectId: pid, slotCode: 'qcp', title: 'QCP — flow test', uploadId: uid });
step('create document', r, r.d?.document?.state);
const did = r.d.document.id;

r = await j('POST', `/documents/${did}/transition`, { to: 'Signed' });
step('sign before Final refused', r, r.d?.error);

r = await j('POST', `/documents/${did}/transition`, { to: 'Final' });
step('finalize', r, r.d?.document?.state + ' hash=' + (r.d?.document?.contentHash ?? '').slice(0,10));

r = await j('POST', `/documents/${did}/transition`, { to: 'Draft' });
step('reject without reason refused', r, r.d?.error);

r = await j('POST', `/documents/${did}/transition`, { to: 'Signed' });
step('sign', r, r.d?.document?.state);

r = await j('POST', `/projects/${pid}/slots/mix-design/waive`, {});
step('waive without reason refused', r, r.d?.error);

r = await j('POST', `/projects/${pid}/slots/mix-design/waive`, { reason: 'No concrete works' });
step('waive', r, r.d?.slot?.state);

r = await j('GET', `/projects/${pid}`);
step('readiness after signing', r, r.d?.readiness?.readiness?.percent + '%');

r = await j('POST', '/reminders/run', {});
step('run reminder engine', r, 'raised ' + r.d?.raised);

r = await j('GET', '/audit/verify');
step('audit chain', r, r.d?.ok ? 'intact, ' + r.d.checked + ' events' : 'BROKEN');
