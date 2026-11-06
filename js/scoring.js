// The scoring rules as pure functions (no DOM, no Firebase), so CI can test them. README.md explains the design.
// Points never depend on how fast anyone answers; the timers below only pace the game.

// ---- tunable defaults (untested starting points: tune them in playtests)
export const START_POINTS = 1000;
export const BASE_POINTS = 100; // flat reward added to the wager on a right answer
export const DIFFICULTY_MULT = { easy: 1, medium: 1.5, hard: 2 };
export const DIFFICULTIES = Object.keys(DIFFICULTY_MULT);
export const MAX_WAGER_PCT = 100;
export const SIDE_BET_STAKE = 50;
export const SAFETY_NET_SHARE = 0.3; // bottom share of the ranking that unlocks a token
export const STATS_MIN_ANSWERS = 3; // answers needed before live class stats are shown
export const GROUP_SIZE = 4;
export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 6;
export const MIN_PLAYERS = { solo: 1, group: 4 }; // group mode needs two groups of at least two

// Seconds per phase (a question's own timeLimitSec replaces the answer time). Teams get longer to talk.
export const PACING = { solo: { bid: 10, answer: 20 }, group: { bid: 20, answer: 40 } };

// ---- wagers
export const clampPct = (pct, max = MAX_WAGER_PCT) => Math.min(max, Math.max(0, Math.floor(Number(pct) || 0)));
export const wagerOf = (score, pct, max = MAX_WAGER_PCT) => Math.floor((score * clampPct(pct, max)) / 100);
export const multiplier = (difficulty) => DIFFICULTY_MULT[difficulty] ?? 1;
export const gainFor = (wager, difficulty) => Math.round((BASE_POINTS + wager) * multiplier(difficulty));

// Confidence (in %) above which extra wager pays off on average: 50 (easy), 40 (medium), 33 (hard).
export const breakEven = (difficulty) => Math.round(100 / (1 + multiplier(difficulty)));

// What a wager could win or lose, shown while bidding.
export function stakes({ score, pct, difficulty, max = MAX_WAGER_PCT }) {
  const wager = wagerOf(score, pct, max);
  const ifRight = gainFor(wager, difficulty);
  return { wager, ifRight, ifRightDouble: ifRight * 2, ifWrong: 0 - wager };
}

// ---- one question, one subject (a player, or a group)
// token: 'dd' (Double Down) doubles the gain on a right answer, 'sh' (Shield) refunds the wager on a wrong one.
// bet: 'right' | 'wrong' on whether most of the class got it right; majority: how the class actually did.
export function settle({ score, pct = 0, max = MAX_WAGER_PCT, difficulty, token = null, correct, bet = null, majority = 'push' }) {
  const wager = wagerOf(score, pct, max);
  let main;
  if (correct) main = gainFor(wager, difficulty) * (token === 'dd' ? 2 : 1);
  else main = token === 'sh' ? 0 : 0 - wager; // (0 - wager, so a zero wager is 0 and not -0)

  const stake = Math.min(SIDE_BET_STAKE, score);
  let side = 0;
  if ((bet === 'right' || bet === 'wrong') && majority !== 'push') side = bet === majority ? stake : -stake;

  const pts = Math.max(0, score + main + side);
  return { wager, main, side, stake, pts, delta: pts - score };
}

// More than half of the answers right = 'right', exactly half = 'push' (stakes come back), fewer = 'wrong'.
export function classResult(correct, answered) {
  if (!answered) return 'push';
  if (correct * 2 > answered) return 'right';
  if (correct * 2 === answered) return 'push';
  return 'wrong';
}

// Count the answers per option; anything that is not a valid option index is ignored.
export function tally(picks, optionCount) {
  const counts = new Array(optionCount).fill(0);
  let answered = 0;
  for (const v of picks) {
    if (Number.isInteger(v) && v >= 0 && v < optionCount) {
      counts[v]++;
      answered++;
    }
  }
  return { counts, answered };
}

export const shares = (counts, answered) => counts.map((c) => (answered ? Math.round((100 * c) / answered) : 0));

// ---- leaderboard and the Safety Net
// rows: [{ id, pts, ok, order }]. Order: score, then right answers, then who joined first. Equal score and right
// answers share a rank.
export function rankSubjects(rows) {
  const sorted = [...rows].sort((a, b) => b.pts - a.pts || b.ok - a.ok || a.order - b.order);
  return sorted.map((row) => ({
    ...row,
    rank: 1 + sorted.filter((o) => o.pts > row.pts || (o.pts === row.pts && o.ok > row.ok)).length,
  }));
}

// Who unlocks a token after standings: the last max(1, floor(30%)) of the players who are online, if they do not have
// one yet. `sorted` comes from rankSubjects; `online` and `unlocked` are Sets of subject ids.
export function safetyNetUnlocks(sorted, { online, unlocked }) {
  const field = sorted.filter((row) => online.has(row.id));
  if (field.length < 2) return [];
  const bottom = Math.max(1, Math.floor(field.length * SAFETY_NET_SHARE + 1e-9));
  return field
    .slice(-bottom)
    .filter((row) => !unlocked.has(row.id))
    .map((row) => row.id);
}
