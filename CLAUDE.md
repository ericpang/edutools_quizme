# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QuizMe is a Kahoot!-style live classroom quiz where points come from confidence, not speed: **Confidence Bidding** (wager a % of your score seeing only category + difficulty), **Safety Net** (the bottom 30% unlock a one-time Double Down or Shield), **Active Side-Bets** (after answering, see anonymous live class stats and bet on whether the class majority is right) and a **Group mode** (random balanced groups that decide by vote). Points never depend on response time; timers only pace the game.

**Status: spec only.** [README.md](README.md) is the design spec and source of truth: scoring formulas, data model, security-rules contract, roadmap (M0–M9) and a "Decisions to confirm" list of assumptions the user has not confirmed yet (surface them, don't silently change them). Update the README in the same change when behaviour or the data model changes. No pages or app code exist yet; what exists is `js/config.js`, `js/firebase.js`, `firebase.json`, `database.rules.json`, `.github/workflows/pages.yml` and the `web-design-guidelines` skill.

It is one of the edutools apps: a static site on GitHub Pages (plain HTML/CSS/ES modules, no build step, no server, no Firebase Hosting) using the shared Firebase project `edutools-7c110` — Realtime Database + Anonymous Auth.

## Commands

There is no `package.json`, build step or linter yet. What works today:

- **Serve** over HTTP, not `file://` (ES modules): `npx serve .` or `python -m http.server 8080`.
- **Emulators** (need Java): `npx firebase-tools emulators:start --only auth,database --project demo-cuteworld`, the command behind `edutools_cuteworld`'s `npm run emulators`. Ports are in `firebase.json` (auth 9099, database 9000, Emulator UI off). Add `?emulator` to a page URL on localhost or 127.0.0.1 to use them instead of the real project. Keep `--project demo-cuteworld`: `js/firebase.js` hard-codes the namespace `demo-cuteworld-default-rtdb` (inherited from cuteworld), so rename both together or not at all.
- **Tests:** CI runs `node --test "tests/*.test.js"` on Node 22, pure-logic modules only. One file: `node --test tests/<name>.test.js`; one case: add `--test-name-pattern="<regex>"`. Rules tests (`tests/rules/`, emulator + Java) are local only. Neither exists yet; M0 adds a `package.json` with `start`, `test`, `test:rules` and `emulators` scripts copied from `edutools_cuteworld`.
- **Deploy:** push to `main`; `pages.yml` runs the tests, then publishes. It `cp`s a fixed list (`index.html admin.html student.html css js assets`) into `_site/`, so every path must exist (`assets/` needs at least one file, since git doesn't track empty folders) and a new top-level runtime file must be added to that list. The workflow does **not** deploy `database.rules.json`.

## Architecture

Intended design (README has the details), spread across several files once built:

- **No server: the host's page is the coordinator.** It holds the answer key, advances phases, aggregates live stats, resolves group votes and writes scores. Players are untrusted: rules let them write only their own profile, vote, bid, answer and side-bet, once, in the right phase, before the deadline. Everyone, host included, signs in anonymously; the host is the room creator's uid in `meta/owner`, and the room code is kept in localStorage, so clearing browser data loses control of a live room. State lives in the database, so the host controller must be a reconciler driven by `cur` and its stored deadline, never by in-memory state.
- **A "subject" is a uid (solo) or a group id `g1`, `g2`, … (group mode).** Scoring is keyed by subject. In group mode the host resolves members' `vote/<qid>/<subject>/<uid>` into the same `bid`, `ans` and `side` nodes a solo player writes, so scoring never knows the mode.
- **Secrecy invariants any new data path must keep:** the answer key lives only in owner-readable `quizzes/<code>/quiz/<qid>` and reaches players only through `res/<qid>` at reveal (never in `cur`); `stats/<qid>` is readable only by subjects that already answered; a group's `vote` nodes are readable only by that group and the owner.
- **Module boundaries:** `js/firebase.js` is the only file that names the SDK URL and version (12.19.0 appears in four URLs there; bump them together). It re-exports `firebase-database.js`, so import `ref`, `onValue`, `runTransaction` and the rest from `./firebase.js`, never from the CDN. Planned: `js/room.js` is the only file that reads or writes the database, and `scoring.js`, `decide.js`, `grouping.js` and `codes.js` are pure (no DOM or Firebase imports) so CI can unit test them.
- **One Firebase project, one rules file, many apps.** `database.rules.json` holds every edutools app's block (`sessions`, `boards`, `polls`, `mindmaps`, `worlds`, `whiteboards`). QuizMe's goes in a new top-level `quizzes` block (not written yet; no other app uses that key). Deploying the file replaces the whole project's rules, and each sibling repo keeps its own copy. As of 2026-11-06 this repo's copy is identical to `edutools_whiteboard`'s, while the `edutools_cuteworld`, `edutools_mindmap` and `edutools_pinboard` copies differ (older). Compare with the live rules before publishing and copy changes back to the siblings. Follow the existing rule conventions (see `boards` and `worlds`): `$code.matches(/^[A-HJKMNP-Z2-9]{6}$/)`, a `meta` that only its `owner` can rewrite, `$other` → `.validate: false`, and an owner-only read at `$code` with children opened one by one.

## Reference implementations

Reuse the house style from the siblings in `C:\Projects\Claude\`: `edutools_cuteworld/CLAUDE.md` (architecture and data conventions; its solo/group quiz is the closest precedent), `js/grouping.js` (`formGroups`, `smallestGroup`, `g1…` ids), `js/codes.js` (6-character codes), `js/room.js` (database layer), `tools/serve.mjs` (dev server on port 5173), `tests/rules/rules.test.js` (rules-test template), and `edutools_pinboard/README.md` (README style). Once QuizMe is deployable, register it in the hub repo `C:\Projects\Claude\edutools` (the apps array in `index.html` and the README table); it isn't listed yet.

## Notes

- The `web-design-guidelines` skill (`.claude/skills/`, recorded in `skills-lock.json`, managed by `npx skills`) fetches its rules from `raw.githubusercontent.com` on every run. Use it to review UI.
- On Windows, `firebase-tools` can leave the emulator's `java` process holding port 9000 after a run (seen in `edutools_cuteworld`); stop only the process listening on 9000 or 9099 before rerunning.
