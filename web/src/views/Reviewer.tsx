/**
 * The ME and PE reviewers.
 *
 * One screen, two banks. The scoring rules live in `reviewer/engine.ts` so they
 * can be tested without a DOM; this file is the surface and the session state.
 *
 * Progress is kept on the server rather than in this browser: clearing a cache
 * should not erase months of revision, and the same person at another machine is
 * still the same person. It is saved when a session ends and when the sheet is
 * reset — not on every answer, which would be a request per question.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { quizApi, ApiError } from '../api';
import { loadBank, ME_TOPICS, PE_TOPICS } from '../reviewer/load';
import {
  accuracy,
  blankProgress,
  buildBank,
  buildRecall,
  fmtTime,
  hydrate,
  poolFor,
  recordAnswer,
  recordSession,
  score,
  shuffle,
  SET_SIZE,
  type Mode,
  type Progress,
  type Question,
  type RecallItem,
} from '../reviewer/engine';
import { Action, Empty, Explain, Failed, Loading, Problem } from './bits';

const LETTERS = ['A', 'B', 'C', 'D'];

interface Session {
  mode: Mode;
  setIdx?: number;
  pool: Question[];
  i: number;
  score: number;
  correct: number;
  streak: number;
  best: number;
  fast: number;
  startedAt: number;
  askedAt: number;
  order: number[];
  answered: null | { chosen: number; right: boolean; points: number };
}

interface RecallRun {
  pool: RecallItem[];
  i: number;
  known: number;
  shown: boolean;
}

export default function Reviewer({ bank }: { bank: 'me' | 'pe' }) {
  const topics = bank === 'me' ? ME_TOPICS : PE_TOPICS;
  const name = bank === 'me' ? 'ME Reviewer' : 'PE Reviewer';

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [recallItems, setRecallItems] = useState<RecallItem[]>([]);
  const [dropped, setDropped] = useState({ dropped: 0, duplicates: 0 });
  const [progress, setProgress] = useState<Progress>(blankProgress());
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [recall, setRecall] = useState<RecallRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastRun, setLastRun] = useState<string | null>(null);

  /* Read inside the timer without making it a dependency. */
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [source, saved] = await Promise.all([loadBank(bank), quizApi.get(bank)]);
      const built = buildBank(source.questions);
      setQuestions(built.bank);
      setDropped({ dropped: built.dropped, duplicates: built.duplicates });
      setRecallItems(buildRecall(source.recall));
      setProgress(hydrate(saved.progress?.state));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, [bank]);

  useEffect(() => {
    setQuestions(null);
    setSession(null);
    setRecall(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (s) setElapsed((Date.now() - s.startedAt) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [session]);

  const save = async (next: Progress) => {
    setProgress(next);
    try {
      await quizApi.put(bank, next as unknown as Record<string, unknown>);
    } catch (e) {
      setProblem(e);
    }
  };

  /* -------------------------------------------------------------- drills --- */

  const start = (mode: Mode, setIdx?: number) => {
    if (!questions) return;
    const pool = poolFor(mode, questions, progress, Object.keys(topics), setIdx ?? 0);
    if (!pool.length) {
      setProblem(new Error('Not enough questions for that drill yet — answer a few more first.'));
      return;
    }
    const now = Date.now();
    setLastRun(null);
    setSession({
      mode,
      setIdx,
      pool,
      i: 0,
      score: 0,
      correct: 0,
      streak: 0,
      best: 0,
      fast: 0,
      startedAt: now,
      askedAt: now,
      order: shuffle(pool[0].choices.map((_, i) => i)),
      answered: null,
    });
  };

  const answer = (position: number) => {
    if (!session || session.answered) return;
    const q = session.pool[session.i];
    const chosen = session.order[position];
    const right = chosen === q.answer;
    const seconds = (Date.now() - session.askedAt) / 1000;
    const streakAfter = right ? session.streak + 1 : 0;
    const s = score(right, streakAfter, seconds);

    setSession({
      ...session,
      streak: streakAfter,
      best: Math.max(session.best, streakAfter),
      correct: session.correct + (right ? 1 : 0),
      score: session.score + s.points,
      fast: session.fast + (s.speedBonus ? 1 : 0),
      answered: { chosen, right, points: s.points },
    });
    setProgress((p) => recordAnswer(p, q, right, s.points, s.speedBonus, streakAfter));
  };

  const next = async () => {
    if (!session) return;
    if (session.i + 1 >= session.pool.length) return finish();
    const i = session.i + 1;
    setSession({
      ...session,
      i,
      askedAt: Date.now(),
      order: shuffle(session.pool[i].choices.map((_, k) => k)),
      answered: null,
    });
  };

  const finish = async () => {
    if (!session) return;
    const seconds = Math.round((Date.now() - session.startedAt) / 1000);
    const pct = Math.round((session.correct / session.pool.length) * 100);
    const next = recordSession(
      { ...progress, xp: progress.xp },
      {
        mode: session.mode,
        setIdx: session.setIdx,
        correct: session.correct,
        total: session.pool.length,
        score: session.score,
        seconds,
        best: session.best,
      },
    );
    setSession(null);
    setLastRun(`${session.correct} / ${session.pool.length} (${pct}%) in ${fmtTime(seconds)} · ${session.score} pts`);
    await save(next);
  };

  const quit = async () => {
    setSession(null);
    await save(progress);
  };

  const reset = async () => {
    if (
      !window.confirm(
        `Reset ${name} figures to zero?\n\nClears answered, accuracy, streak, sessions, topic mastery and history ` +
          'for this reviewer. Cannot be undone.',
      )
    ) {
      return;
    }
    setProblem(null);
    try {
      await quizApi.clear(bank);
      setProgress(blankProgress());
      setLastRun(null);
    } catch (e) {
      setProblem(e);
    }
  };

  /* -------------------------------------------------------------- recall --- */

  const startRecall = () => {
    if (!recallItems.length) return;
    setRecall({ pool: shuffle(recallItems).slice(0, 20), i: 0, known: 0, shown: false });
  };

  const gradeRecall = async (known: boolean) => {
    if (!recall) return;
    const item = recall.pool[recall.i];
    const topicsNext = { ...progress.recall.topics };
    const t = topicsNext[item.topic] ?? { n: 0, c: 0 };
    topicsNext[item.topic] = { n: t.n + 1, c: t.c + (known ? 1 : 0) };

    const nextProgress: Progress = {
      ...progress,
      recall: {
        seen: progress.recall.seen + 1,
        known: progress.recall.known + (known ? 1 : 0),
        topics: topicsNext,
      },
    };

    if (recall.i + 1 >= recall.pool.length) {
      setRecall(null);
      setLastRun(`${recall.known + (known ? 1 : 0)} / ${recall.pool.length} known`);
      await save(nextProgress);
      return;
    }
    setProgress(nextProgress);
    setRecall({ ...recall, i: recall.i + 1, known: recall.known + (known ? 1 : 0), shown: false });
  };

  /* -------------------------------------------------------------- render --- */

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (questions === null) {
    return (
      <div className="view">
        <header className="vhead">
          <h1>{name}</h1>
        </header>
        <Explain>Fetching the question bank. This happens once per visit.</Explain>
        <Loading />
      </div>
    );
  }

  if (session) return <Quiz session={session} elapsed={elapsed} topics={topics} onAnswer={answer} onNext={next} onQuit={quit} />;
  if (recall) {
    return (
      <Recall
        run={recall}
        topics={topics}
        onShow={() => setRecall({ ...recall, shown: true })}
        onGrade={gradeRecall}
        onQuit={() => setRecall(null)}
      />
    );
  }

  const acc = accuracy(progress);
  const started = progress.answered > 0 || progress.runs > 0 || progress.recall.seen > 0;
  const sets = Math.ceil(questions.length / SET_SIZE);

  return (
    <div className="view">
      <header className="vhead">
        <h1>{name}</h1>
        <span className="q">
          {questions.length.toLocaleString()} questions
          {recallItems.length > 0 && ` · ${recallItems.length.toLocaleString()} recall items`}
        </span>
      </header>
      <Explain>
        Practice against the bank. Your figures are kept on the server, so they survive a cleared browser and follow
        you to another machine.
      </Explain>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      {lastRun && (
        <div className="card lastrun">
          <b>Last drill:</b> {lastRun}
        </div>
      )}

      <div className="cards">
        <div>
          <div className="lbl q">Answered</div>
          <div className="figure">{progress.answered.toLocaleString()}</div>
        </div>
        <div>
          <div className="lbl q">Accuracy</div>
          <div className="figure">{acc === null ? '—' : <>{acc}<small>%</small></>}</div>
        </div>
        <div>
          <div className="lbl q">Best streak</div>
          <div className="figure">{progress.bestStreak}</div>
        </div>
        <div>
          <div className="lbl q">Sessions</div>
          <div className="figure">{progress.runs}</div>
        </div>
      </div>

      <div className="actions" style={{ marginTop: 12 }}>
        <Action
          label="Reset figures"
          onClick={reset}
          disabled={!started}
          why="Nothing to reset yet"
        />
        {started && <span className="q resetnote">Clears this reviewer only. Your other progress is untouched.</span>}
      </div>

      {(dropped.dropped > 0 || dropped.duplicates > 0) && (
        <p className="q nextnote">
          {dropped.dropped > 0 && `${dropped.dropped} question(s) in this bank are malformed and were left out. `}
          {dropped.duplicates > 0 && `${dropped.duplicates} duplicate(s) were merged.`}
        </p>
      )}

      <h2 className="h2">Choose a drill</h2>
      <div className="actions">
        <Action label="Quick 20" kind="primary" onClick={() => start('quick')} />
        <Action label={`Exam set — ${SET_SIZE}, timed`} onClick={() => start('exam')} />
        <Action
          label="Drill weak spots"
          onClick={() => start('weak')}
          disabled={progress.answered < 20}
          why="Answer at least 20 questions first, so there is something to be weak at"
        />
        <Action
          label="Retry missed"
          onClick={() => start('missed')}
          disabled={progress.missed.length === 0}
          why="You have not missed anything yet"
        />
        {recallItems.length > 0 && <Action label="Recall drill" onClick={startRecall} />}
      </div>

      <h2 className="h2">Topic mastery</h2>
      <div className="card">
        {Object.entries(topics).map(([key, label]) => {
          const t = progress.topics[key] ?? { n: 0, c: 0 };
          const pct = t.n ? Math.round((t.c / t.n) * 100) : 0;
          return (
            <div key={key} className="mastery">
              <div className="mastery-head">
                <b>{label}</b>
                <span className="q">{t.n ? `${pct}% of ${t.n}` : 'not started'}</span>
              </div>
              <div className="meter">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="h2">Exam sets</h2>
      <div className="actions">
        {Array.from({ length: sets }, (_, i) => {
          const done = progress.setsDone[i];
          const count = Math.min(SET_SIZE, questions.length - i * SET_SIZE);
          return (
            <Action
              key={i}
              label={`Set ${i + 1} — ${count}${done ? ` · best ${done.best}` : ''}`}
              onClick={() => start('set', i)}
            />
          );
        })}
      </div>

      <h2 className="h2">Recent sessions</h2>
      {progress.hist.length === 0 ? (
        <Empty title="No sessions yet." body="Finish a drill and it appears here." />
      ) : (
        <ul className="remlist">
          {progress.hist.slice(0, 10).map((h) => (
            <li key={h.d} className="rem">
              <span className={`level level-${h.pct >= 75 ? 'signed' : h.pct >= 50 ? 'in-progress' : 'overdue'}`}>
                {h.pct}%
              </span>
              <div className="rem-main">
                <div className="rem-title">
                  <b>
                    {h.correct} / {h.total}
                  </b>
                  <span className="q"> · {h.mode}{h.set !== undefined ? ` ${h.set + 1}` : ''}</span>
                </div>
                <div className="rem-meta q">
                  {new Date(h.d).toLocaleString()} · {fmtTime(h.secs)} · {h.score} pts · best streak {h.streak}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- quiz --- */

function Quiz({
  session,
  elapsed,
  topics,
  onAnswer,
  onNext,
  onQuit,
}: {
  session: Session;
  elapsed: number;
  topics: Record<string, string>;
  onAnswer: (position: number) => void;
  onNext: () => void;
  onQuit: () => void;
}) {
  const q = session.pool[session.i];
  const answered = session.answered;

  return (
    <div className="view">
      <div className="quizbar">
        <span className="pill">
          {session.i + 1} / {session.pool.length}
        </span>
        <span className="pill">{topics[q.topic] ?? q.topic}</span>
        <span className="pill">{session.streak} streak</span>
        <span className="pill">{session.score.toLocaleString()} pts</span>
        <span className="pill">{fmtTime(elapsed)}</span>
      </div>
      <div className="meter" style={{ marginBottom: 16 }}>
        <i style={{ width: `${(session.i / session.pool.length) * 100}%` }} />
      </div>

      <div className="card">
        <h2 className="qtext">{q.q}</h2>

        <div className="qopts">
          {session.order.map((original, position) => {
            const isAnswer = original === q.answer;
            const isChosen = answered?.chosen === original;
            const tone = !answered ? '' : isAnswer ? ' opt-right' : isChosen ? ' opt-wrong' : '';
            return (
              <button
                key={original}
                className={`btn btn-secondary btn-block${tone}`}
                disabled={answered !== null}
                onClick={() => onAnswer(position)}
              >
                <b>{LETTERS[position]}</b> {q.choices[original]}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`card feedback ${answered.right ? 'feedback-right' : 'feedback-wrong'}`}>
            <b>
              {answered.right
                ? `✓ Correct${answered.points ? ` +${answered.points}` : ''}`
                : `✗ Incorrect — the answer is ${LETTERS[session.order.indexOf(q.answer)]}`}
            </b>
            {q.explain && <p>{q.explain}</p>}
            {q.src && <div className="q mono srcline">Source: {q.src}</div>}
          </div>
        )}

        <div className="actions" style={{ marginTop: 16 }}>
          <Action label="Quit" onClick={onQuit} />
          {answered && (
            <Action
              label={session.i + 1 >= session.pool.length ? 'Finish' : 'Next'}
              kind="primary"
              onClick={onNext}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- recall --- */

function Recall({
  run,
  topics,
  onShow,
  onGrade,
  onQuit,
}: {
  run: RecallRun;
  topics: Record<string, string>;
  onShow: () => void;
  onGrade: (known: boolean) => void;
  onQuit: () => void;
}) {
  const item = run.pool[run.i];

  return (
    <div className="view">
      <div className="quizbar">
        <span className="pill">
          {run.i + 1} / {run.pool.length}
        </span>
        <span className="pill">{topics[item.topic] ?? item.topic}</span>
        <span className="pill">{run.known} known</span>
      </div>
      <div className="meter" style={{ marginBottom: 16 }}>
        <i style={{ width: `${(run.i / run.pool.length) * 100}%` }} />
      </div>

      <div className="card">
        <h2 className="qtext">{item.q}</h2>
        <Explain>
          Short answer, self-checked. These have no multiple choice — the sources gave an answer but no options, and
          nothing was invented to make some up.
        </Explain>

        {run.shown ? (
          <>
            <div className="card feedback">
              <b>{item.a}</b>
              {item.src && <div className="q mono srcline">Source: {item.src}</div>}
            </div>
            <div className="actions" style={{ marginTop: 16 }}>
              <Action label="I knew it" kind="primary" onClick={() => onGrade(true)} />
              <Action label="I did not" onClick={() => onGrade(false)} />
              <Action label="Quit" onClick={onQuit} />
            </div>
          </>
        ) : (
          <div className="actions" style={{ marginTop: 16 }}>
            <Action label="Show the answer" kind="primary" onClick={onShow} />
            <Action label="Quit" onClick={onQuit} />
          </div>
        )}
      </div>
    </div>
  );
}
