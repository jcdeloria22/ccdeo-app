# DPWH document control

Modular monolith, one developer. NestJS + TypeScript, PostgreSQL, S3-compatible
storage.

> The product is **draining approval debt**, not producing documents. A generator
> without a closing mechanism makes the backlog grow faster. The lifecycle and the
> approval step ship before any generator.

## Open it

From a clean checkout to a working screen:

```bash
cp .env.example .env     # then fill in OPERATOR_NAME and OPERATOR_EMAIL
npm install
bash scripts/pg-local.sh init && bash scripts/pg-local.sh start
npm run migrate
npm run build && npm run build:web
npm run seed:demo
npm start
```

Then open **http://127.0.0.1:3000** — the API serves the built UI, so there is one
address and no second server to start.

Day to day, once that is done:

```bash
bash scripts/pg-local.sh start   # if the machine has restarted
npm start                        # http://127.0.0.1:3000
```

### While changing the frontend

```bash
npm start                # terminal 1 — the API
npm run dev:web          # terminal 2 — Vite on :5173, hot reload
```

Use **:5173** while editing; it proxies API calls to :3000, so the browser still
sees one origin. `npm run build:web` when you are done, and :3000 serves the new
build.

### Demo data

`npm run seed:demo` builds two contracts with five documents sitting at Final for
between 3 and 22 days, then runs the reminder engine over them — enough to fill
every screen. It is **destructive** (it clears documents, transitions, approvals
and reminders) and **refuses to run against anything but a loopback database**,
because the tables it empties are append-only by design and TRUNCATE is exactly
the blunt instrument that must never be pointed at a real register.

Readiness will read **0%** afterwards, with five documents awaiting a signature.
That is the product working, not a bug: Final is not readiness.

### Testing it

```bash
npm test                 # 402 tests, backend and frontend in one run
npm run typecheck && npm run typecheck:web
npm run check:design     # is the vendored design system still in step
```

`npm test` **wipes the demo data** — the specs truncate tables they share, which
is what keeps them from interfering with each other. Run `npm run seed:demo`
again afterwards.

With the server up, one more check goes further than the unit tests can:

```bash
npm run verify:flow
```

It drives the whole register over HTTP — draft a slot template, publish it,
create a contract, presign, PUT the bytes, register, scan, create a document,
finalize, sign, waive a slot — and checks that every refusal along the way comes
back with the right status and the rule that caused it. The unit tests prove each
rule in isolation; this proves they survive routing, the guard, the actor
middleware and the exception filter, which is where a correct repository and a
wrong status code look identical. It builds its own slot template, so it works
against an empty database.

Every refusal in its output is expected. A run where nothing is refused is a
failure.

`npm test` runs both halves in one command. The backend specs need Node and a real
database, the frontend specs need a DOM, and `environmentMatchGlobs` gives
`web/src/**` jsdom — rather than a second config and a second command, where the
second is the one that quietly stops being run.

In production `npm run build:web` once and the API serves the built files, so
there is a single origin and **no CORS to configure** — which matters more here than usual: the bind guard keeps the server
on loopback while auth is off, and a cross-origin setup invites someone to relax
that to make the browser happy.

## Status

| Step | State |
|---|---|
| **DC-01** config + single-operator seam | **done** |
| **DC-02** projects with duplicate guard | **done** |
| **DC-03** deny-by-default guard | **done** |
| **DC-04** append-only audit | **done** |
| **DC-05** versioned slot templates | **done** |
| **DC-06** versioned uploads with scan gate | **done**, real ClamAV running |
| **DC-07** lifecycle state machine | **done** |
| **DC-08** approval as signature event | **done** |
| **DC-09** readiness dashboard | **done** |
| **DC-10** ageing panel and reminder engine | **done**, SLAs confirmed |
| ***then*** the first QCP generator | **done**, every rule verified |

552 tests passing, none skipped — backend and frontend in one run. ClamAV 1.5.4 is
installed and its signature database is loaded, so the real-scanner tests run.

**Consolidating into this project**, decided 15 September 2026: the Document
Builder, the ME and PE Reviewers and the Workflow move here from CCDEO-App, and
this becomes the CCDEO app.

| Step | State |
|---|---|
| 1. Make the register drivable — write routes, and screens for them | **done** |
| 2. Document Builder, including its letters and reference data | **done** |
| 3. ME and PE Reviewers | **done**, progress on the server |
| 4. ME Workflow — flows, testing tables, study path, library | **done** |
| ~~Dashboard~~ | **not built**, and deliberately — see below |

Step one mattered first because every rule the platform enforced was unreachable
from the screen: eleven routes, nine of them reads, and the only thing anyone
could change was marking a reminder read.

Step four brought the ME Workflow across: three process flows over 43 steps, the
minimum-testing tables, the study path through the MTT and PE training tracks, and
the reference library index of 382 files. The content was moved, not retyped, and
is vendored byte-identically with a drift check in both directions.

That raised a problem worth naming. The testing tables are **tier 0** — lecture
and reviewer material — and one of their notes still records the Item 200 soaked
CBR as unresolved between editions, "know both". This project settled it at 30%
from the 2013 Standard Specifications held in the vault. A study screen that
contradicts the project's own verified record is worse than one that says nothing,
and the vendored content is not this project's to edit.

**The Dashboard was dropped, 15 September 2026.** CCDEO-App had a "Standing"
screen because it had nowhere else to put a summary. This platform already
answers both questions that screen asked, from real server data: **Reminders**
is what needs a person, and **Readiness** is where the contracts stand. A third
screen would have restated both with the same numbers, and a dashboard that
agrees with two other screens is maintenance with no reader. Recorded here so the
absence reads as a decision rather than an oversight.

**The tier 1 acceptance limits are countersigned**, 15 September 2026. They were
extracted from the 2013 Standard Specifications held in the vault and are now
signed off by the owner, so they may be cited on an issued document. The two
facts are stored separately — `verifiedBy` still records *how* each row was
checked, `countersignedBy` records *who took responsibility* — because an
extraction is not a countersignature and collapsing them would lose the chain.
Changing a value means doing both again.

So `GET /generators/qcp/rules` serves the verified record and the Testing
requirements tab shows it beside the tier 0 tables, with the citation and the
standing caveat that an extraction is not a countersignature. The settled value is
**served, not copied** — writing it into the frontend beside the stale note would
put one specification value in two places, which is how the two editions came to
disagree in the first place.

Step three moved study progress off `localStorage`, which is right for a file you
double-click and wrong once there is a server: clearing a cache should not erase
months of revision, and the same person at another machine is still the same
person. The scoring rules came across unchanged and are pinned by tests — an XP
total earned under the old rules has to keep meaning what it meant. Progress is
saved when a drill ends, not per answer, and it is the one store here that is
deliberately **not** audited: how someone did on a practice set is nobody's
evidence of anything.

## The screens teach the rules

This is a system whose job is to refuse things, so the screens explain rather than
assume. A contract with no document set says what that means and offers to fix it.
A disabled button says why it is disabled. A refusal is shown in the server's own
words — *"No transition Draft → Signed. The lifecycle is deny-by-default"* teaches
the rule where *"Request failed"* teaches nothing.

The lifecycle is drawn as a track (Draft → In Review → Final → Signed → Archived)
with the document's position marked, and the moves available from there offered as
plain verbs — **Finalize**, **Sign it off**, **Send back** — each with a sentence
saying what it does and who may do it. The transition table is **served** by
`GET /lifecycle` rather than copied into the frontend, so the screen cannot offer
a move the machine would refuse, or hide one it would allow.

Role names are spelled the way people say them. `materials_engineer` is how the
database stores it; the screen says *the Materials Engineer*.

The screens are still worth driving in a browser: both the filter race and the CSS
collision below were found that way, not by a test. Each is now pinned by one.

## The local database

No installer, no service, no elevation, and no password:

```bash
bash scripts/pg-local.sh init     # unpack, initdb, create the database
bash scripts/pg-local.sh start
bash scripts/pg-local.sh status
```

PostgreSQL 17.6 on **127.0.0.1:5433** — port 5433 so it never collides with a
properly installed 5432, and `trust` auth bound to loopback only. Trust is safe
here for the same reason `AUTH_MODE=none` is: nothing outside this machine can
reach it. It also means **no credential exists to store or leak**. Do not copy
that setting anywhere hosted.

```bash
npm run migrate
npm test
```

**The suite runs against its own database.** It truncates `projects`, `documents`,
`approvals`, `uploads`, `reminders`, `app_settings`, the slot templates and
`audit_events` — it has to, because these specs assert exact counts and a hash
chain that has to start somewhere. So `npm test` never touches `DATABASE_URL`:
`test/setup-env.ts` appends `_test` to the database name and redirects every spec
there, and `test/global-setup.ts` creates it on the first run. Nothing to set up.

Until this existed the tests truncated the development database that was also
serving the running app, and a test run quietly destroyed hand-made contracts,
uploaded documents, the Builder's saved signatories and the audit trail.

`TEST_DATABASE_URL` overrides where that database lives. **Its name must end in
`_test`** — `test/test-database.ts` aborts the run otherwise, because a suite that
truncates must not be one typo away from deleting the data it protects. That guard
has its own tests in `test/test-database.spec.ts`.

## Storage and the scan gate

**Storage** is behind the interface R2 will implement: blobs addressed by SHA-256,
callers given a URL to upload to rather than handing bytes to the API, and an
outright refusal to overwrite a key with different content. The development
implementation writes to a local directory — `presignPut` deliberately returns a
`file+put://` URL, not an http one, so nothing can mistake it for a real
pre-signed endpoint or quietly depend on one.

Moving to R2 is one file: `src/storage/filesystem.storage.ts`.

**The gate fails closed.** An upload is `Quarantined` until a scanner returns an
explicit *clean* verdict. Infected, an error, a timeout and "no scanner
installed" all leave it quarantined, and a quarantined upload cannot fill a slot.
That last rule is enforced by a database trigger, not only in code — a gate that
depends on every caller remembering it is not a gate.

Defaulting to "probably fine" when no scanner is present is the failure mode
worth designing against: that is the state a machine is in straight after a fresh
checkout, and exactly when someone is most likely to push a real document through.

Real ClamAV is driven through `clamscan` and tested with **EICAR**, the standard
harmless test file every scanner must detect — so the scanner is genuinely
exercised without malware going near the machine.

### Setting the scanner up

A fresh ClamAV install has the binary and **no signatures**, and clamscan's
default database directory lives under Program Files, which needs administrator
rights to write to. So the path is configurable:

```bash
freshclam --config-file=<your conf>   # writes somewhere you own
```

Then point `CLAMAV_DB_PATH` at that directory. A scanner with no signatures
reports `available() === false` rather than claiming it can deliver a verdict —
"no signatures yet" and "the scanner is broken" need different responses, and
neither is a pass. clamscan exits 2 in that state, which the gate reads as an
error, which keeps the slot shut.

### When the host antivirus gets there first

On Windows, Defender quarantines the EICAR file the instant it is written, so
ClamAV never opens it and clamscan exits 2 with **Windows error 225,
`ERROR_VIRUS_INFECTED`**. That is a detection, not a malfunction, and it is
reported as `infected` with a detail naming which scanner reached the verdict.

Both verdicts shut the gate. Only one of them tells the operator what happened —
and the test asserts the detail, because crediting ClamAV for a detection
Defender made would be a test that lies about what it proved.

## The lifecycle (DC-07 / DC-08)

The machine is a **table**, not a set of handlers: `src/lifecycle/states.ts` lists
every legal transition with the capability it needs, the roles allowed, whether a
reason is required, and whether it freezes content. Anything not in the table
cannot happen — deny-by-default, the same shape as the HTTP guard. Terminal states
appear only as destinations, so nothing leaves them.

Three rules are enforced twice, in code and again in the database, because a rule
that lives only in the caller is a convention:

- **Approval is impossible from any state but Final.** A trigger on `approvals`
  checks the document's state, so the guarantee holds against any writer. The
  approval row is written *before* the state moves to Signed, which is what makes
  the trigger assert the state approval required rather than the state it produced.
- **Content frozen into Final must have passed the scan gate.** DC-06 stops a
  non-clean upload filling a slot; freezing the same bytes into a Final document
  would get them past it by another route, so both the repository and a trigger
  check for an explicit `Clean` verdict.
- **Transitions are append-only**, like the audit trail.

`state_since` resets on every transition, so age is per state and never
age-since-creation. Approval binds to the content hash it approved, so
`approvalCoversCurrentContent()` goes false the moment the content differs — and
superseding an approved document creates a **new Draft** rather than editing the
approved row, in one transaction so a half-applied supersede cannot leave an
orphan draft in the register.

## Readiness (DC-09)

**Signed counts. Final does not.** `src/readiness/readiness.ts` is a pure function
and the arithmetic is deliberately one-directional: 199 of 200 slots is 99%, never
100, because a dashboard that rounds its way to "ready" is worse than no dashboard.
A project with no required set reports `null`, not 100% — an empty set is unknown,
not complete.

Approval debt is listed separately and in full: the useful question is never how
many, it is which ones and how long they have been waiting.

## Ageing and reminders (DC-10)

A clock belongs to a **state**, not a document, and only where something is still
owed — Draft, In Review and Final have clocks; Signed and the terminal states do
not. The panel query takes that list from the SLA table rather than naming states
itself, so the two cannot drift.

Everything is a pure function of an injected `now`, so a threshold is something a
test states outright. The reminder record's unique key *is* the deduplication
rule, enforced by the database, which is what makes the engine safe to run on a
schedule: running it twice over the same state of the world says nothing twice.
The key includes `state_since`, so a document that goes back to Draft and returns
to Final gets a fresh clock and a fresh reminder.

**Delivery is an in-app inbox**, decided 15 September 2026 — not email. Nothing
sends mail: there is no mail configuration here and inventing one would mean
handling credentials. The row written to `reminders` *is* the delivery, and
`InboxRepository` reads it, so a reminder can never be "sent" and also missing.

`ReminderSink` stays as a seam anyway. If mail or a chat webhook is ever wanted
it is one class, and the inbox keeps working alongside it rather than being
replaced by it.

## The reminders space

Its own routes rather than a corner of the readiness dashboard, because the two
answer different questions. Readiness asks *is this project ready to submit*; the
inbox asks *what needs me*. Folding the second into the first is how a backlog
becomes invisible, which is the failure this whole product is aimed at.

| Route | What it is for |
|---|---|
| `GET /reminders` | the list — unread first, most severe first, then oldest |
| `GET /reminders/counts` | the number on the tab, split by severity |
| `GET /reminders/ageing` | the panel behind the inbox |
| `POST /reminders/:id/acknowledge` | mark one read |
| `POST /reminders/acknowledge-all` | clear the tab |
| `GET /projects`, `GET /projects/:id` | the register, with readiness per contract |
| `GET /readiness`, `GET /readiness/debt` | the portfolio, and what waits on a signature |
| `GET /audit`, `GET /audit/verify` | the trail, and whether the chain still holds |
| `POST /slot-templates`, `…/:id/publish` | define and publish a required-document set |
| `POST /projects`, `…/:id/slots`, `…/waive` | create a contract, give it slots, waive one |
| `POST …/uploads/presign`, `…/register`, `…/scan` | the three-step upload |
| `POST /documents`, `…/:id/transition`, `…/supersede` | the lifecycle |
| `POST /reminders/run` | run the ageing engine now |
| `GET /quiz/:record`, `PUT`, `DELETE` | a study record — read, save, reset |
| `GET /generators/qcp/rules` | the verified testing rules, read-only |
| `PUT /dev-storage/…` | the development blob store, and nothing else |

**Uploads never pass through the API.** The settled decision is browser →
pre-signed PUT → bucket, so there is no route that accepts a file. The browser
asks for a URL, PUTs to it, and tells the API what arrived; the API reads the
object back and re-hashes it rather than trusting the claim. Locally the "bucket"
is `DevStorageController`, which answers 404 unless storage is the filesystem
implementation — so the browser follows the same flow in development as in
production, and the seam is exercised here rather than first tried there.

**One route moves a document, whatever the move is.** A route per verb would put
the transition table in the URL space as well as in `states.ts`, and the two would
drift; a test asserts no route names a lifecycle state.

**Domain errors carry their own status.** `DomainExceptionFilter` maps each one —
a role refusal is 403, a duplicate contract 409, a missing reason 400, an
unverified rule 422 — so a refusal reads as a rule rather than as a broken server.
An error it does not recognise is logged in full and answered generically, because
an unmapped error may carry a connection string. `test/http-errors.spec.ts` checks
every name in that map against the class that actually throws it, since the
mapping is by name and a rename would otherwise turn a 403 back into a 500.

Approval debt is its own route rather than a field on the portfolio: two numbers
that must never be added together should not arrive as one object that invites
someone to add them.

Shared providers live in `src/core/core.module.ts` — one pool, one place that
decides how a repository is built. The repositories stay plain classes taking a
`Pool` rather than decorated services, because every test constructs them
directly with a test pool, and keeping them free of the framework is what makes
that possible.

`test/routes.spec.ts` reads the same metadata the guard reads and fails if any
handler on any controller declares no capability — or declares one that no role
will ever hold, which would be a route nobody could call and would look exactly
like a deliberate lockout.

**Read state is per person.** With one operator that is a distinction without a
difference; the moment a second person has an account it stops being one, and the
other design would let one person's click silently clear everyone else's inbox.

It is also a separate append-only table rather than a column, because `reminders`
is append-only: marking something read is a *new fact about an old event*, not an
edit to it. The cost is a join. The gain is that "who saw this, and when" survives
instead of collapsing into a boolean.

Acknowledging is idempotent through a unique key rather than a read-then-write, so
two clicks that race produce one row and no error — and the call reports whether
*it* was the one that recorded the fact.

These are the **first routes in the build**, so they also bring the request-side
half of the operator seam. `ActorMiddleware` puts the actor on every request —
`PolicyGuard` refuses anything without one — and the guard is registered as an
`APP_GUARD` so it covers every controller added after it, not only this one. A
feature module must not be able to ship unprotected by forgetting a line.

A test reads the same metadata the guard reads and fails if any handler declares
no capability, so deny-by-default is checked rather than trusted.

## The shell

Four tabs, in the order of the day:

| Tab | Question it answers |
|---|---|
| **Reminders** *(home)* | what needs you |
| Readiness | where each contract stands |
| Register | contracts, slots and documents |
| Audit | the record, and whether it holds |

**Reminders is the home tab**, and that is a claim about the product rather than a
default. This exists to drain approval debt, so the first thing on screen is what
needs a person — not a completion percentage, which is the number that feels like
progress while nothing moves.

Routing is the URL hash and a switch. A router library would add a dependency and
a concept for four tabs with no nested routes and one id (`#/register/<id>`); the
hash survives a reload and can be sent to someone, which was all that was needed.

The unread badge is fetched by the shell, not passed up from the Reminders view —
the point of a count on a nav item is that it is right while you are looking
somewhere else.

### The copy, and how it is kept honest

`web/src/tokens.css` and the Builder's libraries are **byte-identical copies**
from CCDEO-App. The copies are deliberate: this project deploys on its own, so a
build reaching into a sibling directory would work on one machine and nowhere
else. What had to be prevented is not the copy — it is the copy going stale
without anyone noticing.

```bash
npm run sync:vendored    # re-copy from CCDEO-App, refresh the record
npm run check:vendored   # report drift, change nothing
```

Sixteen files are vendored, not one: the design system, the Builder's libraries,
and the browser libraries they need. `web/src/vendored.json` records each source
path, its SHA-256 and the date. `test/vendored.spec.ts` checks drift in **both**
directions:

- the vendored file against its recorded hash — catches someone editing the copy
  in place. Runs everywhere, including where the source is absent.
- the recorded hash against the live source — catches the system moving on
  without this project. Only possible where the two sit side by side, and it says
  out loud when it skips, because a quiet skip would be the worst of both.

Both directions were verified by deliberately introducing drift and watching them
fail.

### The mount point has to carry the height chain

The design system's layout is a fixed-height column: `body` is 100% tall with
`overflow: hidden`, `.shell` takes what remains, and `.viewwrap` is the one
element that scrolls. That works when `.shell` is a direct child of `body`, which
is how the standalone app is built.

React mounts into `#root`, which sits in between. Unstyled it is a plain block
with `flex: 0 1 auto` — it never shrinks, so `.shell`'s `flex: 1` had nothing to
resolve against and grew to its content. At 1071px inside a 628px viewport
`.viewwrap` never became scrollable and `body` clipped the rest: **everything
below the fold was unreachable, with no scrollbar anywhere.**

`#root` now passes the chain through, and `scrollbar-gutter: stable` keeps the
content from jumping sideways as you move between tabs that do and do not
overflow.

### Use the design system, do not re-author it

The first version of the shell declared its own `.shell` and `.rail`. `tokens.css`
**already defines both**, along with `.rail-brand`, `.rail-scroll`, `.rail-f`,
`.grp-h`, `.navbtn`, `main`, `.viewwrap`, `.view` and `.badge` — it is an app
shell, not just tokens. The two sets of rules fought, and the result was a rail
overlapping the content by 18px and a view shrink-wrapped to 721px inside a
1033px column, because `main` is a flex container in the system and `margin: 0
auto` on a flex item means fit-content rather than fill.

Nothing in `web/src/app.css` now declares a competing base rule for a name the
system owns. Everything there is a new name, a compound modifier
(`.vhead h1 .badge`), or a media-query override — and that last one is legitimate
layering, which is why the test that enforces this strips `@media` blocks before
looking. The system has no narrow-screen treatment; adding one on top is the
point of the cascade. Declaring a second base rule is what broke it.

### The tab itself

`web/` — React 19 + TypeScript on Vite, which is what the settled decisions fix.
It is the first screen in the build, so it also establishes the frontend
conventions:

- **The design system is not re-authored.** `web/src/tokens.css` is the CCDEO
  v0.6 system, copied unchanged. `web/src/app.css` holds only what this screen
  adds, so the two can be told apart and the system stays the single source.
- **Severity is a word, not only a colour.** `OVERDUE` / `WARNING` are printed.
  Colour alone fails anyone who cannot separate those two hues, and this is the
  column that decides what gets attention first.
- **Every state is drawn** — loading, failed, empty, nothing-unread, and the
  list. A screen that renders blank on a failed request looks exactly like
  "nothing needs you", which is the one thing an inbox must never say by
  accident. `api.ts` throws on a non-2xx rather than returning `[]` for the same
  reason.
- **The filter is read at call time, not closed over.** Marking one read
  refreshes the list and so does switching filter; a handler holding the
  `refresh` from an earlier render re-fetched the *old* filter and wrote it over
  the new view. A sequence number covers the remaining case, where responses
  arrive out of order.
- **Theme follows the operating system.** A preference control would sit in the
  rail competing with the four things the rail exists to show.
- **Helvetica, named on purpose.** The system asks for Archivo with a Helvetica
  fallback; Archivo is not installed and this app must work offline, so a webfont
  is not an option and the fallback is what everyone was seeing anyway. It is
  overridden in `app.css` rather than edited into `tokens.css`, so the system
  stays a copy of one source and the divergence stays visible.
- **Two columns of figures on a phone, not four rows.** At one column the summary
  filled the entire first screen and pushed every reminder below the fold, which
  inverts what the page is for.

## The Document Builder

Reads a BAC abstract of bids and writes the paperwork that follows — the
resolution, the notice of post-qualification, and the four invitation-to-bid
witness letters — from the office's own .docx templates.

Three panes, because they are used on different occasions: **Build documents**,
**Witness letters**, and **Setup**.

**The libraries are vendored, not rewritten.** `rules.js` and the rest are
byte-identical copies of the build proven to reproduce 43 real resolutions
exactly. Copying keeps that proof meaningful; a rewrite would throw it away. They
are plain scripts that attach to `window`, so they are loaded as scripts — two of
the seven export nothing at all and cannot be imported as modules.

**Nothing loads until the tab is opened.** The main bundle is ~270 KB. The
Builder's libraries and templates are ~4 MB, fetched on opening the tab; text
recognition is another ~15 MB, fetched only when a scanned PDF actually has no
text layer. Served over http the recognition worker is an ordinary script, so
none of the Blob-worker machinery the offline build needed applies here.

### What it built can be filed

Each document offers **Download** and **File it…**. Filing uploads it into a
contract's slot, scans it, and records it as a Draft — after which it finalizes
and signs in the Register like anything else. That is the join the two halves
never had: a document produced in one place and closed out in the other.

### A bug inherited and fixed

`buildProse` and `buildPacc` read a `cfg.sched` — the bid-evaluation and
post-qualification spans, and the PACC table's row. **The standalone Builder never
built it**, so every witness letter it attempted failed on an undefined property.

The rule was never missing: `rules.deriveSchedule()` computes exactly that shape
from the opening date, counting working days around the holidays on file, and
carries the rule itself — *bid evaluation is two working days, post-qualification
the next three*. It was simply never called. It is now, and all four letters
build. The schedule is **not** computed in the screen: that is a procurement rule
and it belongs in the library.

### Signatories and holidays live on the server

Not in one browser. A signatory's name is what appears on an issued resolution,
and a proclaimed non-working day changes the working-day count that every
calculated date depends on. Kept in `localStorage` they would be lost to a cleared
cache — after the paper had gone out — and invisible to anyone else.

`app_settings` holds them, every change is audited, and an unknown key is refused
rather than stored where nothing reads it.

## The first generator

`generateQcp(input, rulesVersion)` is pure: no database, no filesystem, **no
clock** — the preparation date is an input, because a generator that reads the
clock would have a golden file that changes every day for no reason. A golden file
pins the output for a known project.

The rule that shapes everything else is from `me-spec-sources`:

> An unverified rule may not be used by a generator. Enforce this in code, not by
> convention.

So every rule row in `src/generators/qcp/rules.ts` carries `source_document`,
`source_section`, `source_year`, `verified_by` and `verified_on`, and
`requireVerified()` throws rather than returning a flag — a value cannot reach an
artifact by someone forgetting to check.

A rule carries **two** provenances, because it answers two questions from two
documents. *How often* comes from the Minimum Testing Requirements Vol II (tier 2),
transcribed from the owner's verification record. *What it must meet* comes from
the **DPWH Standard Specifications Volume II, 2013 edition** (tier 1), read
directly from the copy in the vault — the edition DO 197 s.2016 refers to, which
supersedes the 2004 copy the record was based on.

That is what settled Item 200's minimum soaked CBR. The record left it open (25%
in the 2004 edition against 30% in later material); §200.2 of the 2013 edition
reads *"The material shall have a soaked CBR value of not less than 30% as
determined by AASHTO T 193."* The later edition did raise it.

Nothing was inferred, rounded, or remembered. Where
the generator has no rule it prints the item with no tests and warns; where the
units do not match it shows the frequency as written and computes nothing rather
than guessing a conversion; where a rule is unverified it prints
`WITHHELD — pending verification` and keeps the row **visible**, because a silent
omission from a QCP is worse than an obvious gap.

Sample counts always round **up**: rounding down anywhere here under-tests real
work.

## Provisional data, marked as such

One thing is still a placeholder and says so in code, because inventing it would
be worse than leaving it obviously unfinished:

- **The slot list** in `src/slots/provisional-template.ts`. Every template built
  from it is flagged `provisional: true` with a `source_note` saying it is not
  sourced. `me-spec-sources` puts required-document sets at tier 3 (the QC/QA
  manual and standard forms) and forbids carrying forward a list whose provenance
  cannot be named.

Correcting the slot list is a **new template version**, which is exactly what
DC-05 makes cheap: projects already created keep the version they were created
under, so no readiness figure computed in the past silently changes.

## The bind guard

`AUTH_MODE=none` means every request is the single seeded operator — no password,
no session, no check. Safe for one person on their own machine, catastrophic
anywhere else. So:

**The server refuses to start if `BIND_HOST` is anything but `127.0.0.1` while
authentication is off.**

Read strictly — only the literal `127.0.0.1` passes. Not `0.0.0.0`, not `::1`, not
`localhost` (a name is not an address; what it resolves to is not ours to trust).

### This blocks hosting, on purpose

Railway — and any container platform — requires binding `0.0.0.0` and hands you a
public URL. A correct build **will refuse to boot there while auth is off**. That
is the guard working.

So hosting is gated behind authentication, not the other way round. Do not relax
the guard to deploy sooner; bring authentication forward instead.

`src/config/bind-guard.ts` is pure and synchronous so it can run before anything
binds a socket, and `test/bind-guard.spec.ts` spawns the real process to prove a
misconfigured one exits non-zero and never prints `listening on`.

## What DC-01 actually contains

- **`src/config/env.ts`** — the only place `process.env` is read. Validation
  reports *every* problem at once: the conditional operator checks deliberately
  avoid zod's `superRefine`, because a refinement only runs once the whole object
  parses, so one bad `PORT` would hide a missing `OPERATOR_NAME`.
- **`src/config/bind-guard.ts`** — the guard, and the reason it is strict.
- **`src/policy/roles.ts`** — the five-role matrix as data. Every pair resolves
  *permitted* while `AUTH_MODE=none`; `INTENDED` records what each becomes when
  roles are switched on, so that change is seed data rather than a rewrite.
- **`src/operator/operator.ts`** — the seam. Callers ask for the actor instead of
  assuming one, and an `Actor` carries **the role the act was performed under**,
  not just who did it, so audit rows stay truthful once roles are real.

## Settled since the first build

**Role names**, confirmed 15 September 2026: `admin`, `materials_engineer`,
`approver`, `project_engineer`, `viewer`. The decisions fixed the matrix shape and
two rules but never the names. This one mattered before any data existed:
`audit_events.actor_role` is append-only and hash-chained, so a role name written
into it cannot be renamed later without breaking the chain.

**SLA day counts and their basis**, confirmed 15 September 2026 — Draft 14/30,
In Review 5/10, Final 3/7, all **calendar** days. Not spec values and outside what
`me-spec-sources` reaches; they are operational targets and the owner is the
authority on them. The trade in calendar days is known and accepted: a document
finalized on a Friday is two days older by Monday without anyone having failed to
act. `basis` is recorded per row, so moving one state to working days later is a
data change.

## Open questions

**`In Review`.** This project's decisions list it, so it is implemented. The
sibling `ccdeo-platform` skill drops the same state because "with one operator it
records nothing true" — which applies here too while `AUTH_MODE=none`.

**Countersigning the tier-1 acceptance limits.** The limits for Items 200, 201
and 202 were read directly out of the 2013 Standard Specifications held in the
vault, and each row records `verifiedBy: 'extracted-from-source-pdf'` rather than
a person — an extraction is not a countersignature, and `me-spec-sources` is
explicit that an assistant is not authority. Confirm them before a generated QCP
is issued officially.

**Items 310 and 311 have frequencies but no acceptance limits.** Those sections
have not been read from the source yet, so the column is empty. An absent limit is
left absent rather than filled with something plausible.
