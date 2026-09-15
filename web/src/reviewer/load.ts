/**
 * Loading a question bank, only when its reviewer is opened.
 *
 * ~1.3 MB across the three banks, which nobody opening the Reminders tab should
 * pay for. They are plain scripts assigning to `window`, vendored byte-identically
 * from the reviewers in use, so they are loaded the same way the Builder's
 * libraries are.
 */

declare global {
  interface Window {
    ME_QUESTIONS?: unknown;
    ME_RECALL?: unknown;
    PE_QUESTIONS?: unknown;
    WORKFLOW_DATA?: unknown;
    INVENTORY?: unknown;
  }
}

/** Load a plain script once, and resolve when it has run. */
function script(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Could not load ${src}. Run npm run sync:vendored.`));
    document.head.appendChild(el);
  });
}

export interface BankSource {
  questions: unknown;
  recall: unknown;
}

const loading: Partial<Record<'me' | 'pe', Promise<BankSource>>> = {};

export function loadBank(bank: 'me' | 'pe'): Promise<BankSource> {
  const existing = loading[bank];
  if (existing) return existing;

  const next = (async (): Promise<BankSource> => {
    if (bank === 'me') {
      await script('/data/me-questions.js');
      await script('/data/me-recall.js');
      if (window.ME_QUESTIONS === undefined) throw new Error('The ME question bank did not load.');
      return { questions: window.ME_QUESTIONS, recall: window.ME_RECALL ?? [] };
    }
    await script('/data/pe-questions.js');
    if (window.PE_QUESTIONS === undefined) throw new Error('The PE question bank did not load.');
    return { questions: window.PE_QUESTIONS, recall: [] };
  })();

  loading[bank] = next;
  return next;
}

/**
 * The Workflow's content and the file index.
 *
 * Two more plain scripts, ~110 KB together, and loaded the same way and for the
 * same reason: nobody opening the Reminders tab should pay for them.
 */
let workflowLoading: Promise<{ workflow: unknown; inventory: unknown }> | null = null;

export function loadWorkflow(): Promise<{ workflow: unknown; inventory: unknown }> {
  if (workflowLoading) return workflowLoading;

  workflowLoading = (async () => {
    await script('/data/workflow-data.js');
    await script('/data/inventory.js');
    if (window.WORKFLOW_DATA === undefined) throw new Error('The workflow content did not load.');
    if (window.INVENTORY === undefined) throw new Error('The file index did not load.');
    return { workflow: window.WORKFLOW_DATA, inventory: window.INVENTORY };
  })();

  return workflowLoading;
}

/** Topic names, as the reviewers have always labelled them. */
export const ME_TOPICS: Record<string, string> = {
  soils: 'Soils & Aggregates',
  concrete: 'Concrete',
  asphalt: 'Asphalt & Bituminous',
  qc: 'Quality Control & Docs',
  steel: 'Steel & Misc. Materials',
  equip: 'Equipment & Test Methods',
};

export const PE_TOPICS: Record<string, string> = {
  contracts: 'Contracts & Procurement',
  structures: 'Bridges & Structures',
  hydraulics: 'Drainage & Flood Control',
  roads: 'Roads & Pavement',
  materials: 'Materials & Testing',
  admin: 'Project Admin & Survey',
};
