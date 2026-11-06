// Whole games played against the real security rules, with js/engine.js as the host: every patch the host writes must
// be accepted, and every write a player makes must land in the phase it belongs to. `npm run test:rules`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { assertFails, assertSucceeds as expectOk, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, serverTimestamp, set, update } from 'firebase/database';
import { advance, autoStep, canStart, shufflePatch, startPatch } from '../../js/engine.js';
import { SAMPLE_QUIZ, toStored } from '../../js/quiz.js';

const CODE = 'XYZ789';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-quizme',
    database: { rules: readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearDatabase());

const db = (uid) => env.authenticatedContext(uid).database();
const at = (d, path = '') => ref(d, `quizzes/${CODE}${path ? `/${path}` : ''}`);
const quiz = { title: 'Flow', questions: SAMPLE_QUIZ.questions.slice(0, 3) }; // Cell biology (hard, 2), Geography (easy, 2), Chemistry (medium, 1)

// What js/host.js feeds the engine: the room as the owner sees it.
async function snapshot(host) {
  const read = async (path) => {
    try {
      return (await get(at(host, path))).val();
    } catch (err) {
      throw new Error(`the owner could not read ${path}: ${err.message}`);
    }
  };
  const [meta, cur, players, group, stored, score, perk] = await Promise.all(['meta', 'cur', 'players', 'group', 'quiz', 'score', 'perk'].map(read));
  const q = cur?.qid;
  const [bid, ans, side, vote, stats] = q ? await Promise.all(['bid', 'ans', 'side', 'vote', 'stats'].map((k) => read(`${k}/${q}`))) : [];
  return { meta, cur, players: players ?? {}, group: group ?? {}, quiz: stored, score: score ?? {}, perk: perk ?? {}, bid: bid ?? {}, ans: ans ?? {}, side: side ?? {}, vote: vote ?? {}, stats: stats ?? null };
}

// assertSucceeds that points at the line of the test whose write was refused (the SDK's own stack never does).
const assertSucceeds = (write) => {
  const where = new Error('refused').stack.split('\n').slice(2, 4).join('\n');
  return expectOk(write).catch((err) => {
    err.message += `\n${where}`;
    throw err;
  });
};
const ok = (what, write) => assertSucceeds(write).catch((err) => Promise.reject(new Error(`${what} was refused: ${err.message}`)));

async function openRoom(mode, uids) {
  const host = db('host');
  await ok('creating the room', set(at(host, 'meta'), { owner: 'host', title: quiz.title, mode, groupSize: 2, maxWager: 100, open: true, createdAt: serverTimestamp() }));
  await ok('storing the quiz', update(at(host), { quiz: toStored(quiz), cur: { phase: 'lobby', n: 0, total: quiz.questions.length } }));
  for (const uid of uids) await ok(`${uid} joining`, set(at(db(uid), `players/${uid}`), { name: uid.toUpperCase(), on: true, ts: serverTimestamp() }));
  return host;
}

// Write one of the host's patches, and say which one if the rules refuse it.
async function apply(host, patch) {
  try {
    await update(at(host), patch);
  } catch (err) {
    console.error(`the rules refused the host's patch:\n${JSON.stringify(patch, null, 1)}`);
    throw err;
  }
}

// Let the host's loop run until it has nothing left to do (or the phase it was waiting for has arrived).
async function settle(host, until) {
  for (let i = 0; i < 12; i++) {
    const snap = await snapshot(host);
    if (snap.cur.phase === until) return snap;
    const patch = autoStep(snap, Date.now());
    if (!patch) return snap;
    await apply(host, patch);
  }
  throw new Error(`never reached ${until}`);
}
const step = async (host) => {
  const patch = advance(await snapshot(host), Date.now(), () => 0.5);
  assert.ok(patch, 'the host has a next step');
  await apply(host, patch);
  return snapshot(host);
};
const ts = () => serverTimestamp();

test('a whole solo game: bids, answers, side-bets, scoring and the Safety Net', async () => {
  const host = await openRoom('solo', ['alice', 'bob', 'carol']);
  assert.equal(canStart(await snapshot(host)).ok, true);

  // question 1: hard, answer C (index 2)
  let snap = await step(host); // lobby -> bid
  assert.equal(snap.cur.phase, 'bid');
  assert.equal(snap.meta.open, false); // solo: nobody joins mid-game
  await assertFails(set(at(db('dave'), 'players/dave'), { name: 'Dave', on: true, ts: ts() }));
  assert.equal('text' in snap.cur, false);
  await assertSucceeds(set(at(db('alice'), 'bid/q1/alice'), { pct: 50, ts: ts() }));
  await assertSucceeds(set(at(db('bob'), 'bid/q1/bob'), { pct: 20, ts: ts() }));
  await assertSucceeds(set(at(db('carol'), 'bid/q1/carol'), { pct: 0, ts: ts() }));
  snap = await settle(host, 'answer'); // everyone bid: the question appears
  assert.equal(snap.cur.text, quiz.questions[0].text);

  await assertSucceeds(set(at(db('alice'), 'ans/q1/alice'), { v: 2, ts: ts() }));
  await assertSucceeds(set(at(db('bob'), 'ans/q1/bob'), { v: 0, ts: ts() }));
  await assertSucceeds(set(at(db('carol'), 'ans/q1/carol'), { v: 2, ts: ts() }));
  assert.deepEqual((await settle(host, 'never')).stats, { answered: 3, total: 3, counts: [1, 0, 2, 0] });
  await assertSucceeds(get(at(db('alice'), 'stats/q1'))); // they have all answered, so they may look
  await assertSucceeds(set(at(db('alice'), 'side/q1/alice'), { v: 'right', ts: ts() }));
  await assertSucceeds(set(at(db('bob'), 'side/q1/bob'), { v: 'wrong', ts: ts() }));
  await assertSucceeds(set(at(db('carol'), 'side/q1/carol'), { v: 'none', ts: ts() }));
  snap = await settle(host, 'reveal');
  assert.equal(snap.cur.phase, 'reveal');

  const read = async (uid, path) => (await get(at(db(uid), path))).val();
  assert.deepEqual(await read('alice', 'score/alice'), { pts: 2250, ok: 1, rank: 1, of: 3 }); // 1000 + (100 + 500) x 2 + 50
  assert.deepEqual(await read('bob', 'score/bob'), { pts: 750, ok: 0, rank: 3, of: 3 }); // 1000 - 200 - 50
  assert.deepEqual(await read('carol', 'score/carol'), { pts: 1200, ok: 1, rank: 2, of: 3 }); // 1000 + 100 x 2
  assert.equal((await read('bob', 'res/q1')).correct, 2); // the key is public only now
  assert.equal((await read('alice', 'res/q1')).majority, 'right');
  assert.equal((await read('alice', 'out/q1/alice')).bet, 'right');
  await assertFails(get(at(db('alice'), 'out/q1/bob'))); // someone else's

  // the host cannot reveal the same question twice (say, from a second tab): nothing is scored again
  await assertFails(update(at(host), { 'res/q1': { correct: 2, counts: [1, 0, 2, 0], answered: 3, total: 3, accuracy: 67, majority: 'right', category: 'Cell biology', difficulty: 'hard' } }));

  // standings: the last player unlocks a token
  snap = await step(host);
  assert.equal(snap.cur.phase, 'standings');
  assert.deepEqual(snap.perk, { bob: { unlocked: true, used: false } });
  assert.deepEqual(await read('bob', 'perk/bob'), { unlocked: true, used: false });
  await assertFails(get(at(db('alice'), 'perk/bob'))); // someone else's

  // question 2: easy, answer C. bob arms a Shield, bets his whole stack, and answers wrong
  snap = await step(host);
  assert.equal(snap.cur.qid, 'q2');
  await assertFails(set(at(db('alice'), 'bid/q2/alice'), { pct: 10, token: 'dd', ts: ts() })); // alice never earned a token
  await assertSucceeds(set(at(db('bob'), 'bid/q2/bob'), { pct: 100, token: 'sh', ts: ts() }));
  await assertSucceeds(set(at(db('alice'), 'bid/q2/alice'), { pct: 0, ts: ts() }));
  await assertSucceeds(set(at(db('carol'), 'bid/q2/carol'), { pct: 0, ts: ts() }));
  await settle(host, 'answer');
  await assertSucceeds(set(at(db('bob'), 'ans/q2/bob'), { v: 1, ts: ts() }));
  await assertSucceeds(set(at(db('alice'), 'ans/q2/alice'), { v: 2, ts: ts() }));
  await assertSucceeds(set(at(db('carol'), 'ans/q2/carol'), { v: 2, ts: ts() }));
  for (const uid of ['alice', 'bob', 'carol']) await assertSucceeds(set(at(db(uid), `side/q2/${uid}`), { v: 'none', ts: ts() }));
  await settle(host, 'reveal');
  assert.deepEqual(await read('bob', 'score/bob'), { pts: 750, ok: 0, rank: 3, of: 3 }); // the Shield refunded a 750 wager
  assert.equal((await read('bob', 'perk/bob')).used, true);
  assert.equal((await read('bob', 'out/q2/bob')).token, 'sh');
  assert.equal((await read('alice', 'score/alice')).pts, 2350); // 2250 + 100 base points on an easy question

  // the last question, then the end
  await step(host); // standings
  snap = await step(host); // question 3
  assert.equal(snap.cur.qid, 'q3');
  await settle(host, 'never'); // nobody bids: the clock would end it; here the host moves on by hand
  snap = await step(host); // answer
  snap = await step(host); // reveal
  assert.equal(snap.cur.phase, 'reveal');
  snap = await step(host); // standings (no token after the last question)
  assert.equal(snap.perk.carol, undefined);
  snap = await step(host);
  assert.equal(snap.cur.phase, 'final');
  assert.equal(advance(snap, Date.now()), null);
});

test('a whole group game: votes become group bids, answers and side-bets', async () => {
  const host = await openRoom('group', ['alice', 'bob', 'carol', 'dan']);
  assert.equal(canStart(await snapshot(host)).ok, true);

  // the host shuffles (as often as it likes), then the test fixes the teams so it knows who is where
  await assertSucceeds(update(at(host), shufflePatch(await snapshot(host), Math.random)));
  await assertSucceeds(set(at(host, 'group'), { alice: 'g1', bob: 'g1', carol: 'g2', dan: 'g2' }));
  let snap = await step(host);
  assert.equal(snap.cur.phase, 'bid');
  assert.equal(snap.meta.open, true); // group mode lets latecomers in
  assert.deepEqual(snap.score, { g1: { pts: 1000, ok: 0 }, g2: { pts: 1000, ok: 0 } });

  // a latecomer is placed in the smallest group (a tie goes to the lowest number)
  await assertSucceeds(set(at(db('erin'), 'players/erin'), { name: 'Erin', on: true, ts: serverTimestamp() }));
  snap = await settle(host, 'never');
  assert.equal(snap.group.erin, 'g1');
  await assertSucceeds(set(at(db('erin'), 'vote/q1/g1/erin/bid'), { pct: 0 }));

  // bidding: g1 votes 60, 20 and 0 (lower median 20); g2 votes 10 and 10. Not everyone is Ready yet.
  const vote = (uid, g, q, kind, value) => assertSucceeds(set(at(db(uid), `vote/${q}/${g}/${uid}/${kind}`), value));
  await vote('alice', 'g1', 'q1', 'bid', { pct: 60, ok: true });
  await assertFails(get(at(db('carol'), 'vote/q1/g1'))); // the other team cannot see the votes
  await assertSucceeds(get(at(db('bob'), 'vote/q1/g1')));
  await vote('carol', 'g2', 'q1', 'bid', { pct: 10, ok: true });
  await vote('dan', 'g2', 'q1', 'bid', { pct: 10, ok: true });
  snap = await settle(host, 'never');
  assert.equal(snap.bid.g2.pct, 10); // g2 is Ready, so it is settled at once
  assert.equal(snap.bid.g1, undefined); // g1: one Ready of three is not more than half
  await vote('bob', 'g1', 'q1', 'bid', { pct: 20, ok: true });
  snap = await settle(host, 'answer'); // two Ready of three: g1 is settled and everyone has bid
  assert.equal(snap.bid.g1.pct, 20);
  await assertFails(set(at(db('alice'), 'vote/q1/g1/alice/bid'), { pct: 90 })); // the wager is locked now

  // answering: g1 agrees on C; g2 on A but only carol is Ready
  await vote('alice', 'g1', 'q1', 'ans', { v: 2, ok: true });
  await vote('bob', 'g1', 'q1', 'ans', { v: 2, ok: true });
  await vote('carol', 'g2', 'q1', 'ans', { v: 0, ok: true });
  await vote('dan', 'g2', 'q1', 'ans', { v: 0 });
  snap = await settle(host, 'never');
  assert.equal(snap.ans.g1.v, 2);
  assert.equal(snap.ans.g2, undefined); // 1 of 2 Ready is not more than half
  await vote('dan', 'g2', 'q1', 'ans', { v: 0, ok: true });
  snap = await settle(host, 'never');
  assert.equal(snap.ans.g2.v, 0);
  assert.deepEqual(snap.stats, { answered: 2, total: 2, counts: [1, 0, 1, 0] }); // two teams, one pick each
  await assertSucceeds(get(at(db('bob'), 'stats/q1'))); // a team that has answered may look at the crowd
  await assertSucceeds(get(at(db('erin'), 'stats/q1')));

  // side-bets: g1 bets "right" (one vote, one Ready without a bet), g2 bets "wrong"
  await vote('alice', 'g1', 'q1', 'side', { v: 'right', ok: true });
  await vote('bob', 'g1', 'q1', 'side', { ok: true });
  await vote('carol', 'g2', 'q1', 'side', { v: 'wrong', ok: true });
  await vote('dan', 'g2', 'q1', 'side', { v: 'wrong', ok: true });
  snap = await settle(host, 'reveal'); // every team has settled, so the question is scored
  assert.equal(snap.cur.phase, 'reveal');

  const read = async (uid, path) => (await get(at(db(uid), path))).val();
  // g1: wager 20% of 1000 = 200, right on a hard question: (100 + 200) x 2 = 600. One team in two was right: a push.
  assert.deepEqual(await read('alice', 'score/g1'), { pts: 1600, ok: 1, rank: 1, of: 2 });
  assert.deepEqual(await read('erin', 'score/g1'), { pts: 1600, ok: 1, rank: 1, of: 2 }); // the latecomer shares the team's score
  assert.deepEqual(await read('dan', 'score/g2'), { pts: 900, ok: 0, rank: 2, of: 2 }); // wager 10% = 100, lost
  await assertFails(get(at(db('carol'), 'score/g1'))); // someone else's
  assert.equal((await read('bob', 'res/q1')).majority, 'push');
  assert.equal((await read('bob', 'out/q1/g1')).bet, 'right');
  assert.equal((await read('bob', 'out/q1/g1')).side, 0);
  await assertFails(get(at(db('bob'), 'out/q1/g2'))); // someone else's

  // standings: the trailing team unlocks the token
  snap = await step(host);
  assert.deepEqual(snap.perk, { g2: { unlocked: true, used: false } });
  assert.deepEqual(await read('carol', 'perk/g2'), { unlocked: true, used: false });
  await assertFails(get(at(db('alice'), 'perk/g2'))); // someone else's

  // question 2 (easy, answer C): g2 spends Double Down on a 50% wager; g1 is split and its captain breaks the tie
  snap = await step(host);
  assert.equal(snap.cur.qid, 'q2');
  await assertFails(set(at(db('alice'), 'vote/q2/g1/alice/bid'), { pct: 10, tok: 'dd' })); // g1 has no token
  await vote('alice', 'g1', 'q2', 'bid', { pct: 0, ok: true });
  await vote('bob', 'g1', 'q2', 'bid', { pct: 0, ok: true });
  await vote('carol', 'g2', 'q2', 'bid', { pct: 50, tok: 'dd', ok: true });
  await vote('dan', 'g2', 'q2', 'bid', { pct: 50, tok: 'dd', ok: true });
  snap = await settle(host, 'answer');
  assert.equal(snap.bid.g2.token, 'dd');
  assert.equal('token' in snap.bid.g1, false);
  await vote('alice', 'g1', 'q2', 'ans', { v: 0, ok: true });
  await vote('bob', 'g1', 'q2', 'ans', { v: 1, ok: true });
  await vote('carol', 'g2', 'q2', 'ans', { v: 2, ok: true });
  await vote('dan', 'g2', 'q2', 'ans', { v: 2, ok: true });
  await settle(host, 'never');
  for (const [uid, g] of [['alice', 'g1'], ['carol', 'g2']]) await vote(uid, g, 'q2', 'side', { ok: true });
  snap = await settle(host, 'never');
  for (const [uid, g] of [['bob', 'g1'], ['dan', 'g2']]) await vote(uid, g, 'q2', 'side', { ok: true });
  snap = await settle(host, 'reveal');
  assert.equal(snap.ans.g1.v, 1); // question 2's captain is the second member, bob
  assert.equal((await read('alice', 'out/q2/g1')).ok, false);
  assert.equal((await read('carol', 'out/q2/g2')).main, 1100); // (100 + 450) x 1 x 2
  assert.deepEqual(await read('carol', 'score/g2'), { pts: 2000, ok: 1, rank: 1, of: 2 });
  assert.equal((await read('dan', 'perk/g2')).used, true);

  // to the end
  await step(host); // standings
  await step(host); // question 3
  await step(host); // answer
  await step(host); // reveal
  await step(host); // standings
  snap = await step(host);
  assert.equal(snap.cur.phase, 'final');
});
