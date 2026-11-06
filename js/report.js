// The calibration report shown at the end: did the wagers match how often the answers were right? (pure)
// A wager is the player's stated confidence, so the average wager is compared with the share of right answers.

export const OVER = 'over';
export const UNDER = 'under';
export const CALIBRATED = 'calibrated';
const TOLERANCE = 15; // percentage points of gap that still counts as well calibrated

export function verdictOf(wager, accuracy) {
  if (wager - accuracy > TOLERANCE) return OVER;
  if (accuracy - wager > TOLERANCE) return UNDER;
  return CALIBRATED;
}

function summarize(rows) {
  const n = rows.length;
  const accuracy = Math.round((100 * rows.filter((r) => r.ok).length) / n);
  const wager = Math.round(rows.reduce((sum, r) => sum + r.pct, 0) / n);
  return { n, accuracy, wager, verdict: verdictOf(wager, accuracy) };
}

// rows: [{ category, pct, ok }], one per question played. Null when there is nothing to report.
export function calibration(rows) {
  if (!rows.length) return null;
  const byCategory = new Map();
  for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  const categories = [...byCategory]
    .map(([category, list]) => ({ category, ...summarize(list) }))
    .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  return { overall: summarize(rows), categories };
}
