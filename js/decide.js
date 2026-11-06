// How a group turns its members' votes into one decision (pure; js/engine.js applies it on the host's page).
// Votes are { uid: { ...fields } } for one step: bid { pct, tok, ok }, ans { v, ok }, side { v, ok }.
// `ok` is the member's Ready flag.

// Of the sorted values, the one just below the middle for an even count: a split group risks less.
export function lowerMedian(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// Members in join order; the captain rotates with the (1-based) question number, so everyone takes a turn.
export const captainOf = (members, n) => (members.length ? members[(Math.max(1, n) - 1) % members.length] : null);

// Wager = lower median of the votes. A token is used if more than half of the voters pick the same effect.
// Null while nobody has voted.
export function resolveBid(votes, { maxWager = 100, canToken = false } = {}) {
  const cast = Object.values(votes).filter((v) => Number.isFinite(v?.pct));
  if (!cast.length) return null;
  const node = { pct: Math.min(maxWager, Math.max(0, Math.floor(lowerMedian(cast.map((v) => v.pct))))) };
  if (canToken) {
    const dd = cast.filter((v) => v.tok === 'dd').length;
    const sh = cast.filter((v) => v.tok === 'sh').length;
    if (dd * 2 > cast.length) node.token = 'dd';
    else if (sh * 2 > cast.length) node.token = 'sh';
  }
  return node;
}

// Answer = most votes. A tie goes to the captain's vote if it is one of the tied options, else the lowest option.
// Null while nobody has voted (the group did not answer).
export function resolveAnswer(votes, captain, optionCount = 4) {
  const counts = new Array(optionCount).fill(0);
  let cast = 0;
  for (const vote of Object.values(votes)) {
    if (Number.isInteger(vote?.v) && vote.v >= 0 && vote.v < optionCount) {
      counts[vote.v]++;
      cast++;
    }
  }
  if (!cast) return null;
  const top = Math.max(...counts);
  const tied = counts.flatMap((c, i) => (c === top ? [i] : []));
  if (tied.length === 1) return tied[0];
  const pick = votes[captain]?.v;
  return tied.includes(pick) ? pick : tied[0];
}

// Side-bet = most votes for 'right' or 'wrong'; a tie, or no votes, means no bet.
export function resolveSide(votes) {
  let right = 0;
  let wrong = 0;
  for (const vote of Object.values(votes)) {
    if (vote?.v === 'right') right++;
    else if (vote?.v === 'wrong') wrong++;
  }
  if (right > wrong) return 'right';
  if (wrong > right) return 'wrong';
  return 'none';
}

// A group is done with a step when more than half of its online members are Ready.
export function isDone(votes, members, players) {
  const online = members.filter((uid) => players?.[uid]?.on === true);
  if (!online.length) return false;
  const ready = online.filter((uid) => votes?.[uid]?.ok === true).length;
  return ready * 2 > online.length;
}
