/**
 * The reviewer's rules, as pure functions.
 *
 * Scoring, streaks, the bonus for a fast answer, what a session does to a score
 * sheet — all ported from the reviewer that has been in use, deliberately
 * unchanged. Someone's accumulated XP has to keep meaning what it meant.
 *
 * Kept separate from the screen and from the server so all three cannot disagree:
 * the repository stores whatever it is given, the screen draws it, and the rules
 * are here where they can be tested without a DOM or a database.
 */

export interface Question {
  id: string;
  topic: string;
  q: string;
  choices: string[];
  answer: number;
  explain?: string;
  src?: string;
}

export interface RecallItem {
  id: string;
  topic: string;
  q: string;
  a: string;
  src?: string;
}

export interface TopicTally {
  n: number;
  c: number;
}

export interface HistoryEntry {
  d: number;
  mode: string;
  set?: number;
  correct: number;
  total: number;
  pct: number;
  score: number;
  secs: number;
  streak: number;
}

export interface Progress {
  xp: number;
  answered: number;
  correct: number;
  bestStreak: number;
  runs: number;
  exams: number;
  perfect: number;
  fast: number;
  topics: Record<string, TopicTally>;
  missed: string[];
  badges: string[];
  hist: HistoryEntry[];
  setsDone: Record<string, { best: number; total: number }>;
  recall: { seen: number; known: number; topics: Record<string, TopicTally> };
}

export const SET_SIZE = 100;

export function blankProgress(): Progress {
  return {
    xp: 0,
    answered: 0,
    correct: 0,
    bestStreak: 0,
    runs: 0,
    exams: 0,
    perfect: 0,
    fast: 0,
    topics: {},
    missed: [],
    badges: [],
    hist: [],
    setsDone: {},
    recall: { seen: 0, known: 0, topics: {} },
  };
}

/** Anything stored is merged onto a blank, so an older sheet is never missing a field. */
export function hydrate(state: unknown): Progress {
  const blank = blankProgress();
  if (!state || typeof state !== 'object') return blank;
  return { ...blank, ...(state as Partial<Progress>), recall: { ...blank.recall, ...(state as Progress).recall } };
}

export function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Only questions the reviewer can actually show.
 *
 * Three or four choices, and an answer that points at one of them. The original
 * reviewer dropped malformed questions silently, which is how 83 of them once
 * vanished from a bank without a single error; here the count that was dropped is
 * returned so the screen can say so.
 */
export function buildBank(raw: unknown): { bank: Question[]; dropped: number; duplicates: number } {
  const source = Array.isArray(raw) ? (raw as Question[]) : [];
  const seen = new Set<string>();
  const bank: Question[] = [];
  let dropped = 0;
  let duplicates = 0;

  for (const q of source) {
    if (!q || !Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 4) {
      dropped++;
      continue;
    }
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.choices.length) {
      dropped++;
      continue;
    }
    // Deduplicated on the stem with punctuation and spacing stripped, so
    // "ASTM C150" and "ASTM C 150" are recognised as the same question.
    const key = String(q.q ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!key || seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    bank.push(q);
  }
  return { bank, dropped, duplicates };
}

export function buildRecall(raw: unknown): RecallItem[] {
  const source = Array.isArray(raw) ? (raw as RecallItem[]) : [];
  return source.filter((r) => r && r.q && r.a);
}

export type Mode = 'quick' | 'exam' | 'set' | 'weak' | 'missed';

/** Which questions a drill asks. */
export function poolFor(mode: Mode, bank: Question[], progress: Progress, topics: string[], setIdx = 0): Question[] {
  if (mode === 'quick') return shuffle(bank).slice(0, 20);
  if (mode === 'exam') return shuffle(bank).slice(0, SET_SIZE);
  if (mode === 'set') return shuffle(bank.slice(setIdx * SET_SIZE, (setIdx + 1) * SET_SIZE));

  if (mode === 'weak') {
    const ranked = Object.entries(progress.topics)
      .filter(([, t]) => t.n >= 3)
      .sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n)
      .slice(0, 3)
      .map(([k]) => k);
    const want = new Set(ranked.length ? ranked : topics);
    return shuffle(bank.filter((q) => want.has(q.topic))).slice(0, 30);
  }

  const missed = new Set(progress.missed);
  return shuffle(bank.filter((q) => missed.has(q.id))).slice(0, 40);
}

export interface Scored {
  right: boolean;
  points: number;
  multiplier: number;
  speedBonus: boolean;
}

/**
 * What one answer is worth.
 *
 * 100 points, multiplied by a streak bonus that rises every five in a row and
 * stops at three times, plus 25 for answering within eight seconds. Unchanged
 * from the reviewer in use — an XP total earned under the old rules has to keep
 * meaning what it meant.
 */
export function score(right: boolean, streakAfter: number, seconds: number): Scored {
  if (!right) return { right: false, points: 0, multiplier: 1, speedBonus: false };
  const multiplier = Math.min(3, 1 + Math.floor(streakAfter / 5) * 0.25);
  const speedBonus = seconds <= 8;
  return { right: true, points: Math.round(100 * multiplier) + (speedBonus ? 25 : 0), multiplier, speedBonus };
}

/** Fold one answer into the score sheet. Returns a new sheet; the old one is untouched. */
export function recordAnswer(
  progress: Progress,
  question: Question,
  right: boolean,
  points: number,
  speedBonus: boolean,
  streakAfter: number,
): Progress {
  const topics = { ...progress.topics };
  const t = topics[question.topic] ?? { n: 0, c: 0 };
  topics[question.topic] = { n: t.n + 1, c: t.c + (right ? 1 : 0) };

  const missed = right
    ? progress.missed.filter((id) => id !== question.id)
    : progress.missed.includes(question.id)
      ? progress.missed
      : [...progress.missed, question.id];

  return {
    ...progress,
    answered: progress.answered + 1,
    correct: progress.correct + (right ? 1 : 0),
    bestStreak: Math.max(progress.bestStreak, streakAfter),
    fast: progress.fast + (speedBonus ? 1 : 0),
    topics,
    missed,
    xp: progress.xp + points,
  };
}

/** Fold a finished session into the score sheet. */
export function recordSession(
  progress: Progress,
  run: { mode: Mode; setIdx?: number; correct: number; total: number; score: number; seconds: number; best: number },
): Progress {
  const pct = run.total ? Math.round((run.correct / run.total) * 100) : 0;
  const setsDone = { ...progress.setsDone };

  if (run.mode === 'set' && run.setIdx !== undefined) {
    const rec = setsDone[run.setIdx] ?? { best: 0, total: run.total };
    setsDone[run.setIdx] = { best: Math.max(rec.best, run.correct), total: run.total };
  }

  return {
    ...progress,
    runs: progress.runs + 1,
    exams: progress.exams + (run.mode === 'exam' ? 1 : 0),
    perfect: progress.perfect + (run.correct === run.total && run.total > 0 ? 1 : 0),
    setsDone,
    hist: [
      {
        d: Date.now(),
        mode: run.mode,
        set: run.setIdx,
        correct: run.correct,
        total: run.total,
        pct,
        score: run.score,
        secs: run.seconds,
        streak: run.best,
      },
      ...progress.hist,
    ].slice(0, 50),
  };
}

export function accuracy(p: Progress): number | null {
  return p.answered ? Math.round((p.correct / p.answered) * 100) : null;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
