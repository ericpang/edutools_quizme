# QuizMe

A live, Kahoot!-style classroom quiz that rewards **thinking about your own thinking** instead of tapping speed. Play solo, or in randomly formed groups that decide together.

> **Status:** design spec. The Firebase setup (config, rules file, emulators, Pages workflow) is in place; the app itself is not built yet. QuizMe is an independent project and is not affiliated with Kahoot!.

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
| `answer` | Question + options, "n/N answered" | Option buttons. After locking in: live class stats and the side-bet |
| `reveal` | Correct option, class accuracy, side-bet verdict | Personal result: right or wrong, wager, points won or lost |
| `standings` | Top 5 only | Own rank; "Safety Net unlocked" prompt when earned |
| `final` | Podium | Final rank and score (calibration report planned, M8) |

In group mode every count (n/N, ranks, stats) is of *groups*, and phones also show teammates' votes with a **Ready** button in `bid`, `answer` and the side-bet step.

Timers only pace the game and never affect points: 10 s to bid and 20 s to answer by default, 20 s and 40 s in group mode so teams can talk (a question's `timeLimitSec` overrides the answer time). The host can advance early, and `answer` ends as soon as every connected player (or group) has answered.

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

- After each question's standings (except the last), rank players by score ↓, then correct answers ↓, then join order ↑. The last `max(1, floor(0.30 × N))` players who have not yet unlocked a token get **one** token.
- A token is spent by arming it in a later `bid` phase; the player then picks its effect for that question:
  - **Double Down** — the gain on a right answer is doubled; no extra penalty if wrong.
  - **Shield** — a wrong answer costs nothing (the wager is refunded).
- One token per player per game; unused tokens expire when the game ends. Tokens affect the main wager only, not the side-bet.
- Ranks are private: the projector shows the top 5 and each student sees only their own rank, so trailing players aren't publicly ranked last.

### Active Side-Bets

- After a player locks in an answer, their screen shows anonymous live stats for the current question: the share of answers per option and `answered / total`. Stats never reveal which option is correct, and appear only once `STATS_MIN_ANSWERS` answers are in so individuals can't be picked out.
- Until `answer` ends, the player may place one micro-bet: the class majority will be **RIGHT** or **WRONG**. Stake is `min(SIDE_BET_STAKE, score)` at even odds.
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

The **captain** rotates every question (members in join order; `captain = members[question number mod group size]`). They break ties and speak for the group on the projector, so everyone takes a turn at being accountable.

### Scoring in groups

- The leaderboard, podium and Safety Net rank *groups*: the bottom `max(1, floor(0.30 × G))` of G groups unlock their group's token.
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
  meta                           owner, title, mode (solo or group), groupSize, open, createdAt
  cur                            qid, phase, category, difficulty, deadline; plus text, options once phase = answer
  quiz/<qid>                     full question incl. correct option, timeLimitSec    owner only
  players/<uid>                  name, on, ts                                         player writes own
  group/<uid>                    'g1', 'g2', …                                        group mode; owner writes
  vote/<qid>/<subject>/<uid>     v, ready, ts                                         group mode; one entry per member
  bid/<qid>/<subject>            pct, token?, ts
  ans/<qid>/<subject>            v, ts
  side/<qid>/<subject>           v ("right" or "wrong"), ts
  stats/<qid>                    answered, total, counts[]                            owner writes
  score/<subject>                pts, ok                                              everyone reads, owner writes
  perk/<subject>                 unlocked, used                                       owner writes
  out/<qid>/<subject>            wager, delta, side                                   owner writes
  res/<qid>                      correct, counts, accuracy                            owner writes at reveal
```

A **subject** is a player's uid in solo mode and a group id in group mode. Group ids (`g1`, `g2`, …) can never collide with a Firebase uid.

### Security rules

| Data | Who reads | Who writes |
|---|---|---|
| `meta`, `cur`, `group`, `score`, `res` | anyone signed in | the owner (`meta/owner` is set once, to the creator's uid) |
| `quiz` | the owner only | the owner |
| `players/<uid>` | anyone signed in | that user; new players only while `meta/open` is true |
| `vote/<qid>/<subject>/<uid>` | members of that group + owner | that member, own entry only |
| `bid`, `ans`, `side` | that subject (own uid, or a group member) + owner | solo: that user. Group: the owner only, resolved from the votes |
| `stats/<qid>` | the owner + subjects that already have an `ans` for `<qid>` | the owner |
| `perk`, `out` | that subject + owner | the owner |

Player writes are accepted only for the current `qid`, in the matching `cur/phase`, once, and before `cur/deadline` plus a small grace (using the rules' `now`). A bid `token` needs an unspent `perk`. The answer key lives only in `quiz/` and is copied to `res/<qid>` at `reveal`, so players can never read it early and can never write a score. Rules can't recompute scores or check that the host resolved votes honestly, so the host's page is trusted, as in the other apps.

> **One rules file for every edutools app.** QuizMe's `quizzes` block goes into the shared [database.rules.json](database.rules.json) beside `sessions`, `boards`, `polls`, `mindmaps`, `worlds` and `whiteboards`. Deploying the file replaces the whole project's rules, so compare it with the live rules first and copy the updated file back to the sibling repos.

### Timing, joining, reconnecting

- **Timers:** deadlines are stored in server time. Clients show `deadline − (Date.now() + serverTimeOffset)` using `.info/serverTimeOffset`, so countdowns agree across devices.
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

Files marked ✔ already exist.

```text
edutools_quizme/
├─ index.html                 role picker + enter a code
├─ admin.html                 host: quiz builder, lobby, live control, projector view
├─ student.html               phone: join, bid, answer, side-bet, results
├─ css/                       theme tokens and styles
├─ js/
│  ├─ config.js            ✔  Firebase web config (shared edutools project; not a secret)
│  ├─ firebase.js          ✔  SDK pinned in one place, anonymous sign-in, emulator switch
│  ├─ room.js                 the only file that reads or writes the database
│  ├─ admin.js · student.js   page logic
│  ├─ codes.js                6-character room codes (copy from edutools_cuteworld)
│  ├─ grouping.js             random balanced groups (copy from edutools_cuteworld)
│  ├─ scoring.js              pure: wager, gain/loss, tokens, side-bets, ranking
│  └─ decide.js               pure: group vote resolution
├─ assets/                    favicon etc. (must exist: the Pages workflow copies it)
├─ tests/                     *.test.js = pure logic, run in CI · rules/ = emulator, local only
├─ tools/serve.mjs            static dev server (copy from edutools_cuteworld)
├─ database.rules.json     ✔  shared rules; QuizMe's `quizzes` block still to add
├─ firebase.json           ✔  database + auth emulators (ports 9000 and 9099, no UI)
├─ package.json               scripts: start, test, test:rules, emulators
├─ skills-lock.json        ✔  managed by `npx skills`
└─ .github/workflows/pages.yml  ✔  tests, then deploy to GitHub Pages
```

`.claude/skills/web-design-guidelines` is installed by `npx skills` — don't edit it by hand.

## Getting started

The Firebase side is mostly done: the project (`edutools-7c110`), Anonymous sign-in and the web config in [js/config.js](js/config.js) already exist. Do **not** create a second project or database.

1. **Rules:** add the `quizzes` block to [database.rules.json](database.rules.json), then publish the combined file (Realtime Database → Rules, or `firebase deploy --only database`). See the warning above.
2. **Scripts:** add a `package.json` (`"type": "module"`) with the same scripts as `edutools_cuteworld`: `start` (`node tools/serve.mjs`, port 5173), `test` (`node --test "tests/*.test.js"`), `test:rules` and `emulators` (`firebase emulators:start --only auth,database`). Dev dependency: `@firebase/rules-unit-testing`.
3. **Run locally:** `npm start`, then open http://localhost:5173/admin.html for the host and `student.html?room=<code>` for players. To use the emulators instead of the real project, run `npm run emulators` and add `?emulator` to the page URL.
4. **Deploy:** push to `main`. [.github/workflows/pages.yml](.github/workflows/pages.yml) runs the unit tests, then publishes `index.html admin.html student.html css js assets`. Set Settings → Pages → Source to *GitHub Actions* and add `<user>.github.io` to Firebase Authentication → Authorized domains. The deploy step fails if any listed path is missing, so create `assets/` even if it only holds a favicon.

> **Heads-up:** `js/firebase.js` points the emulator at the namespace `demo-cuteworld-default-rtdb`. Run the emulators with `--project demo-cuteworld`, or change both to `demo-quizme`.

## Testing

- **Unit (CI):** `npm test` runs `node --test "tests/*.test.js"` on pure modules only — `scoring.js`, `decide.js`, `grouping.js` and `codes.js` import nothing from Firebase or the DOM. Cover wager math, difficulty multipliers, Double Down and Shield, the floor at 0, ranking tie-breaks, the Safety Net cutoff for small N, the side-bet push at exactly 50%, group sizes never differing by more than one (and always at least two groups), and each group-vote rule (lower median, plurality, captain tie-break, majority Ready).
- **Rules (local, needs Java):** `npm run test:rules` against the Database emulator. Assert that players can't read `quiz`, can't write `score`, can't answer twice, in the wrong phase or after the deadline, can't read `stats` before answering, and — in group mode — can't read another group's `vote` or write a group's `ans` directly.
- **Manual:** open `admin.html` and use a private window, another browser or a phone for each extra player.

## UI principles

- Mobile-first player screens; tap targets of at least 44 px; answer options use colour **and** shape/label; groups use colour **and** the `Group N` label; honour `prefers-reduced-motion`; announce phase and timer changes with `aria-live`.
- The projector view uses large type readable from the back of a room, and never shows individual bids or the bottom of the ranking.
- Review UI changes with the installed `web-design-guidelines` skill.

## Roadmap

- [ ] **M0 Scaffold** — pages, `room.js`, the `quizzes` rules block, `package.json` and test wiring.
- [ ] **M1 Lobby** — host creates a game, code and QR; players join with a name; presence (`on`).
- [ ] **M2 Round loop** — `bid` → `answer` → `reveal` → `standings` on server-time timers.
- [ ] **M3 Confidence Bidding** — wagers and difficulty multipliers; `scoring.js` with unit tests.
- [ ] **M4 Safety Net** — Double Down and Shield tokens.
- [ ] **M5 Active Side-Bets** — live anonymous stats and micro-bets.
- [ ] **M6 Group mode** — shuffle groups, votes + Ready, `decide.js`, group scoring and stats.
- [ ] **M7 Quiz builder** — create, edit, import and export quizzes.
- [ ] **M8 Reflection** — podium plus a calibration report (per category: average wager vs accuracy → over- or under-confident; in group mode, each member's votes vs the group's decision).
- [ ] **M9 Hardening** — rules tests, accessibility pass, playtest-tuned constants.
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
