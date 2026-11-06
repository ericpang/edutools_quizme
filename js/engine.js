// The host's brain as pure functions: given a snapshot of the room and the server time, work out what to write next.
// js/host.js runs it in a loop and js/room.js does the writing, so nothing here touches Firebase or the DOM.
//
// A snapshot ("state") is { meta, cur, players, group, quiz, score, perk, bid, ans, side, vote, stats }. The last five
// belong to cur.qid only. A "patch" is { 'path/under/the/room': value }, written as one atomic update().
// A subject is whoever scores: a player's uid in solo mode, a group id ('g1', ...) in group mode.
import { MIN_PLAYERS, PACING, START_POINTS, STATS_MIN_ANSWERS, classResult, clampPct, rankSubjects, safetyNetUnlocks, settle, tally } from './scoring.js';
import { captainOf, isDone, resolveAnswer, resolveBid, resolveSide } from './decide.js';
import { formGroups, groupNumber, smallestGroup } from './grouping.js';

export const TS = { '.sv': 'timestamp' }; // what serverTimestamp() is, so this file needs no Firebase import
export const HOST_GRACE_MS = 1200; // after a deadline, wait for writes that raced it (the rules accept them for 2 s)
export const SIDE_GRACE_MS = { solo: 6000, group: 12000 }; // once everyone has answered, time left for the side-bet

const modeOf = (state) => (state.meta?.mode === 'group' ? 'group' : 'solo');
const questionOf = (state) => state.quiz?.[state.cur?.qid];
const hasToken = (state, id) => state.perk?.[id]?.unlocked === true && state.perk?.[id]?.used !== true;
const byJoin = ([ua, a], [ub, b]) => (a.ts ?? 0) - (b.ts ?? 0) || (ua < ub ? -1 : ua > ub ? 1 : 0);
const onlineUids = (state) => Object.entries(state.players ?? {}).filter(([, p]) => p.on === true).sort(byJoin).map(([uid]) => uid);

// ---- who is playing
// [{ id, members, online, order }]: members in join order; a group counts as online while any member is.
export function subjectsOf({ meta, players = {}, group = {} }) {
  const joined = Object.entries(players).sort(byJoin);
  if (meta?.mode !== 'group') return joined.map(([uid, p], order) => ({ id: uid, members: [uid], online: p.on === true, order }));
  const byGroup = new Map();
  for (const [uid] of joined) if (group[uid]) byGroup.set(group[uid], [...(byGroup.get(group[uid]) ?? []), uid]);
  return [...byGroup]
    .sort((a, b) => groupNumber(a[0]) - groupNumber(b[0]))
    .map(([id, members], order) => ({ id, members, online: members.some((uid) => players[uid].on === true), order }));
}

// The members of one group in join order (the order the captain rotates through).
export const teamOf = ({ players = {}, group = {} }, id) =>
  Object.entries(players)
    .filter(([uid]) => group[uid] === id)
    .sort(byJoin)
    .map(([uid]) => uid);

// "9 of 24 have bid": how far the current step has got among the subjects who are online.
export function progress(state) {
  const map = state.cur?.phase === 'bid' ? state.bid : state.cur?.phase === 'answer' ? state.ans : null;
  if (!map) return null;
  const online = subjectsOf(state).filter((s) => s.online);
  return { done: online.filter((s) => map[s.id]).length, total: online.length };
}

// The leaderboard, best first.
export function leaderboard(state) {
  const rows = subjectsOf(state).map((s) => ({ id: s.id, members: s.members, pts: state.score?.[s.id]?.pts ?? START_POINTS, ok: state.score?.[s.id]?.ok ?? 0, order: s.order }));
  return rankSubjects(rows);
}

// ---- group votes become the group's own bid / ans / side nodes
// eff: the bid/ans/side maps as they will stand once `patch` is written. `force` also settles groups that are not Ready.
function resolveGroups(state, step, eff, patch, force) {
  if (modeOf(state) !== 'group') return;
  const { cur, players = {}, vote = {} } = state;
  const q = questionOf(state);
  for (const s of subjectsOf(state)) {
    if (eff[step][s.id]) continue;
    if (step === 'side' && !eff.ans[s.id]) continue; // a group can only bet once it has answered
    const votes = {};
    for (const uid of s.members) if (vote[s.id]?.[uid]?.[step]) votes[uid] = vote[s.id][uid][step];
    if (!force && !isDone(votes, s.members, players)) continue;

    let node = null;
    if (step === 'bid') node = resolveBid(votes, { maxWager: state.meta.maxWager, canToken: hasToken(state, s.id) });
    else if (step === 'ans') {
      const v = q ? resolveAnswer(votes, captainOf(s.members, cur.n), q.options.length) : null;
      if (v !== null) node = { v };
    } else {
      const v = resolveSide(votes);
      if (!(force && v === 'none')) node = { v };
    }
    if (!node) continue;
    node.ts = TS;
    eff[step][s.id] = node;
    patch[`${step}/${cur.qid}/${s.id}`] = node;
  }
}

const effective = (state) => ({ bid: { ...state.bid }, ans: { ...state.ans }, side: { ...state.side } });

// Players who arrive after the groups were formed go to the smallest group.
function strayGroups(state) {
  if (modeOf(state) !== 'group') return {};
  const group = { ...state.group };
  if (!Object.keys(group).length) return {};
  const patch = {};
  const strays = Object.entries(state.players ?? {}).filter(([uid, p]) => !group[uid] && p.on === true).sort(byJoin);
  for (const [uid] of strays) {
    group[uid] = smallestGroup(group);
    patch[`group/${uid}`] = group[uid];
  }
  return patch;
}

// ---- the lobby
export function canStart(state) {
  const need = MIN_PLAYERS[modeOf(state)];
  const online = onlineUids(state).length;
  if (online >= need) return { ok: true };
  return { ok: false, reason: need === 1 ? 'Waiting for the first player to join.' : `Group mode needs at least ${need} players (${online} so far).` };
}

// Shuffle the players who are online into random, balanced groups (as often as you like before the start).
export function shufflePatch(state, rand = Math.random) {
  const uids = onlineUids(state);
  if (modeOf(state) !== 'group' || uids.length < MIN_PLAYERS.group) return null;
  return { group: formGroups(uids, state.meta.groupSize, rand) };
}

export function startPatch(state, now, rand = Math.random) {
  if (!canStart(state).ok) return null;
  const patch = {};
  let group = state.group ?? {};
  if (modeOf(state) === 'group') {
    if (!Object.keys(group).length) {
      group = formGroups(onlineUids(state), state.meta.groupSize, rand);
      patch.group = group;
    } else {
      const strays = strayGroups(state); // players who joined since the shuffle
      Object.assign(patch, strays);
      group = { ...group, ...Object.fromEntries(Object.entries(strays).map(([path, g]) => [path.slice('group/'.length), g])) };
    }
  }
  for (const s of subjectsOf({ ...state, group })) patch[`score/${s.id}`] = { pts: START_POINTS, ok: 0 };
  if (modeOf(state) === 'solo') patch['meta/open'] = false; // solo: no one joins mid-game
  patch.cur = bidCur(state, 1, now);
  return patch;
}

// ---- one question: bid -> answer -> reveal -> standings
function bidCur(state, n, now) {
  const q = state.quiz[`q${n}`];
  return { qid: `q${n}`, n, total: state.cur.total, phase: 'bid', category: q.category, difficulty: q.difficulty, deadline: now + PACING[modeOf(state)].bid * 1000 };
}

// Bids lock; the question and its options appear.
export function toAnswer(state, now) {
  const { cur } = state;
  const q = questionOf(state);
  if (!q) return null;
  const patch = {};
  resolveGroups(state, 'bid', effective(state), patch, true);
  const seconds = q.timeLimitSec ?? PACING[modeOf(state)].answer;
  patch.cur = { qid: cur.qid, n: cur.n, total: cur.total, phase: 'answer', category: q.category, difficulty: q.difficulty, text: q.text, options: q.options, deadline: now + seconds * 1000 };
  return patch;
}

// The live class stats shown to those who have answered: option counts and how many have answered so far.
export function statsFor(state, eff = effective(state)) {
  const q = questionOf(state);
  const subs = subjectsOf(state);
  const { counts, answered } = tally(subs.map((s) => eff.ans[s.id]?.v), q.options.length);
  return { answered, total: Math.max(answered, subs.filter((s) => s.online).length), counts };
}

// The database hands keys back in its own order, so compare field by field, never as JSON text.
const sameStats = (a, b) => !!a && !!b && a.answered === b.answered && a.total === b.total && a.counts?.length === b.counts?.length && a.counts.every((count, i) => count === b.counts[i]);

// Answers lock, the key is revealed, and every subject is scored: one atomic patch.
export function toReveal(state) {
  const { cur, meta } = state;
  const q = questionOf(state);
  if (!q) return null;
  const patch = {};
  const eff = effective(state);
  resolveGroups(state, 'ans', eff, patch, true);
  resolveGroups(state, 'side', eff, patch, true);

  const subs = subjectsOf(state);
  const { counts, answered } = tally(subs.map((s) => eff.ans[s.id]?.v), q.options.length);
  const right = counts[q.correct] ?? 0;
  const majority = classResult(right, answered);

  const rows = [];
  for (const s of subs) {
    const before = state.score?.[s.id] ?? { pts: START_POINTS, ok: 0 };
    const pick = tally([eff.ans[s.id]?.v], q.options.length).answered ? eff.ans[s.id].v : -1;
    const correct = pick === q.correct;
    const bid = eff.bid[s.id];
    const token = bid?.token && hasToken(state, s.id) ? bid.token : null;
    const bet = pick >= 0 && (eff.side[s.id]?.v === 'right' || eff.side[s.id]?.v === 'wrong') ? eff.side[s.id].v : null;
    const result = settle({ score: before.pts, pct: bid?.pct ?? 0, max: meta.maxWager, difficulty: q.difficulty, token, correct, bet, majority });

    patch[`out/${cur.qid}/${s.id}`] = { pick, ok: correct, pct: clampPct(bid?.pct ?? 0, meta.maxWager), wager: result.wager, main: result.main, side: result.side, pts: result.pts, ...(token ? { token } : {}), ...(bet ? { bet } : {}) };
    if (token) patch[`perk/${s.id}/used`] = true;
    rows.push({ id: s.id, pts: result.pts, ok: before.ok + (correct ? 1 : 0), order: s.order });
  }
  for (const row of rankSubjects(rows)) patch[`score/${row.id}`] = { pts: row.pts, ok: row.ok, rank: row.rank, of: rows.length };

  patch[`res/${cur.qid}`] = {
    correct: q.correct,
    counts,
    answered,
    total: subs.length,
    accuracy: answered ? Math.round((100 * right) / answered) : 0,
    majority,
    category: q.category,
    difficulty: q.difficulty,
    ...(q.explanation ? { explanation: q.explanation } : {}),
  };
  patch.cur = { qid: cur.qid, n: cur.n, total: cur.total, phase: 'reveal', category: q.category, difficulty: q.difficulty, text: q.text, options: q.options };
  return patch;
}

// After the standings the bottom 30% who have no token yet unlock one (not after the last question).
export function toStandings(state) {
  const { cur } = state;
  const patch = {};
  if (cur.n < cur.total) {
    const subs = subjectsOf(state);
    const sorted = leaderboard(state);
    const online = new Set(subs.filter((s) => s.online).map((s) => s.id));
    const unlocked = new Set(Object.entries(state.perk ?? {}).filter(([, p]) => p.unlocked).map(([id]) => id));
    for (const id of safetyNetUnlocks(sorted, { online, unlocked })) patch[`perk/${id}`] = { unlocked: true, used: false };
  }
  const q = questionOf(state);
  patch.cur = { qid: cur.qid, n: cur.n, total: cur.total, phase: 'standings', category: q.category, difficulty: q.difficulty, text: q.text, options: q.options };
  return patch;
}

export const finishPatch = (state) => ({ cur: { phase: 'final', n: state.cur.n, total: state.cur.total } });

export function toNext(state, now) {
  const { cur } = state;
  if (cur.n >= cur.total || !state.quiz?.[`q${cur.n + 1}`]) return finishPatch(state);
  return { cur: bidCur(state, cur.n + 1, now) };
}

// The host's "next" button: the patch for leaving the current phase now, or null when there is nothing to do.
export function advance(state, now, rand = Math.random) {
  switch (state.cur?.phase) {
    case 'lobby':
      return startPatch(state, now, rand);
    case 'bid':
      return toAnswer(state, now);
    case 'answer':
      return toReveal(state);
    case 'reveal':
      return toStandings(state);
    case 'standings':
      return toNext(state, now);
    default:
      return null;
  }
}

// ---- the loop: what to do on every tick without anyone pressing a button
export function autoStep(state, now) {
  const { cur } = state;
  if (!cur || !state.meta) return null;
  const strays = strayGroups(state);
  if (Object.keys(strays).length) return strays;

  const patch = {};
  if (cur.phase === 'bid') {
    const eff = effective(state);
    resolveGroups(state, 'bid', eff, patch, false);
    const online = subjectsOf(state).filter((s) => s.online);
    const everyoneBid = online.length > 0 && online.every((s) => eff.bid[s.id]);
    if (everyoneBid || now >= cur.deadline + HOST_GRACE_MS) return toAnswer(state, now);
  } else if (cur.phase === 'answer') {
    const q = questionOf(state);
    if (!q) return null;
    const eff = effective(state);
    resolveGroups(state, 'ans', eff, patch, false);
    resolveGroups(state, 'side', eff, patch, false);
    const online = subjectsOf(state).filter((s) => s.online);
    const everyoneAnswered = online.length > 0 && online.every((s) => eff.ans[s.id]);
    const everyoneSettled = everyoneAnswered && online.every((s) => eff.side[s.id]);
    const lastAnswer = Math.max(0, ...online.map((s) => (typeof eff.ans[s.id]?.ts === 'number' ? eff.ans[s.id].ts : now)));
    const graceOver = everyoneAnswered && now >= lastAnswer + SIDE_GRACE_MS[modeOf(state)];
    if (everyoneSettled || graceOver || now >= cur.deadline + HOST_GRACE_MS) return toReveal(state);

    const stats = statsFor(state, eff);
    const shown = stats.answered > 0 && stats.answered >= Math.min(STATS_MIN_ANSWERS, stats.total);
    if (shown && !sameStats(stats, state.stats)) patch[`stats/${cur.qid}`] = stats;
  }
  return Object.keys(patch).length ? patch : null;
}

export const removePatch = (uid) => ({ [`players/${uid}`]: null, [`group/${uid}`]: null, [`banned/${uid}`]: true });
