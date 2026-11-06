import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOST_GRACE_MS, SIDE_GRACE_MS, TS, advance, autoStep, canStart, finishPatch, leaderboard, progress, removePatch, shufflePatch, startPatch, statsFor, subjectsOf, toAnswer, toNext, toReveal, toStandings } from '../js/engine.js';

const NOW = 1_000_000;
const quiz = {
  q1: { category: 'Maths', difficulty: 'medium', text: 'What is 6 x 7?', options: ['41', '42', '43', '44'], correct: 1 },
  q2: { category: 'History', difficulty: 'hard', text: 'Who?', options: ['A', 'B'], correct: 0, timeLimitSec: 30, explanation: 'Because.' },
  q3: { category: 'Maths', difficulty: 'easy', text: 'Easy?', options: ['yes', 'no'], correct: 0 },
};
const meta = (over = {}) => ({ owner: 'host', title: 'T', mode: 'solo', groupSize: 2, maxWager: 100, open: true, ...over });
const people = (...names) => Object.fromEntries(names.map((n, i) => [n, { name: n, on: true, ts: 100 + i }]));
const state = (over = {}) => ({ meta: meta(), cur: { phase: 'lobby', n: 0, total: 3 }, players: people('ana', 'ben', 'cleo'), group: {}, quiz, score: {}, perk: {}, bid: {}, ans: {}, side: {}, vote: {}, stats: null, ...over });
// A running game on question 1 (ana 800, ben 1000, cleo 1200 points); `cur` and `score` are merged into the defaults.
const live = (phase, { cur = {}, score = {}, ...rest } = {}) =>
  state({
    cur: { qid: 'q1', n: 1, total: 3, phase, category: 'Maths', difficulty: 'medium', deadline: NOW + 5000, ...cur },
    score: { ana: { pts: 800, ok: 0 }, ben: { pts: 1000, ok: 0 }, cleo: { pts: 1200, ok: 0 }, ...score },
    ...rest,
  });
// The same in group mode: g1 = ana + ben, g2 = cleo + dan, 1000 points each.
const grouped = ({ cur = {}, score = {}, ...rest } = {}) =>
  live(cur.phase ?? 'bid', { cur, meta: meta({ mode: 'group' }), players: people('ana', 'ben', 'cleo', 'dan'), group: { ana: 'g1', ben: 'g1', cleo: 'g2', dan: 'g2' }, score: { ana: undefined, ben: undefined, cleo: undefined, g1: { pts: 1000, ok: 0 }, g2: { pts: 1000, ok: 0 }, ...score }, ...rest });
const seeded = () => {
  let x = 11;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
};

// ---- who is playing
test('solo subjects are the players in join order, group subjects are the groups', () => {
  const players = { zed: { name: 'z', on: true, ts: 5 }, amy: { name: 'a', on: false, ts: 5 }, bob: { name: 'b', on: true, ts: 1 } };
  assert.deepEqual(subjectsOf({ meta: meta(), players }).map((s) => [s.id, s.online]), [['bob', true], ['amy', false], ['zed', true]]);
  const group = { amy: 'g2', bob: 'g1', zed: 'g2' };
  const subs = subjectsOf({ meta: meta({ mode: 'group' }), players, group });
  assert.deepEqual(subs.map((s) => [s.id, s.members, s.online]), [['g1', ['bob'], true], ['g2', ['amy', 'zed'], true]]);
  assert.equal(subjectsOf({ meta: meta({ mode: 'group' }), players, group: { amy: 'g1' } })[0].online, false);
});

test('players without a group are not subjects yet', () => {
  const subs = subjectsOf({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c'), group: { a: 'g1', b: 'g1' } });
  assert.deepEqual(subs.map((s) => s.members), [['a', 'b']]);
});

test('solo can start with one player, group mode needs four', () => {
  assert.equal(canStart(state({ players: people('a') })).ok, true);
  assert.equal(canStart(state({ players: {} })).ok, false);
  assert.equal(canStart(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c') })).ok, false);
  assert.match(canStart(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c') })).reason, /at least 4/);
  assert.equal(canStart(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c', 'd') })).ok, true);
  const offline = people('a', 'b', 'c', 'd');
  offline.d.on = false;
  assert.equal(canStart(state({ meta: meta({ mode: 'group' }), players: offline })).ok, false); // only online players count
});

// ---- starting
test('starting a solo game gives everyone 1000 points, closes joining and opens the first bid', () => {
  const patch = startPatch(state(), NOW);
  assert.deepEqual(patch['score/ana'], { pts: 1000, ok: 0 });
  assert.deepEqual(Object.keys(patch).filter((k) => k.startsWith('score/')), ['score/ana', 'score/ben', 'score/cleo']);
  assert.equal(patch['meta/open'], false);
  assert.deepEqual(patch.cur, { qid: 'q1', n: 1, total: 3, phase: 'bid', category: 'Maths', difficulty: 'medium', deadline: NOW + 10_000 });
  assert.equal('text' in patch.cur, false); // the question stays hidden while players bid
  assert.equal('options' in patch.cur, false);
});

test('starting a group game forms the groups if the host did not shuffle, and keeps joining open', () => {
  const patch = startPatch(state({ meta: meta({ mode: 'group', groupSize: 4 }), players: people('a', 'b', 'c', 'd', 'e') }), NOW, seeded());
  assert.equal(Object.keys(patch.group).length, 5);
  assert.deepEqual(Object.keys(patch).filter((k) => k.startsWith('score/')), ['score/g1', 'score/g2']);
  assert.equal('meta/open' in patch, false);
  assert.equal(patch.cur.deadline, NOW + 20_000); // teams get longer to talk
});

test('starting keeps the shuffled groups and places latecomers', () => {
  const patch = startPatch(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c', 'd', 'e'), group: { a: 'g1', b: 'g1', c: 'g2', d: 'g2' } }), NOW, seeded());
  assert.equal('group' in patch, false);
  assert.equal(patch['group/e'], 'g1'); // g1 and g2 are the same size: the lower number wins
  assert.deepEqual(Object.keys(patch).filter((k) => k.startsWith('score/')), ['score/g1', 'score/g2']);
});

test('the host can shuffle only the players who are online, and only in group mode', () => {
  const players = people('a', 'b', 'c', 'd', 'e');
  players.e.on = false;
  const patch = shufflePatch(state({ meta: meta({ mode: 'group' }), players }), seeded());
  assert.deepEqual(Object.keys(patch.group).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(shufflePatch(state({ players }), seeded()), null);
  assert.equal(shufflePatch(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c') }), seeded()), null);
});

test('the lobby waits; a latecomer is placed in the smallest group', () => {
  assert.equal(autoStep(state(), NOW), null);
  const patch = autoStep(state({ meta: meta({ mode: 'group' }), players: people('a', 'b', 'c', 'd', 'e'), group: { a: 'g1', b: 'g1', c: 'g2', d: 'g2' } }), NOW);
  assert.deepEqual(patch, { 'group/e': 'g1' });
});

// ---- the bid
test('the bid phase waits for the deadline unless everyone has bid', () => {
  assert.equal(autoStep(live('bid'), NOW), null);
  const partial = live('bid', { bid: { ana: { pct: 10 } } });
  assert.equal(autoStep(partial, NOW), null);
  const done = live('bid', { bid: { ana: { pct: 10 }, ben: { pct: 0 }, cleo: { pct: 50 } } });
  assert.equal(autoStep(done, NOW).cur.phase, 'answer');
});

test('offline players are not waited for', () => {
  const players = people('ana', 'ben', 'cleo');
  players.cleo.on = false;
  const s = live('bid', { players, bid: { ana: { pct: 10 }, ben: { pct: 0 } } });
  assert.equal(autoStep(s, NOW).cur.phase, 'answer');
});

test('after the deadline the host waits a moment for writes that raced it, then moves on', () => {
  const s = live('bid', { cur: { deadline: NOW } });
  assert.equal(autoStep(s, NOW + HOST_GRACE_MS - 1), null);
  assert.equal(autoStep(s, NOW + HOST_GRACE_MS).cur.phase, 'answer');
});

test('with nobody online the host just waits for the deadline', () => {
  const players = people('ana');
  players.ana.on = false;
  assert.equal(autoStep(live('bid', { players }), NOW), null);
  assert.equal(autoStep(live('bid', { players, cur: { deadline: NOW - 5000 } }), NOW).cur.phase, 'answer');
});

test('the question appears when bidding ends, with its own time limit if it has one', () => {
  const answer = toAnswer(live('bid'), NOW).cur;
  assert.deepEqual(answer, { qid: 'q1', n: 1, total: 3, phase: 'answer', category: 'Maths', difficulty: 'medium', text: 'What is 6 x 7?', options: ['41', '42', '43', '44'], deadline: NOW + 20_000 });
  const q2 = toAnswer(live('bid', { cur: { qid: 'q2', n: 2 } }), NOW).cur;
  assert.equal(q2.deadline, NOW + 30_000);
});

// ---- the answer
test('live stats appear once enough answers are in, and are only rewritten when they change', () => {
  const two = live('answer', { ans: { ana: { v: 1, ts: NOW }, ben: { v: 2, ts: NOW } }, players: people('ana', 'ben', 'cleo', 'dan', 'eve') });
  assert.equal(autoStep(two, NOW), null); // 2 of 5 online: not enough to hide individuals
  const three = live('answer', { ans: { ana: { v: 1, ts: NOW }, ben: { v: 2, ts: NOW }, cleo: { v: 1, ts: NOW } }, players: people('ana', 'ben', 'cleo', 'dan', 'eve') });
  assert.deepEqual(autoStep(three, NOW), { 'stats/q1': { answered: 3, total: 5, counts: [0, 2, 1, 0] } });
  assert.equal(autoStep({ ...three, stats: { answered: 3, total: 5, counts: [0, 2, 1, 0] } }, NOW), null);
});

test('in a tiny class the stats wait until everyone has answered', () => {
  const s = live('answer', { players: people('ana', 'ben'), ans: { ana: { v: 1, ts: NOW } } });
  assert.equal(autoStep(s, NOW), null);
  assert.equal(statsFor(s).answered, 1);
});

test('the answer phase ends when everyone has answered and settled their side-bet', () => {
  const ans = { ana: { v: 1, ts: NOW }, ben: { v: 2, ts: NOW }, cleo: { v: 1, ts: NOW } };
  assert.equal(autoStep(live('answer', { ans }), NOW + 100)?.cur ?? null, null); // everyone answered, bets still open: stats only
  const side = { ana: { v: 'right' }, ben: { v: 'none' }, cleo: { v: 'wrong' } };
  assert.equal(autoStep(live('answer', { ans, side }), NOW + 100).cur.phase, 'reveal');
});

test('once everyone has answered, the last side-bets get a few seconds, not the whole clock', () => {
  const ans = { ana: { v: 1, ts: NOW }, ben: { v: 2, ts: NOW }, cleo: { v: 1, ts: NOW + 2000 } };
  const s = live('answer', { ans, cur: { deadline: NOW + 60_000 } });
  assert.equal(autoStep(s, NOW + 2000 + SIDE_GRACE_MS.solo - 1)?.cur ?? null, null);
  assert.equal(autoStep(s, NOW + 2000 + SIDE_GRACE_MS.solo).cur.phase, 'reveal');
});

test('someone who has not answered keeps the phase open until the deadline', () => {
  const s = live('answer', { ans: { ana: { v: 1, ts: NOW }, ben: { v: 2, ts: NOW } }, cur: { deadline: NOW + 60_000 } });
  assert.equal(autoStep(s, NOW + 30_000)?.cur ?? null, null);
  assert.equal(autoStep(s, NOW + 60_000 + HOST_GRACE_MS).cur.phase, 'reveal');
});

// ---- the reveal
test('scoring a question: the README example, and unanswered questions cost nothing', () => {
  const s = live('answer', {
    bid: { ana: { pct: 50 }, ben: { pct: 20 } },
    ans: { ana: { v: 1, ts: 1 }, ben: { v: 0, ts: 1 } }, // cleo does not answer and has no bid
  });
  const patch = toReveal(s);
  assert.deepEqual(patch['score/ana'], { pts: 1550, ok: 1, rank: 1, of: 3 }); // 800 + (100 + 400) x 1.5
  assert.deepEqual(patch['score/ben'], { pts: 800, ok: 0, rank: 3, of: 3 }); // 1000 - 200
  assert.deepEqual(patch['score/cleo'], { pts: 1200, ok: 0, rank: 2, of: 3 }); // no answer, no wager, no change
  assert.deepEqual(patch['out/q1/ana'], { pick: 1, ok: true, pct: 50, wager: 400, main: 750, side: 0, pts: 1550 });
  assert.deepEqual(patch['out/q1/ben'], { pick: 0, ok: false, pct: 20, wager: 200, main: -200, side: 0, pts: 800 });
  assert.deepEqual(patch['out/q1/cleo'], { pick: -1, ok: false, pct: 0, wager: 0, main: 0, side: 0, pts: 1200 });
  assert.deepEqual(patch['res/q1'], { correct: 1, counts: [1, 1, 0, 0], answered: 2, total: 3, accuracy: 50, majority: 'push', category: 'Maths', difficulty: 'medium' });
  assert.deepEqual(patch.cur, { qid: 'q1', n: 1, total: 3, phase: 'reveal', category: 'Maths', difficulty: 'medium', text: 'What is 6 x 7?', options: ['41', '42', '43', '44'] });
  assert.equal('deadline' in patch.cur, false);
});

test('side-bets are settled against how the class actually did', () => {
  const s = live('answer', {
    bid: {},
    ans: { ana: { v: 1, ts: 1 }, ben: { v: 1, ts: 1 }, cleo: { v: 0, ts: 1 } }, // 2 of 3 right: the majority is right
    side: { ana: { v: 'right' }, ben: { v: 'wrong' }, cleo: { v: 'none' } },
  });
  const patch = toReveal(s);
  assert.equal(patch['res/q1'].majority, 'right');
  assert.equal(patch['out/q1/ana'].side, 50);
  assert.equal(patch['out/q1/ana'].bet, 'right');
  assert.equal(patch['out/q1/ben'].side, -50);
  assert.equal(patch['out/q1/cleo'].side, 0);
  assert.equal('bet' in patch['out/q1/cleo'], false);
});

test('a token is spent when it is armed; one the player does not hold is ignored', () => {
  const s = live('answer', {
    perk: { ana: { unlocked: true, used: false } },
    bid: { ana: { pct: 50, token: 'dd' }, ben: { pct: 50, token: 'dd' } }, // ben has no token
    ans: { ana: { v: 1, ts: 1 }, ben: { v: 1, ts: 1 } },
  });
  const patch = toReveal(s);
  assert.equal(patch['out/q1/ana'].main, 1500);
  assert.equal(patch['out/q1/ana'].token, 'dd');
  assert.equal(patch['perk/ana/used'], true);
  assert.equal(patch['out/q1/ben'].main, 900); // 1000 points, 50% wager: (100 + 500) x 1.5, and no Double Down
  assert.equal('perk/ben/used' in patch, false);
  const spent = live('answer', { perk: { ana: { unlocked: true, used: true } }, bid: { ana: { pct: 50, token: 'dd' } }, ans: { ana: { v: 1, ts: 1 } } });
  assert.equal(toReveal(spent)['out/q1/ana'].main, 750); // already used
});

test('a Shield makes a wrong answer free', () => {
  const s = live('answer', { perk: { ben: { unlocked: true, used: false } }, bid: { ben: { pct: 80, token: 'sh' } }, ans: { ben: { v: 3, ts: 1 } } });
  const patch = toReveal(s);
  assert.equal(patch['out/q1/ben'].main, 0);
  assert.equal(patch['score/ben'].pts, 1000);
});

test('the wager cap set by the host applies', () => {
  const s = live('answer', { meta: meta({ maxWager: 50 }), bid: { ana: { pct: 100 } }, ans: { ana: { v: 0, ts: 1 } } });
  assert.deepEqual([s.meta.maxWager, toReveal(s)['out/q1/ana'].pct, toReveal(s)['out/q1/ana'].wager], [50, 50, 400]);
});

test('right answers are counted for the tie-break and the rank', () => {
  const s = live('answer', { ans: { ana: { v: 1, ts: 1 } }, score: { ana: { pts: 1000, ok: 2 }, ben: { pts: 1000, ok: 3 }, cleo: { pts: 500, ok: 0 } } });
  const patch = toReveal(s);
  assert.equal(patch['score/ana'].ok, 3);
  assert.equal(patch['score/ana'].pts, 1150); // right answer on a zero wager still earns the base points
  assert.equal(patch['score/ana'].rank, 1);
  assert.equal(patch['score/ben'].rank, 2);
});

// ---- standings, the next question and the end
test('after the standings the bottom 30% unlock a token', () => {
  const players = people('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10');
  const score = Object.fromEntries(Object.keys(players).map((id, i) => [id, { pts: 2000 - i * 100, ok: 0 }]));
  const patch = toStandings(live('reveal', { players, score, perk: { p10: { unlocked: true, used: true } } }));
  assert.deepEqual(Object.keys(patch).filter((k) => k.startsWith('perk/')).sort(), ['perk/p8', 'perk/p9']);
  assert.deepEqual(patch['perk/p9'], { unlocked: true, used: false });
  assert.equal(patch.cur.phase, 'standings');
  assert.equal(patch.cur.text, 'What is 6 x 7?'); // the question stays on screen
});

test('there is no token after the last question', () => {
  const patch = toStandings(live('reveal', { cur: { qid: 'q3', n: 3, total: 3 } }));
  assert.deepEqual(Object.keys(patch), ['cur']);
});

test('the next question starts a new bid; after the last one the game is over', () => {
  const next = toNext(live('standings'), NOW).cur;
  assert.deepEqual(next, { qid: 'q2', n: 2, total: 3, phase: 'bid', category: 'History', difficulty: 'hard', deadline: NOW + 10_000 });
  assert.deepEqual(toNext(live('standings', { cur: { qid: 'q3', n: 3 } }), NOW), { cur: { phase: 'final', n: 3, total: 3 } });
  assert.deepEqual(finishPatch(live('answer')).cur, { phase: 'final', n: 1, total: 3 });
});

test('"next" moves through every phase', () => {
  assert.equal(advance(state(), NOW).cur.phase, 'bid');
  assert.equal(advance(live('bid'), NOW).cur.phase, 'answer');
  assert.equal(advance(live('answer'), NOW).cur.phase, 'reveal');
  assert.equal(advance(live('reveal'), NOW).cur.phase, 'standings');
  assert.equal(advance(live('standings'), NOW).cur.phase, 'bid');
  assert.equal(advance(live('standings', { cur: { qid: 'q3', n: 3 } }), NOW).cur.phase, 'final');
  assert.equal(advance(state({ cur: { phase: 'final', n: 3, total: 3 } }), NOW), null);
});

test('reveal and standings wait for the host', () => {
  assert.equal(autoStep(live('reveal'), NOW + 999_999), null);
  assert.equal(autoStep(live('standings'), NOW + 999_999), null);
});

test('progress counts the online subjects that have bid or answered', () => {
  assert.deepEqual(progress(live('bid', { bid: { ana: { pct: 0 } } })), { done: 1, total: 3 });
  assert.deepEqual(progress(live('answer', { ans: { ana: { v: 0 }, ben: { v: 1 } } })), { done: 2, total: 3 });
  assert.equal(progress(live('reveal')), null);
});

test('the leaderboard is best first and names its members', () => {
  const rows = leaderboard(live('standings'));
  assert.deepEqual(rows.map((r) => [r.id, r.pts, r.rank]), [['cleo', 1200, 1], ['ben', 1000, 2], ['ana', 800, 3]]);
});

test('removing a player takes them out of their group and bars them', () => {
  assert.deepEqual(removePatch('zed'), { 'players/zed': null, 'group/zed': null, 'banned/zed': true });
});

// ---- group mode
test('a group that is Ready is resolved at once; the others are left to the clock', () => {
  const s = grouped({
    vote: {
      g1: { ana: { bid: { pct: 60, ok: true } }, ben: { bid: { pct: 20, ok: true } } },
      g2: { cleo: { bid: { pct: 90 } }, dan: { bid: { pct: 10, ok: true } } },
    },
  });
  const patch = autoStep(s, NOW);
  assert.deepEqual(patch, { 'bid/q1/g1': { pct: 20, ts: TS } }); // lower median of 60 and 20
});

test('when the clock runs out every group is settled from the votes it has', () => {
  const s = grouped({
    cur: { deadline: NOW - 5000 },
    vote: { g1: { ana: { bid: { pct: 60 } }, ben: { bid: { pct: 20 } } }, g2: { cleo: { bid: { pct: 90 } } } },
  });
  const patch = autoStep(s, NOW);
  assert.equal(patch['bid/q1/g1'].pct, 20);
  assert.equal(patch['bid/q1/g2'].pct, 90);
  assert.equal(patch.cur.phase, 'answer');
});

test('a group token is used when most voters want it, and only if the group holds one', () => {
  const vote = { g1: { ana: { bid: { pct: 50, tok: 'sh' } }, ben: { bid: { pct: 50, tok: 'sh' } } } };
  const withToken = toAnswer(grouped({ vote, perk: { g1: { unlocked: true, used: false } } }), NOW);
  assert.equal(withToken['bid/q1/g1'].token, 'sh');
  assert.equal('token' in toAnswer(grouped({ vote }), NOW)['bid/q1/g1'], false);
});

test('a group answers with the majority vote; a tie goes to the captain', () => {
  // question 1: the captain is the first member to join (ana)
  const tie = grouped({ cur: { phase: 'answer' }, vote: { g1: { ana: { ans: { v: 3 } }, ben: { ans: { v: 1 } } } } });
  assert.equal(toReveal(tie)['out/q1/g1'].pick, 3);
  // question 2: the captain is ben
  const second = grouped({ cur: { qid: 'q2', n: 2, phase: 'answer' }, vote: { g1: { ana: { ans: { v: 0 } }, ben: { ans: { v: 1 } } } } });
  assert.equal(toReveal(second)['out/q2/g1'].pick, 1);
});

test('group answers and side-bets are written when the group is Ready, and the phase ends when all groups are', () => {
  const ready = (v) => ({ ans: { v, ok: true } });
  const s = grouped({
    cur: { phase: 'answer' },
    bid: { g1: { pct: 0 }, g2: { pct: 0 } },
    vote: { g1: { ana: ready(1), ben: ready(1) }, g2: { cleo: ready(0), dan: ready(0) } },
  });
  const first = autoStep(s, NOW);
  assert.deepEqual(first['ans/q1/g1'], { v: 1, ts: TS });
  assert.deepEqual(first['ans/q1/g2'], { v: 0, ts: TS });
  // then the groups settle their side-bets
  const settled = grouped({
    cur: { phase: 'answer' },
    bid: { g1: { pct: 0 }, g2: { pct: 0 } },
    ans: { g1: { v: 1, ts: NOW }, g2: { v: 0, ts: NOW } },
    vote: { g1: { ana: { side: { v: 'right', ok: true } }, ben: { side: { ok: true } } }, g2: { cleo: { side: { v: 'wrong', ok: true } }, dan: { side: { v: 'wrong', ok: true } } } },
  });
  const done = autoStep(settled, NOW);
  assert.equal(done.cur.phase, 'reveal');
  assert.equal(done['out/q1/g1'].bet, 'right');
  assert.equal(done['out/q1/g2'].bet, 'wrong');
});

test('a group cannot bet before it has answered', () => {
  const s = grouped({ cur: { phase: 'answer' }, vote: { g1: { ana: { side: { v: 'right', ok: true } }, ben: { side: { v: 'right', ok: true } } } } });
  const patch = autoStep(s, NOW);
  assert.equal(patch === null || !('side/q1/g1' in patch), true);
});

test('group scores are keyed by group and ranked as groups', () => {
  const s = grouped({
    cur: { phase: 'answer' },
    bid: { g1: { pct: 40 }, g2: { pct: 0 } },
    ans: { g1: { v: 1, ts: 1 }, g2: { v: 2, ts: 1 } },
  });
  const patch = toReveal(s);
  assert.deepEqual(patch['score/g1'], { pts: 1000 + Math.round((100 + 400) * 1.5), ok: 1, rank: 1, of: 2 });
  assert.deepEqual(patch['score/g2'], { pts: 1000, ok: 0, rank: 2, of: 2 });
  assert.equal(Object.keys(patch).some((k) => k.endsWith('/ana')), false);
});

test('a group is online while any member is, and waited for', () => {
  const players = people('ana', 'ben', 'cleo', 'dan');
  players.cleo.on = false;
  players.dan.on = false;
  const s = grouped({ players, vote: { g1: { ana: { bid: { pct: 10, ok: true } }, ben: { bid: { pct: 10, ok: true } } } } });
  assert.equal(autoStep(s, NOW).cur.phase, 'answer'); // g2 is entirely offline, so g1 alone is enough
  assert.deepEqual(progress({ ...s, bid: { g1: { pct: 10 } } }), { done: 1, total: 1 });
});
