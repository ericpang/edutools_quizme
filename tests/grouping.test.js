import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GROUP_COLORS, formGroups, groupColor, groupLabel, groupNumber, isGroupId, smallestGroup } from '../js/grouping.js';

const uids = (n) => Array.from({ length: n }, (_, i) => `u${i + 1}`);
const sizes = (assignment) => {
  const count = {};
  for (const g of Object.values(assignment)) count[g] = (count[g] ?? 0) + 1;
  return Object.values(count);
};

test('group sizes never differ by more than one, and there are always at least two groups', () => {
  for (let n = 2; n <= 40; n++) {
    for (const size of [2, 3, 4, 5, 6]) {
      const assignment = formGroups(uids(n), size);
      const s = sizes(assignment);
      assert.equal(Object.keys(assignment).length, n, `everyone is placed (n=${n})`);
      assert.ok(Math.max(...s) - Math.min(...s) <= 1, `balanced (n=${n}, size=${size}): ${s}`);
      assert.ok(s.length >= 2, `at least two groups (n=${n}, size=${size})`);
      assert.ok(Math.min(...s) >= 1);
    }
  }
});

test('the target size sets how many groups there are', () => {
  assert.equal(sizes(formGroups(uids(12), 4)).length, 3);
  assert.equal(sizes(formGroups(uids(13), 4)).length, 4);
  assert.equal(sizes(formGroups(uids(5), 6)).length, 2); // too few for one group of six: still two teams
});

test('a single player is not split, and nobody gives no groups', () => {
  assert.deepEqual(formGroups(['solo'], 4), { solo: 'g1' });
  assert.deepEqual(formGroups([], 4), {});
});

test('shuffling is random but reproducible with a seeded generator', () => {
  const seeded = () => {
    let x = 7;
    return () => (x = (x * 16807) % 2147483647) / 2147483647;
  };
  assert.deepEqual(formGroups(uids(9), 3, seeded()), formGroups(uids(9), 3, seeded()));
  const seen = new Set(Array.from({ length: 30 }, () => JSON.stringify(formGroups(uids(8), 4))));
  assert.ok(seen.size > 1, 'different shuffles give different groups');
});

test('latecomers join the smallest group, the lowest number on a tie', () => {
  assert.equal(smallestGroup({ a: 'g1', b: 'g1', c: 'g2' }), 'g2');
  assert.equal(smallestGroup({ a: 'g1', b: 'g2' }), 'g1');
  assert.equal(smallestGroup({ a: 'g3', b: 'g3', c: 'g1', d: 'g1' }), 'g2'); // g2 is empty
  assert.equal(smallestGroup({}), null);
});

test('group ids never look like Firebase uids', () => {
  assert.ok(isGroupId('g1') && isGroupId('g12'));
  assert.ok(!isGroupId('G1') && !isGroupId('g') && !isGroupId('g123') && !isGroupId('qKm3xUidLikeThing'));
  assert.equal(groupNumber('g7'), 7);
  assert.equal(groupLabel('g7'), 'Group 7');
  assert.equal(groupColor('g1'), GROUP_COLORS[0]);
  assert.equal(groupColor(`g${GROUP_COLORS.length + 1}`), GROUP_COLORS[0]); // the palette repeats
});
