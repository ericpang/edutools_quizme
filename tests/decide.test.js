import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captainOf, isDone, lowerMedian, resolveAnswer, resolveBid, resolveSide } from '../js/decide.js';

test('the lower median takes the cautious middle of an even count', () => {
  assert.equal(lowerMedian([]), 0);
  assert.equal(lowerMedian([40]), 40);
  assert.equal(lowerMedian([20, 80]), 20);
  assert.equal(lowerMedian([10, 90, 30]), 30);
  assert.equal(lowerMedian([70, 10, 50, 30]), 30);
});

test('the captain rotates with the question number', () => {
  const members = ['ana', 'ben', 'cleo'];
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => captainOf(members, n)), ['ana', 'ben', 'cleo', 'ana', 'ben']);
  assert.equal(captainOf([], 1), null);
  assert.equal(captainOf(members, 0), 'ana');
});

test('the group wager is the lower median of the votes', () => {
  assert.deepEqual(resolveBid({ a: { pct: 80 }, b: { pct: 20 }, c: { pct: 40 } }), { pct: 40 });
  assert.deepEqual(resolveBid({ a: { pct: 80 }, b: { pct: 20 } }), { pct: 20 });
  assert.deepEqual(resolveBid({ a: { pct: 90 } }, { maxWager: 50 }), { pct: 50 });
  assert.equal(resolveBid({}), null);
  assert.equal(resolveBid({ a: { ok: true } }), null); // a Ready with no wager is not a vote
});

test('a token is used only when more than half of the voters choose the same effect', () => {
  const votes = (...toks) => Object.fromEntries(toks.map((tok, i) => [`m${i}`, { pct: 30, tok }]));
  assert.equal(resolveBid(votes('dd', 'dd', 'sh'), { canToken: true }).token, 'dd');
  assert.equal(resolveBid(votes('sh', 'sh', undefined), { canToken: true }).token, 'sh');
  assert.equal(resolveBid(votes('dd', 'sh', undefined), { canToken: true }).token, undefined);
  assert.equal(resolveBid(votes('dd', 'dd', 'sh', 'sh'), { canToken: true }).token, undefined); // exactly half is not more than half
  assert.equal(resolveBid(votes('dd', 'dd', 'dd'), { canToken: false }).token, undefined); // the group has no token to spend
});

test('the group answer is the most voted option', () => {
  assert.equal(resolveAnswer({ a: { v: 2 }, b: { v: 2 }, c: { v: 0 } }, 'c'), 2);
  assert.equal(resolveAnswer({}, 'a'), null);
  assert.equal(resolveAnswer({ a: { ok: true } }, 'a'), null);
  assert.equal(resolveAnswer({ a: { v: 9 } }, 'a'), null); // not an option
});

test('a tied answer goes to the captain, else to the lowest option', () => {
  const votes = { a: { v: 3 }, b: { v: 1 }, c: { v: 2 } };
  assert.equal(resolveAnswer(votes, 'a'), 3);
  assert.equal(resolveAnswer(votes, 'c'), 2);
  assert.equal(resolveAnswer(votes, 'nobody'), 1);
  const split = { a: { v: 3 }, b: { v: 3 }, c: { v: 1 }, d: { v: 1 }, e: { v: 0 } };
  assert.equal(resolveAnswer(split, 'e'), 1); // the captain voted for an option that is not tied: lowest tied option
  assert.equal(resolveAnswer(split, 'a'), 3);
});

test('the group side-bet is the majority view; a tie or no vote means no bet', () => {
  assert.equal(resolveSide({ a: { v: 'right' }, b: { v: 'right' }, c: { v: 'wrong' } }), 'right');
  assert.equal(resolveSide({ a: { v: 'wrong' } }), 'wrong');
  assert.equal(resolveSide({ a: { v: 'right' }, b: { v: 'wrong' } }), 'none');
  assert.equal(resolveSide({ a: { v: 'none' }, b: { ok: true } }), 'none');
  assert.equal(resolveSide({}), 'none');
});

test('a group is done when more than half of its online members are Ready', () => {
  const players = { a: { on: true }, b: { on: true }, c: { on: true }, d: { on: false } };
  const members = ['a', 'b', 'c', 'd'];
  const ready = (...who) => Object.fromEntries(who.map((uid) => [uid, { ok: true }]));
  assert.equal(isDone(ready('a'), members, players), false);
  assert.equal(isDone(ready('a', 'b'), members, players), true); // 2 of the 3 online
  assert.equal(isDone(ready('a', 'd'), members, players), false); // an offline member's Ready does not count
  assert.equal(isDone({ a: { ok: false } }, members, players), false);
  assert.equal(isDone(ready('a'), ['a'], players), true);
  assert.equal(isDone(ready('d'), ['d'], players), false); // nobody online
});
