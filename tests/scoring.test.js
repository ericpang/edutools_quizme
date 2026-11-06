import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_POINTS, SIDE_BET_STAKE, breakEven, classResult, clampPct, gainFor, rankSubjects, safetyNetUnlocks, settle, shares, stakes, tally, wagerOf } from '../js/scoring.js';

test('a wager is a floored share of the current score', () => {
  assert.equal(wagerOf(800, 50), 400);
  assert.equal(wagerOf(1234, 7), 86);
  assert.equal(wagerOf(1000, 0), 0);
  assert.equal(wagerOf(999, 100), 999);
});

test('the wager percentage is clamped to 0..max and floored', () => {
  assert.equal(clampPct(150), 100);
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct('abc'), 0);
  assert.equal(clampPct(33.9), 33);
  assert.equal(wagerOf(1000, 90, 50), 500); // the host lowered the cap to 50%
});

test('harder questions pay more per wagered point', () => {
  assert.equal(gainFor(400, 'easy'), BASE_POINTS + 400);
  assert.equal(gainFor(400, 'medium'), 750);
  assert.equal(gainFor(400, 'hard'), 1000);
  assert.equal(gainFor(0, 'medium'), 150); // even a zero wager earns the base points
});

test('break-even confidence is 50 / 40 / 33 per cent', () => {
  assert.deepEqual(['easy', 'medium', 'hard'].map(breakEven), [50, 40, 33]);
});

test('the README example: 800 points, medium, 50% wager', () => {
  const base = { score: 800, pct: 50, difficulty: 'medium' };
  assert.equal(settle({ ...base, correct: true }).pts, 800 + 750);
  assert.equal(settle({ ...base, correct: false }).pts, 800 - 400);
  assert.equal(settle({ ...base, correct: true, token: 'dd' }).pts, 800 + 1500); // Double Down
  assert.equal(settle({ ...base, correct: false, token: 'sh' }).pts, 800); // Shield refunds the wager
  assert.deepEqual(stakes({ ...base }), { wager: 400, ifRight: 750, ifRightDouble: 1500, ifWrong: -400 });
});

test('Double Down does nothing on a wrong answer and Shield nothing on a right one', () => {
  const base = { score: 800, pct: 50, difficulty: 'medium' };
  assert.equal(settle({ ...base, correct: false, token: 'dd' }).main, -400);
  assert.equal(settle({ ...base, correct: true, token: 'sh' }).main, 750);
});

test('no bid means no wager, so an unanswered question costs nothing', () => {
  const r = settle({ score: 700, difficulty: 'hard', correct: false });
  assert.equal(r.wager, 0);
  assert.equal(r.pts, 700);
});

test('the score never drops below zero', () => {
  const r = settle({ score: 100, pct: 100, difficulty: 'easy', correct: false, bet: 'right', majority: 'wrong' });
  assert.equal(r.main, -100);
  assert.equal(r.side, -50);
  assert.equal(r.pts, 0); // 100 - 100 - 50 would be -50
  assert.equal(r.delta, -100); // the real change, after the floor
});

test('side-bets pay the stake at even odds, push on a tie, and cap at the score', () => {
  const base = { score: 1000, difficulty: 'easy', correct: true };
  assert.equal(settle({ ...base, bet: 'right', majority: 'right' }).side, SIDE_BET_STAKE);
  assert.equal(settle({ ...base, bet: 'wrong', majority: 'right' }).side, -SIDE_BET_STAKE);
  assert.equal(settle({ ...base, bet: 'right', majority: 'push' }).side, 0);
  assert.equal(settle({ ...base, bet: 'none', majority: 'right' }).side, 0);
  assert.equal(settle({ ...base, bet: null, majority: 'right' }).side, 0);
  assert.equal(settle({ score: 20, difficulty: 'easy', correct: false, bet: 'right', majority: 'right' }).side, 20); // stake = min(50, score)
});

test('class result: more than half right, exactly half is a push', () => {
  assert.equal(classResult(2, 3), 'right');
  assert.equal(classResult(1, 3), 'wrong');
  assert.equal(classResult(1, 2), 'push');
  assert.equal(classResult(0, 0), 'push');
  assert.equal(classResult(5, 10), 'push');
});

test('tally counts valid options only', () => {
  assert.deepEqual(tally([0, 1, 1, 3, 9, -1, undefined, '2'], 4), { counts: [1, 2, 0, 1], answered: 4 });
  assert.deepEqual(shares([1, 2, 0, 1], 4), [25, 50, 0, 25]);
  assert.deepEqual(shares([0, 0], 0), [0, 0]);
});

test('ranking: score, then right answers, then join order; ties share a rank', () => {
  const ranked = rankSubjects([
    { id: 'a', pts: 900, ok: 2, order: 0 },
    { id: 'b', pts: 1200, ok: 1, order: 1 },
    { id: 'c', pts: 900, ok: 3, order: 2 },
    { id: 'd', pts: 900, ok: 2, order: 3 },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 3]);
});

const field = (n) => rankSubjects(Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, pts: 2000 - i * 10, ok: 0, order: i })));
const everyone = (n) => new Set(Array.from({ length: n }, (_, i) => `p${i + 1}`));

test('the Safety Net goes to the bottom 30%, and at least one player', () => {
  const size = (n) => safetyNetUnlocks(field(n), { online: everyone(n), unlocked: new Set() }).length;
  assert.deepEqual([2, 3, 4, 9, 10, 20].map(size), [1, 1, 1, 2, 3, 6]);
  assert.deepEqual(safetyNetUnlocks(field(10), { online: everyone(10), unlocked: new Set() }), ['p8', 'p9', 'p10']);
});

test('the Safety Net skips players who already have a token and players who are offline', () => {
  const picks = safetyNetUnlocks(field(10), { online: everyone(10), unlocked: new Set(['p10']) });
  assert.deepEqual(picks, ['p8', 'p9']);
  const online = everyone(8); // p9 and p10 have left: the bottom 30% is worked out among the 8 still playing
  assert.deepEqual(safetyNetUnlocks(field(10), { online, unlocked: new Set() }), ['p7', 'p8']);
});

test('a lone player gets no Safety Net', () => {
  assert.deepEqual(safetyNetUnlocks(field(1), { online: everyone(1), unlocked: new Set() }), []);
});
