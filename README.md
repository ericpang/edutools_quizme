# QuizMe

A live, Kahoot!-style classroom quiz that rewards **thinking about your own thinking** instead of tapping speed. Play solo, or in randomly formed groups that decide together.

> **Status:** playable and tested: solo and group games, confidence bidding, Safety Net, side-bets, the quiz builder, the calibration report, sounds and colour themes. It has been played end to end against the Firebase emulators (see [Testing](#testing)), but not yet in a real classroom, so the scoring numbers are untuned. Publish the database rules before the first real game ([Getting started](#getting-started)). QuizMe is an independent project and is not affiliated with Kahoot!.

The host (teacher) runs the game on a shared screen, players join from their phones with a 6-character code or QR code, and everyone answers multiple-choice questions in real time. QuizMe is aimed at older students (teens and adults): instead of paying out for the fastest click, it rewards **calibrated confidence** — deciding how much to risk *before* seeing the options — and keeps every player in the game until the last question.

**Stack:** plain HTML, CSS and JavaScript (ES modules, no framework, no build step) on GitHub Pages, with Firebase Realtime Database + Anonymous Auth. Like the other edutools apps (`edutools_pinboard`, `edutools_cuteworld`, …) it shares the Firebase project `edutools-7c110` and its single database.

## How it differs from Kahoot!

| Problem in speed-based quiz games | QuizMe's twist | How it works |
|---|---|---|
| **Speed bias** — points depend on how fast you click | **Confidence Bidding** | Before the options are revealed, players see only the question's *category* and *difficulty* and wager a portion of their points. Points depend on accuracy and the wager, never on response time. |
| **Snowball effect** — early leaders stay ahead, trailing players check out | **Safety Net** | Players who drop into the bottom 30% of the leaderboard unlock a one-time **Double Down** or **Shield** token, so they stay strategically engaged until the final question. |
| **Passive waiting** — early finishers stare at a frozen screen | **Active Side-Bets** | After locking in an answer, a player sees live, anonymous class stats ("45% of the class has picked B so far") and can place a secondary micro-bet on whether the class majority will be right or wrong. |
| **Lone play** — everyone taps alone | **Group mode** | Students are shuffled into random, balanced groups. A group is one scorer: members debate, vote, and answer, wager and bet together. |

Kept from the Kahoot! formula: join by code + name, host-paced rounds on a shared screen, colourful answer buttons, leaderboard and podium.

## Game flow

Each question is one round:

`lobby` → `bid` → `answer` → `reveal` → `standings` → next `bid` … → `final`

| Phase | Host screen (projector) | Player screen (phone) |
|---|---|---|
| `lobby` | Code, QR code, joined names. Group mode: **Shuffle groups** and the groups | Name entry, "waiting for host". Group mode: your group and teammates |
| `bid` | Category + difficulty, "n/N have bid" | Wager slider (0–100% of score); arm a Safety Net token if owned. **Question text and options stay hidden.** |
| `answer` | Question + options, "n/N answered" | Option buttons. After locking in: live class stats and the side-bet (most will be right, most will be wrong, or no bet) |
| `reveal` | Correct option, class accuracy, side-bet verdict | Personal result: right or wrong, wager, points won or lost |
| `standings` | Top 5 only | Own rank; "Safety Net unlocked" prompt when earned |
| `final` | Podium | Final rank and score, and a calibration report: how well the wagers matched the results |

In group mode every count (n/N, ranks, stats) is of *groups*, and phones also show teammates' votes with a **Ready** button in `bid`, `answer` and the side-bet step.

Timers only pace the game and never affect points: 10 s to bid and 20 s to answer by default, 20 s and 40 s in group mode so teams can talk (a question's `timeLimitSec` overrides the answer time). The host can advance early with a button. `bid` ends when every connected player (or group) has locked in. `answer` ends when every connected player has answered *and* settled their side-bet (a bet or "no bet"), or 6 s (12 s in group mode) after the last answer, whichever comes first, so the last player to answer can still bet. After a deadline the host waits 1.2 s for writes that raced it.

When the question appears, the host's screen plays a short, cute fanfare, and a bouncy tune then loops for as long as the answer clock runs (a different key each question, faster in the last 5 s; see [Sound and themes](#sound-and-themes)).

## Rules and scoring

In **group mode** everything below applies to a *group* as if it were one player — see [Group mode](#group-mode).

### Confidence Bidding

- In `bid`, a player picks a wager `pct` (0 to `MAX_WAGER_PCT`) — a *portion* of their current score. No bid means 0%.
- The question text and options are revealed only after bids lock.
- An unanswered question counts as wrong, so skipping can't dodge a loss.

```text
wager = floor(score × pct / 100)
right → gain = (BASE_POINTS + wager) × DIFFICULTY_MULT[difficulty]    // Double Down: gain × 2
wrong → loss = wager                                                   // Shield: loss = 0
score = max(0, score + gain − loss + sideBetResult)
```

*Example:* score 800, medium question, 50% wager → wager 400. Right: (100 + 400) × 1.5 = **+750**. Wrong: **−400**. With Double Down a right answer pays +1500; with Shield a wrong answer costs 0.

Harder questions pay more per wagered point, so extra wager only pays off when your confidence beats a break-even level: 50% (easy), 40% (medium), 33% (hard) with the defaults. Betting accordingly *is* the calibration skill the game trains.

### Safety Net

- After each question's standings (except the last), rank the players who are online by score ↓, then correct answers ↓, then join order ↑. The last `max(1, floor(0.30 × N))` of them (N = players online; at least two) get **one** token, if they do not hold one yet.
- A token is spent by arming it in a later `bid` phase; the player then picks its effect for that question:
  - **Double Down** — the gain on a right answer is doubled; no extra penalty if wrong.
  - **Shield** — a wrong answer costs nothing (the wager is refunded).
- One token per player per game; unused tokens expire when the game ends. Tokens affect the main wager only, not the side-bet.
- Ranks are private: the projector shows the top 5 and each student sees only their own rank, so trailing players aren't publicly ranked last. The database enforces it: a player can read only their own `score` node.

### Active Side-Bets

- After a player locks in an answer, their screen shows anonymous live stats for the current question: the share of answers per option and `answered / total`. Stats never reveal which option is correct, and appear only once `STATS_MIN_ANSWERS` answers are in so individuals can't be picked out.
- Until `answer` ends, the player may place one micro-bet (or pass): the class majority will be **RIGHT** or **WRONG**. Stake is `min(SIDE_BET_STAKE, score)` at even odds.
- At `reveal`, the majority is "right" if more than 50% of submitted answers are correct. Exactly 50% is a push (stake returned).
- Stats are visible only to players who have already answered, so they can't be used to copy the crowd.

### Tunable defaults (exported from `js/scoring.js`)

| Constant | Default | Meaning |
|---|---|---|
| `START_POINTS` | 1000 | Starting score |
| `BASE_POINTS` | 100 | Flat reward added to the wager on a right answer |
| `DIFFICULTY_MULT` | easy 1 · medium 1.5 · hard 2 | Multiplier on the gain from a right answer |
| `MAX_WAGER_PCT` | 100 | Largest allowed wager (host can lower it per game) |
| `SIDE_BET_STAKE` | 50 | Flat stake of a side-bet |
| `SAFETY_NET_SHARE` | 0.30 | Bottom share of the ranking that unlocks a token |
| `STATS_MIN_ANSWERS` | 3 | Answers needed before live stats are shown |
| `BID_SECONDS` / `ANSWER_SECONDS` | 10 / 20 (group: 20 / 40) | Pacing only; never affects points |
| `GROUP_SIZE` | 4 (2–6) | Target members per group |

These numbers are untested starting points — tune them in playtests.

## Group mode

Choose **Group** when creating a game and pick a group size. Students are randomly shuffled into balanced groups, and each group plays as one scorer: one shared score, one Safety Net token, one wager, one answer. Members talk (in person) and settle on a shared choice using their phones.

### Forming random groups

- In the lobby the host presses **Shuffle groups**. `formGroups()` (`js/grouping.js`, copied from `edutools_cuteworld`) shuffles everyone and deals them out round-robin into `max(2, ceil(players / size))` groups, so sizes never differ by more than one. The result is written to `group/<uid>` as `g1`, `g2`, …
- Shuffle as often as you like until **Start**; after that the groups are fixed. Group mode needs at least 4 players (two groups of two).
- Each phone shows its group (`Group 3`, its colour and its teammates' names); the projector lists every group with its members.
- Latecomers join the smallest group (`smallestGroup()`). Someone who leaves stays in their group, which carries on with whoever is online.

### Deciding together

- In `bid`, `answer` and the side-bet step, each member casts a **vote** and sees their teammates' votes live (names and picks, visible only inside the group). Votes can be changed until the group is done.
- **Ready** means "I'm happy with this"; changing your vote clears your Ready. A group is done when **more than half of its online members are Ready**, or at the deadline.
- The host then resolves the votes with a pure function (`js/decide.js`) and writes the group's `bid`, `ans` and `side` — the same nodes a solo player writes, keyed by group id — so scoring never needs to know which mode is running.

| Decision | Each member votes | The group's choice |
|---|---|---|
| Wager | a percentage | the lower median of the votes (no votes: 0%) |
| Answer | an option | the most votes; a tie goes to the captain's vote, else the lowest option (no votes: unanswered) |
| Safety Net token | Double Down, Shield or none | used if more than half of the voters pick the same effect |
| Side-bet | right or wrong | the most votes; a tie means no bet |

The **captain** rotates every question (members in join order; `captain = members[(n − 1) mod group size]` for the 1-based question number `n`). They break ties and speak for the group on the projector, so everyone takes a turn at being accountable.

### Scoring in groups

- The leaderboard, podium and Safety Net rank *groups*: the bottom `max(1, floor(0.30 × G))` of the G groups online unlock their group's token.
- Live stats and side-bets count groups ("45% of groups have picked B so far"), and the class "majority" is more than half of the *groups* that answered.
- Disagreement inside a group is a natural calibration signal: when teammates split, a smaller wager is the sensible bet.

## Architecture

**The host's page is the coordinator; there is no server.** This is the same model as the other edutools apps. The host's browser holds the answer key, advances the phases, aggregates live stats, resolves group votes and writes scores. Players are untrusted: database rules let them write only their own profile, votes, bids, answers and side-bets, once and in the right phase. This runs entirely on the free Spark plan.

- The host is the room's creator: their anonymous uid is stored in `meta/owner`. Refreshing keeps the room (its code is kept in localStorage, e.g. `qm.admin.room`); clearing browser data loses control of a live room.
- The host page must stay open during a game. All state lives in the database, so a refresh resumes it: the host controller is a *reconciler* that derives its next action from `cur` and its stored deadline, never from in-memory variables.
- `js/firebase.js` is the only file that names the SDK URL and version (currently 12.19.0); everything else imports from it. `js/room.js` is the only file that reads or writes the database.

### Data model (Realtime Database)

Everything lives under one top-level node, so QuizMe never touches the other apps' data:

```text
quizzes/<code>/                  6 characters from an alphabet without I, L, O, 0, 1
  meta                           owner, title, mode (solo | group), groupSize, maxWager, open, createdAt
  cur                            phase, n, total; qid, category, difficulty, deadline while a question is on;
                                 text and options from phase answer on (never the key)
  quiz/<qid>                     q1, q2, …: category, difficulty, text, options[], correct, timeLimitSec?, explanation?   owner only
  players/<uid>                  name, on, ts                                         player writes own
  banned/<uid>                   true                                                 owner writes; a removed player stays out
  group/<uid>                    'g1', 'g2', …                                        group mode; owner writes
  vote/<qid>/<subject>/<uid>     group mode; each member writes own, one node per step:
    bid {pct, tok?, ok?}   ans {v, ok?}   side {v?, ok?}                              ok = Ready
  bid/<qid>/<subject>            pct, token?, ts           solo: the player once; group: the host, resolved from the votes
  ans/<qid>/<subject>            v, ts
  side/<qid>/<subject>           v ('right' | 'wrong' | 'none'), ts
  stats/<qid>                    answered, total, counts[]                            owner writes, once enough answers are in
  score/<subject>                pts, ok, rank, of                                    owner writes; the subject reads
  perk/<subject>                 unlocked, used                                       owner writes; the subject reads
  out/<qid>/<subject>            pick, ok, pct, wager, main, side, pts, token?, bet?  owner writes; the subject reads
  res/<qid>                      correct, counts, answered, total, accuracy, majority, category, difficulty, explanation?
                                                                                      owner writes once, at reveal
```

A **subject** is a player's uid in solo mode and a group id in group mode. Group ids (`g1`, `g2`, …) can never collide with a Firebase uid.

### Security rules

| Data | Who reads | Who writes |
|---|---|---|
| `meta`, `cur`, `group`, `res` | anyone signed in | the owner (`meta/owner` is set once, to the creator's uid); `res/<qid>` only once per question |
| `quiz` | the owner only | the owner |
| `players/<uid>` | anyone signed in | that user; new players only while `meta/open` is true and they are not in `banned` |
| `vote/<qid>/<subject>/<uid>/<step>` | members of that group + owner | that member, own entry, in the step's phase, until the host settles the step |
| `bid`, `ans`, `side` | that subject (own uid, or a group member) + owner | solo: that user, once. Group: the owner only, resolved from the votes |
| `stats/<qid>` | the owner + subjects that already have an `ans` for `<qid>` | the owner |
| `score`, `perk`, `out` | that subject + owner (so ranks stay private) | the owner |

Player writes are accepted only for the current `qid`, in the matching `cur/phase`, once, and before `cur/deadline` plus 2 s of grace (using the rules' `now`). A bid `token` needs an unspent `perk`. The answer key lives only in `quiz/` and is copied to `res/<qid>` at `reveal`, so players can never read it early and can never write a score. The host writes a whole step (scores, outcomes, the result and the new phase) in one atomic update. Rules can't recompute scores or check that the host resolved votes honestly, so the host's page is trusted, as in the other apps.

> **One rules file for every edutools app.** QuizMe's `quizzes` block goes into the shared [database.rules.json](database.rules.json) beside `sessions`, `boards`, `polls`, `mindmaps`, `worlds` and `whiteboards`. Deploying the file replaces the whole project's rules, so compare it with the live rules first and copy the updated file back to the sibling repos.

### Timing, joining, reconnecting

- **Timers:** deadlines are stored in server time. Clients show `deadline − (Date.now() + serverTimeOffset)` using `.info/serverTimeOffset`, so countdowns agree across devices.
- **Presence:** `players/<uid>/on` follows the connection, so a phone that drops and returns is online again without rejoining.
- **Joining:** the host creates a game and gets a 6-character code (`js/codes.js`, copied from `edutools_cuteworld`) and a QR code for `student.html?room=<code>`. A player enters a name, signs in anonymously (`signIn()` in `js/firebase.js`) and creates `players/<uid>`. Solo mode closes joining after `lobby`; in group mode latecomers go to the smallest group.
- **Reconnecting:** the same browser keeps the same anonymous uid, so a refresh restores the player. Two tabs of one browser are the same student; a new device is a new player.
- **Privacy:** no student accounts and no personal data — names only. **End session** deletes the room's data; abandoned rooms are not cleaned up automatically.

### Known constraints (checked against firebase.google.com on 2026-11-06)

- The Spark plan allows **100 simultaneous Realtime Database connections** per database, shared by every edutools app. Every open tab counts, host included — fine for one class, not for several at once. Blaze raises the limit to 200,000.
- Firebase Auth allows **100 new accounts per hour per IP address**, and anonymous players count. A whole school behind one network can hit it; schedule a temporary increase in the Firebase console before big events.

## Quiz format

There are no host accounts (everyone signs in anonymously), so there is no cloud quiz library. A host builds a quiz in the builder; drafts survive a refresh in localStorage, and the quiz is copied to `quiz/<qid>` when the game starts. Import and export JSON to reuse or share quizzes. `category` and `difficulty` are required on every question because bidding depends on them. v1 supports single-answer multiple choice with 2–4 options.

```json
{
  "title": "Unit 3 Review",
  "questions": [
    {
      "category": "Cell Biology",
      "difficulty": "hard",
      "text": "Which organelle produces most of a cell's ATP?",
      "options": ["Golgi apparatus", "Ribosome", "Mitochondrion", "Lysosome"],
      "correctIndex": 2,
      "timeLimitSec": 30,
      "explanation": "Optional text shown at reveal."
    }
  ]
}
```

`difficulty` is one of `easy`, `medium`, `hard`.

## Project structure

```text
edutools_quizme/
├─ index.html                 front page: join with a code, host a game, a live stake-dial demo
├─ admin.html                 host: quiz builder, lobby, live control, projector view
├─ student.html               phone: join, bid, answer, side-bet, results, report
├─ css/style.css              the three colour themes as tokens, then every component
├─ js/
│  ├─ config.js · firebase.js    Firebase web config; the SDK pinned in one place, anonymous sign-in, emulator switch
│  ├─ room.js                 the only file that reads or writes the database
│  ├─ host.js                 runs the engine on the host's page: watch, tick, write
│  ├─ engine.js               pure: what the host writes next (phases, group votes, scoring, Safety Net)
│  ├─ scoring.js · decide.js  pure: wager and payout maths; group vote resolution
│  ├─ grouping.js · codes.js  pure: random balanced groups; 6-character codes (from edutools_cuteworld)
│  ├─ quiz.js · report.js     pure: quiz validation, import and export; the calibration report
│  ├─ admin.js · admin-builder.js · admin-views.js      the host's page
│  ├─ student.js · student-views.js                     the phone's page
│  ├─ dial.js                 the stake dial (also on the front page)
│  ├─ sounds.js · theme.js    the question fanfare and music; colour themes
│  └─ shapes.js · ui.js       option shapes and icons; small DOM helpers
├─ assets/favicon.svg         (the Pages workflow copies assets/, so it must exist)
├─ tests/                     *.test.js = pure logic, run in CI · rules/ = emulator · e2e/ = real pages in Chrome
├─ tools/serve.mjs            static dev server (from edutools_cuteworld)
├─ database.rules.json        shared rules, including QuizMe's `quizzes` block
├─ firebase.json · package.json · skills-lock.json
└─ .github/workflows/pages.yml  tests, then deploy to GitHub Pages
```

`.claude/skills/web-design-guidelines` is installed by `npx skills` — don't edit it by hand.

## Getting started

The Firebase side is mostly done: the project (`edutools-7c110`), Anonymous sign-in and the web config in [js/config.js](js/config.js) already exist. Do **not** create a second project or database.

1. **Rules:** the `quizzes` block is already in [database.rules.json](database.rules.json). Publish the combined file (Realtime Database → Rules, or `firebase deploy --only database`) before the first real game, and copy it back to the sibling repos so nobody publishes an older copy over it. See the warning above.
2. **Run locally:** `npm install` once (dev tools only), then `npm start` and open http://localhost:5173/admin.html for the host. Players open the QR code or `student.html?room=<code>`.
3. **Emulators:** `npm run emulators`, then add `?emulator` to a page URL on localhost to use them instead of the real project. The emulator's database is `demo-quizme-default-rtdb`.
4. **Deploy:** push to `main`. [.github/workflows/pages.yml](.github/workflows/pages.yml) runs the unit tests, then publishes `index.html admin.html student.html css js assets`. Set Settings → Pages → Source to *GitHub Actions* and add `<user>.github.io` to Firebase Authentication → Authorized domains. The deploy step fails if any listed path is missing.

## Testing

- **Unit (CI):** `npm test` runs `node --test "tests/*.test.js"`: 110 tests of the pure modules, none of which import Firebase or the DOM. They cover wager maths, difficulty multipliers, Double Down and Shield, the floor at 0, ranking tie-breaks, the Safety Net cutoff for small N, the side-bet push at exactly 50%, balanced groups (never a size gap above one, always two groups), each group-vote rule (lower median, plurality, captain tie-break, majority Ready), quiz validation and import/export, the calibration report, the whole host engine (every phase, deadline, grace window and group resolution), the fanfare's notes, the question music (its harmony, its key, its tempo and how it is scheduled, against a stand-in for the browser's audio), and that every theme restyles every surface token.
- **Rules (local, needs Java):** `npm run test:rules` runs 49 tests against the Database emulator: players can't read `quiz`, write `score`, answer twice, answer in the wrong phase or after the deadline, read `stats` before answering, or read another player's score; in group mode they can't read another group's `vote` or write a group's `ans`; a question can't be revealed twice. Two more tests play a **whole solo game and a whole group game** with `js/engine.js` as the host, so every patch the host will write is checked against the real rules.
- **End to end (local, needs Java and Chrome):** `npm run test:e2e` drives the real pages in headless Chrome against the Auth and Database emulators: a host and phone-sized players play a solo game and a group game (shuffle, votes, Ready, captain tie-break, a latecomer, Safety Net, side-bets, the report), refresh and resume, end the game, and switch themes. It also checks that the question fanfare plays, that the music plays while the clock runs, stops at the reveal and follows the Sound switch in the middle of a question, that phones stay silent, and that every big-screen view fits a 1366 × 768 projector without scrolling. Screenshots land in `tests/e2e/shots/`.
- **Manual:** open `admin.html` and use a private window, another browser or a phone for each extra player.

## UI principles

- Mobile-first player screens; tap targets of at least 44 px; answer options use colour **and** shape/label; groups use colour **and** the `Group N` label; honour `prefers-reduced-motion`; announce phase and timer changes with `aria-live`.
- The projector view uses large type readable from the back of a room, and never shows individual bids or the bottom of the ranking.
- Review UI changes with the installed `web-design-guidelines` skill.

### Sound and themes

- **Sound:** the host's page plays synthesised sounds (Web Audio, no audio files). When a question appears there is a short fanfare: a springy glide, a rising arpeggio and a sparkle. Then a tune loops for exactly as long as the progress bar runs on that question, so not during the wagers: eight bars of about 15 s with a bouncy bass, off-beat chord stabs, a bell-like lead and a ticking clock. In the last 5 s, when the bar turns red, it speeds up and ticks twice as often. It fades out when the answer is revealed, when time runs out or when the host moves on. Both are one step higher in key each question (C, D, E, then round again). The **Sound** switch in the top bar mutes everything, turning it on plays a preview (and brings the tune back if a question is out), and the choice is remembered on that device. Phones stay silent. Browsers only allow sound after a click, and the host has always pressed something before the first question; if the host page is refreshed in the middle of a question, the tune starts at the next click.
- **Themes:** **Black** (the default), **Spruce** (the original deep teal) and **Light** (for bright rooms), chosen with the **Theme** switch on every page and remembered per device. A palette is a set of CSS tokens on `<html data-theme>`; the risk ramp, results and focus colours are deepened on Light so they read on white, and the four answer colours work on all three. A new theme must define every surface token (a unit test checks this).

## Roadmap

- [x] **M0 Scaffold** — pages, `room.js`, the `quizzes` rules block, `package.json` and test wiring.
- [x] **M1 Lobby** — host creates a game, code and QR; players join with a name; presence (`on`).
- [x] **M2 Round loop** — `bid` → `answer` → `reveal` → `standings` on server-time timers.
- [x] **M3 Confidence Bidding** — wagers and difficulty multipliers; `scoring.js` with unit tests.
- [x] **M4 Safety Net** — Double Down and Shield tokens.
- [x] **M5 Active Side-Bets** — live anonymous stats and micro-bets.
- [x] **M6 Group mode** — shuffle groups, votes + Ready, `decide.js`, group scoring and stats.
- [x] **M7 Quiz builder** — create, edit, reorder, import and export quizzes.
- [x] **M8 Reflection** — podium plus a calibration report (per category: average wager vs accuracy → over- or under-confident; in group mode, how often your vote matched the group's answer).
- [ ] **M9 Hardening** — done: rules, end-to-end and big-screen-fit tests, sounds and themes. Still open: tuning the constants in real playtests, and an accessibility audit with screen readers.
- Later: App Check, CSV result export, kick/rename players, group chat (as in `edutools_pinboard`), scoring in Cloud Functions (Blaze) for hands-off hosting or stricter anti-cheat.

## Decisions to confirm

Where the original brief was silent, this spec assumes the following. Each is easy to change.

1. Scoring numbers (1000 start, 100 base, ×1 / ×1.5 / ×2 by difficulty, 50-point side-bet) are untested.
2. A token's effect (Double Down or Shield) is chosen when it is spent, not when it is unlocked.
3. Unanswered counts as wrong; no bid means 0%; exactly 50% class accuracy is a push.
4. The host's page is the coordinator, as in the other edutools apps — no Cloud Functions in v1.
5. Multiple choice only, one correct answer, 2–4 options.
6. Joining closes after `lobby` in solo mode; in group mode latecomers join the smallest group.
7. The projector shows the top 5 only; ranks are otherwise private.
8. Groups decide by **vote + Ready** (majority of online members), not "whoever taps last": wager is the lower median, ties go to a rotating captain, and group mode needs at least 4 players.
9. A side-bet can also be passed ("no bet"), and `answer` ends once everyone has answered and settled their bet, or 6 s (12 s in group mode) after the last answer, so the last player to answer can still bet.
10. Scores and ranks are private in the database, not just on screen: a player can read only their own `score`, `perk` and `out`.
11. The Safety Net ranks only players (or groups) that are online; someone who left keeps their score but does not count in N.
12. Black is the default theme; the host's page has sound on by default and phones are silent.
13. The question music plays only while the question is on the big screen (the answer phase), not during the wagers, and it never changes the points or the timers. It is also a single tune; choosing between tunes, or a volume slider, is easy to add.
