import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_RE, isCode, makeCode, normalizeCode } from '../js/codes.js';

test('codes are six characters from the unambiguous alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const code = makeCode();
    assert.match(code, CODE_RE);
    assert.doesNotMatch(code, /[ILO01]/);
  }
});

test('codes use the whole alphabet, not just a few letters', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) for (const ch of makeCode()) seen.add(ch);
  assert.equal(seen.size, 31);
});

test('typed codes are tidied up before they are checked', () => {
  assert.equal(normalizeCode(' abc-234 '), 'ABC234');
  assert.equal(normalizeCode(null), '');
  assert.ok(isCode('ABC234'));
  assert.ok(!isCode('ABC23'));
  assert.ok(!isCode('ABC23O')); // letter O is not in the alphabet
  assert.ok(!isCode('abc234'));
});
