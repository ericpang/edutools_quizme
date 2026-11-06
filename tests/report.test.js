import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALIBRATED, OVER, UNDER, calibration, verdictOf } from '../js/report.js';

test('a verdict needs a gap of more than 15 points either way', () => {
  assert.equal(verdictOf(70, 50), OVER);
  assert.equal(verdictOf(30, 60), UNDER);
  assert.equal(verdictOf(50, 60), CALIBRATED);
  assert.equal(verdictOf(65, 50), CALIBRATED); // exactly 15 is within the tolerance
});

test('nothing played means no report', () => {
  assert.equal(calibration([]), null);
});

test('the report compares average wager with accuracy, overall and per category', () => {
  const report = calibration([
    { category: 'History', pct: 80, ok: false },
    { category: 'History', pct: 60, ok: false },
    { category: 'Maths', pct: 10, ok: true },
    { category: 'Maths', pct: 20, ok: true },
    { category: 'Maths', pct: 30, ok: true },
  ]);
  assert.deepEqual(report.overall, { n: 5, accuracy: 60, wager: 40, verdict: UNDER }); // right 60% of the time, wagering 40%
  assert.deepEqual(report.categories.map((c) => [c.category, c.n, c.accuracy, c.wager, c.verdict]), [
    ['Maths', 3, 100, 20, UNDER],
    ['History', 2, 0, 70, OVER],
  ]);
});
