// Security-rules tests for the `quizzes` block. They need the Firebase emulator: `npm run test:rules`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, serverTimestamp, set, update } from 'firebase/database';

const CODE = 'ABC234';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-quizme',
    database: { rules: readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearDatabase());

const db = (uid) => env.authenticatedContext(uid).database();
const at = (d, path = '') => ref(d, `quizzes/${CODE}${path ? `/${path}` : ''}`);
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.database()));

const OPTIONS = ['41', '42', '43', '44'];
const meta = (over = {}) => ({ owner: 'host', title: 'Unit 3', mode: 'solo', groupSize: 4, maxWager: 100, open: true, createdAt: 1, ...over });
const question = (over = {}) => ({ category: 'Maths', difficulty: 'medium', text: 'What is 6 x 7?', options: OPTIONS, correct: 1, ...over });
const person = (name, over = {}) => ({ name, on: true, ts: 1, ...over });
const cur = (phase, over = {}) => ({
  qid: 'q1',
  n: 1,
  total: 3,
  phase,
  category: 'Maths',
  difficulty: 'medium',
  deadline: Date.now() + 60_000,
  ...(phase === 'answer' ? { text: 'What is 6 x 7?', options: OPTIONS } : {}),
  ...over,
});

// A running game: host, players alice and bob (g1 in group mode) and carol and dan (g2), question q1 on screen.
async function seedRoom({ phase = 'bid', mode = 'solo', open = true, curOver = {}, extra = {} } = {}) {
  await seed((d) =>
    update(at(d), {
      meta: meta({ mode, open }),
      players: { alice: person('Alice'), bob: person('Bob'), carol: person('Carol'), dan: person('Dan') },
      ...(mode === 'group' ? { group: { alice: 'g1', bob: 'g1', carol: 'g2', dan: 'g2' } } : {}),
      cur: cur(phase, curOver),
      'quiz/q1': question(),
      ...extra,
    }),
  );
}

// ---- rooms
test('anyone signed in can create a room and becomes its owner', async () => {
  await assertSucceeds(set(at(db('host'), 'meta'), meta({ createdAt: serverTimestamp() })));
});

test('a room must name its creator as owner', async () => {
  await assertFails(set(at(db('host'), 'meta'), meta({ owner: 'someone-else', createdAt: serverTimestamp() })));
});

test('room codes use the six-character alphabet', async () => {
  await assertFails(set(ref(db('host'), 'quizzes/abc/meta'), meta({ createdAt: serverTimestamp() })));
  await assertFails(set(ref(db('host'), 'quizzes/ABC10O/meta'), meta({ createdAt: serverTimestamp() })));
  await assertSucceeds(set(ref(db('host'), 'quizzes/HJK789/meta'), meta({ createdAt: serverTimestamp() })));
});

test('settings are validated', async () => {
  const create = (over) => set(at(db('host'), 'meta'), meta({ createdAt: serverTimestamp(), ...over }));
  await assertFails(create({ mode: 'duel' }));
  await assertFails(create({ groupSize: 1 }));
  await assertFails(create({ groupSize: 7 }));
  await assertFails(create({ maxWager: 5 }));
  await assertFails(create({ maxWager: 150 }));
  await assertFails(create({ title: '' }));
  await assertFails(create({ title: 'x'.repeat(61) }));
  await assertFails(create({ prize: 'gold' }));
  await assertSucceeds(create({ mode: 'group', groupSize: 6, maxWager: 50 }));
});

test('a room code that is taken cannot be claimed by someone else', async () => {
  await seedRoom();
  await assertFails(set(at(db('mallory'), 'meta'), meta({ owner: 'mallory', createdAt: serverTimestamp() })));
});

test('only the owner can change the settings; the join switch is one of them', async () => {
  await seedRoom();
  await assertSucceeds(update(at(db('host'), 'meta'), { open: false }));
  await assertFails(update(at(db('alice'), 'meta'), { open: true }));
  await assertFails(update(at(db('alice'), 'meta'), { maxWager: 100 }));
});

test('signed-out visitors cannot read a room; signed-in users can read its settings and the screen state', async () => {
  await seedRoom();
  await assertFails(get(at(env.unauthenticatedContext().database(), 'meta')));
  await assertSucceeds(get(at(db('alice'), 'meta')));
  await assertSucceeds(get(at(db('alice'), 'cur')));
});

test('players cannot read the whole room, but the owner can', async () => {
  await seedRoom();
  await assertFails(get(at(db('alice'))));
  await assertSucceeds(get(at(db('host'))));
});

test('unknown data under a room is rejected', async () => {
  await seedRoom();
  await assertFails(set(at(db('host'), 'secrets'), { a: 1 }));
});

test('only the owner can end a session', async () => {
  await seedRoom();
  await assertFails(remove(at(db('alice'))));
  await assertSucceeds(remove(at(db('host'))));
});

// ---- players
test('a player can join an open room as themselves', async () => {
  await seedRoom();
  await assertSucceeds(set(at(db('erin'), 'players/erin'), { name: 'Erin', on: true, ts: serverTimestamp() }));
});

test('nobody new can join a closed room, but existing players keep working', async () => {
  await seedRoom({ open: false });
  await assertFails(set(at(db('erin'), 'players/erin'), { name: 'Erin', on: true, ts: serverTimestamp() }));
  await assertSucceeds(update(at(db('alice'), 'players/alice'), { on: false }));
  await assertSucceeds(update(at(db('alice'), 'players/alice'), { name: 'Alice B' }));
});

test('a player cannot write someone else\'s profile', async () => {
  await seedRoom();
  await assertFails(set(at(db('alice'), 'players/bob'), { name: 'Not Bob', on: true, ts: serverTimestamp() }));
  await assertFails(update(at(db('alice'), 'players/bob'), { on: false }));
});

test('profiles are validated', async () => {
  await seedRoom();
  const join = (value) => set(at(db('erin'), 'players/erin'), { ts: serverTimestamp(), on: true, ...value });
  await assertFails(join({ name: '' }));
  await assertFails(join({ name: 'x'.repeat(21) }));
  await assertFails(join({ name: 'Erin', admin: true }));
  await assertFails(join({ name: 'Erin', ts: 12345 }));
  await assertSucceeds(join({ name: 'Erin' }));
});

test('the join time cannot be rewritten by an update', async () => {
  await seedRoom();
  await assertFails(update(at(db('alice'), 'players/alice'), { ts: 99 }));
});

test('a removed player stays out', async () => {
  await seedRoom();
  await assertSucceeds(update(at(db('host')), { 'players/bob': null, 'group/bob': null, 'banned/bob': true }));
  await assertFails(set(at(db('bob'), 'players/bob'), { name: 'Bob', on: true, ts: serverTimestamp() }));
  await assertFails(set(at(db('alice'), 'banned/alice'), true));
});

// ---- questions and the answer key
test('players never see the answer key; only the owner reads and writes questions', async () => {
  await seedRoom();
  await assertFails(get(at(db('alice'), 'quiz')));
  await assertFails(get(at(db('alice'), 'quiz/q1')));
  await assertFails(get(at(db('alice'), 'quiz/q1/correct')));
  await assertSucceeds(get(at(db('host'), 'quiz/q1')));
  await assertFails(set(at(db('alice'), 'quiz/q2'), question()));
  await assertSucceeds(set(at(db('host'), 'quiz/q2'), question({ explanation: 'Because.', timeLimitSec: 30 })));
});

test('questions are validated', async () => {
  await seedRoom();
  const put = (value, id = 'q2') => set(at(db('host'), `quiz/${id}`), value);
  await assertFails(put(question({ correct: 4 })));
  await assertFails(put(question({ options: ['only one'] })));
  await assertFails(put(question({ options: ['a', 'b', 'c', 'd', 'e'] })));
  await assertFails(put(question({ options: ['a', ''] })));
  await assertFails(put(question({ difficulty: 'impossible' })));
  await assertFails(put(question({ text: '' })));
  await assertFails(put(question({ category: 'x'.repeat(41) })));
  await assertFails(put(question({ timeLimitSec: 2 })));
  await assertFails(put(question({ bonus: 1 })));
  await assertFails(put(question(), 'question2'));
  await assertFails(put(question(), 'q0'));
  await assertSucceeds(put(question({ options: ['yes', 'no'], correct: 0 })));
});

test('only the owner changes what is on screen, and the screen state is validated', async () => {
  await seedRoom();
  await assertFails(set(at(db('alice'), 'cur'), cur('lobby', { qid: null })));
  await assertFails(update(at(db('alice'), 'cur'), { phase: 'reveal' }));
  await assertFails(set(at(db('host'), 'cur'), cur('bid', { phase: 'intermission' })));
  await assertFails(set(at(db('host'), 'cur'), cur('bid', { qid: 'question1' })));
  await assertFails(set(at(db('host'), 'cur'), cur('bid', { text: 'x'.repeat(301) })));
  await assertFails(set(at(db('host'), 'cur'), cur('bid', { key: 1 })));
  await assertSucceeds(set(at(db('host'), 'cur'), cur('answer')));
  await assertSucceeds(set(at(db('host'), 'cur'), { phase: 'lobby', n: 0, total: 3 }));
});

// ---- bids (solo)
const bid = (over = {}) => ({ pct: 40, ts: serverTimestamp(), ...over });

test('a player bids once, as themselves, while bidding is open', async () => {
  await seedRoom();
  await assertSucceeds(set(at(db('alice'), 'bid/q1/alice'), bid()));
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid({ pct: 90 }))); // no second bid
  await assertFails(set(at(db('alice'), 'bid/q1/bob'), bid())); // not for someone else
  await assertSucceeds(set(at(db('bob'), 'bid/q1/bob'), bid({ pct: 0 })));
});

test('bids only count for the current question, in the bid phase, before the deadline', async () => {
  await seedRoom();
  await assertFails(set(at(db('alice'), 'bid/q2/alice'), bid())); // not the current question
  await seedRoom({ phase: 'answer' });
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid())); // the question is already out
  await seedRoom({ curOver: { deadline: Date.now() - 500 } });
  await assertSucceeds(set(at(db('alice'), 'bid/q1/alice'), bid())); // a moment of grace for slow phones
  await seedRoom({ curOver: { deadline: Date.now() - 5000 } });
  await assertFails(set(at(db('bob'), 'bid/q1/bob'), bid()));
});

test('bids are validated: within the host\'s cap, stamped by the server, nothing extra', async () => {
  await seedRoom();
  await seed((d) => update(at(d, 'meta'), { maxWager: 50 }));
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid({ pct: 51 })));
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid({ pct: -1 })));
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid({ ts: 12345 })));
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid({ points: 5000 })));
  await assertSucceeds(set(at(db('alice'), 'bid/q1/alice'), bid({ pct: 50 })));
});

test('someone who has not joined cannot bid', async () => {
  await seedRoom();
  await assertFails(set(at(db('erin'), 'bid/q1/erin'), bid()));
});

test('a token can be armed only by a player who holds an unspent one', async () => {
  await seedRoom({ extra: { 'perk/alice': { unlocked: true, used: false }, 'perk/bob': { unlocked: true, used: true } } });
  await assertSucceeds(set(at(db('alice'), 'bid/q1/alice'), bid({ token: 'dd' })));
  await assertFails(set(at(db('bob'), 'bid/q1/bob'), bid({ token: 'sh' }))); // already spent
  await assertFails(set(at(db('carol'), 'bid/q1/carol'), bid({ token: 'dd' }))); // never earned one
  await assertSucceeds(set(at(db('carol'), 'bid/q1/carol'), bid())); // a plain bid is fine
  await assertFails(set(at(db('dan'), 'bid/q1/dan'), bid({ token: 'laser' })));
});

test('players read only their own bid; the owner reads all', async () => {
  await seedRoom({ extra: { 'bid/q1/alice': { pct: 40, ts: 1 }, 'bid/q1/bob': { pct: 90, ts: 1 } } });
  await assertSucceeds(get(at(db('alice'), 'bid/q1/alice')));
  await assertFails(get(at(db('alice'), 'bid/q1/bob')));
  await assertFails(get(at(db('alice'), 'bid/q1')));
  await assertSucceeds(get(at(db('host'), 'bid/q1')));
});

// ---- answers (solo)
const answer = (over = {}) => ({ v: 1, ts: serverTimestamp(), ...over });

test('a player answers once, as themselves, while the question is open', async () => {
  await seedRoom({ phase: 'answer' });
  await assertSucceeds(set(at(db('alice'), 'ans/q1/alice'), answer()));
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer({ v: 2 }))); // no second answer
  await assertFails(remove(at(db('alice'), 'ans/q1/alice'))); // ...and no taking it back
  await assertFails(set(at(db('alice'), 'ans/q1/bob'), answer()));
});

test('answers need the answer phase, the right question and time left', async () => {
  await seedRoom({ phase: 'bid' });
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer())); // options are not even out yet
  await seedRoom({ phase: 'answer' });
  await assertFails(set(at(db('alice'), 'ans/q2/alice'), answer()));
  await seedRoom({ phase: 'reveal' });
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer()));
  await seedRoom({ phase: 'answer', curOver: { deadline: Date.now() - 5000 } });
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer()));
});

test('answers are validated', async () => {
  await seedRoom({ phase: 'answer' });
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer({ v: 4 })));
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer({ v: '1' })));
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer({ ts: 5 })));
  await assertFails(set(at(db('alice'), 'ans/q1/alice'), answer({ ok: true })));
});

test('a player cannot see anyone else\'s answer', async () => {
  await seedRoom({ phase: 'answer', extra: { 'ans/q1/alice': { v: 1, ts: 1 }, 'ans/q1/bob': { v: 2, ts: 1 } } });
  await assertSucceeds(get(at(db('alice'), 'ans/q1/alice')));
  await assertFails(get(at(db('alice'), 'ans/q1/bob')));
  await assertFails(get(at(db('alice'), 'ans/q1')));
  await assertSucceeds(get(at(db('host'), 'ans/q1')));
});

// ---- side-bets (solo)
const side = (over = {}) => ({ v: 'right', ts: serverTimestamp(), ...over });

test('a side-bet needs an answer first, and is placed once', async () => {
  await seedRoom({ phase: 'answer', extra: { 'ans/q1/alice': { v: 1, ts: 1 } } });
  await assertFails(set(at(db('bob'), 'side/q1/bob'), side())); // bob has not answered
  await assertSucceeds(set(at(db('alice'), 'side/q1/alice'), side()));
  await assertFails(set(at(db('alice'), 'side/q1/alice'), side({ v: 'wrong' })));
});

test('side-bets are right, wrong or a pass, and only while the question is open', async () => {
  await seedRoom({ phase: 'answer', extra: { 'ans/q1/alice': { v: 1, ts: 1 }, 'ans/q1/bob': { v: 1, ts: 1 } } });
  await assertFails(set(at(db('alice'), 'side/q1/alice'), side({ v: 'maybe' })));
  await assertSucceeds(set(at(db('bob'), 'side/q1/bob'), side({ v: 'none' })));
  await seedRoom({ phase: 'reveal', extra: { 'ans/q1/alice': { v: 1, ts: 1 } } });
  await assertFails(set(at(db('alice'), 'side/q1/alice'), side()));
});

// ---- the class stats
test('live stats are hidden until the player has answered', async () => {
  await seedRoom({ phase: 'answer', extra: { 'ans/q1/alice': { v: 1, ts: 1 }, 'stats/q1': { answered: 3, total: 4, counts: [0, 2, 1, 0] } } });
  await assertSucceeds(get(at(db('alice'), 'stats/q1')));
  await assertFails(get(at(db('bob'), 'stats/q1'))); // bob has not answered: no peeking at the crowd
  await assertSucceeds(get(at(db('host'), 'stats/q1')));
  await assertFails(set(at(db('alice'), 'stats/q1'), { answered: 1, total: 1, counts: [1] }));
});

test('stats are validated', async () => {
  await seedRoom({ phase: 'answer' });
  const put = (value) => set(at(db('host'), 'stats/q1'), value);
  await assertFails(put({ answered: -1, total: 4, counts: [0, 0, 0, 0] }));
  await assertFails(put({ answered: 1, total: 4, counts: [0, 0, 0, 0, 1] }));
  await assertFails(put({ answered: 1, total: 4 }));
  await assertFails(put({ answered: 1, total: 4, counts: [1], correct: 1 })); // stats never carry the key
  await assertSucceeds(put({ answered: 1, total: 4, counts: [0, 1, 0, 0] }));
});

// ---- scores, tokens and results are the host's alone
test('only the owner writes scores, tokens and results; players read only their own', async () => {
  await seedRoom({ extra: { 'score/alice': { pts: 1000, ok: 0 }, 'score/bob': { pts: 1500, ok: 1, rank: 1, of: 4 }, 'perk/alice': { unlocked: true, used: false }, 'out/q1/alice': { pick: 1, ok: true, pct: 40, wager: 400, main: 750, side: 0, pts: 1750 } } });
  await assertFails(set(at(db('alice'), 'score/alice'), { pts: 99999, ok: 9 }));
  await assertFails(set(at(db('alice'), 'perk/alice'), { unlocked: true, used: false }));
  await assertFails(set(at(db('alice'), 'perk/carol'), { unlocked: true, used: false }));
  await assertFails(set(at(db('alice'), 'out/q1/alice'), { pick: 1, ok: true, pct: 100, wager: 1, main: 99999, side: 0, pts: 99999 }));
  await assertSucceeds(get(at(db('alice'), 'score/alice')));
  await assertSucceeds(get(at(db('alice'), 'perk/alice')));
  await assertSucceeds(get(at(db('alice'), 'out/q1/alice')));
  await assertFails(get(at(db('alice'), 'score/bob'))); // ranks stay private
  await assertFails(get(at(db('alice'), 'score')));
  await assertFails(get(at(db('alice'), 'out/q1/bob')));
  await assertSucceeds(get(at(db('host'), 'score')));
});

test('scores, tokens and outcomes are validated', async () => {
  await seedRoom();
  await assertFails(set(at(db('host'), 'score/alice'), { pts: -5, ok: 0 }));
  await assertFails(set(at(db('host'), 'score/alice'), { pts: 100 }));
  await assertFails(set(at(db('host'), 'score/alice'), { pts: 100, ok: 0, rank: 0 }));
  await assertFails(set(at(db('host'), 'perk/alice'), { unlocked: 'yes', used: false }));
  await assertFails(set(at(db('host'), 'out/q1/alice'), { pick: 1, ok: true }));
  await assertFails(set(at(db('host'), 'out/q1/alice'), { pick: 7, ok: true, pct: 40, wager: 400, main: 750, side: 0, pts: 1750 }));
  await assertSucceeds(set(at(db('host'), 'out/q1/alice'), { pick: -1, ok: false, pct: 0, wager: 0, main: 0, side: 0, pts: 1000 }));
  await assertSucceeds(set(at(db('host'), 'out/q1/bob'), { pick: 1, ok: true, pct: 40, wager: 400, main: 1500, token: 'dd', bet: 'right', side: 50, pts: 2950 }));
  await assertSucceeds(set(at(db('host'), 'score/alice'), { pts: 1750, ok: 1, rank: 1, of: 4 }));
});

test('results are public once revealed, written by the owner, and only once per question', async () => {
  await seedRoom({ phase: 'reveal' });
  const res = { correct: 1, counts: [0, 3, 1, 0], answered: 4, total: 4, accuracy: 75, majority: 'right', category: 'Maths', difficulty: 'medium', explanation: 'Because.' };
  await assertFails(set(at(db('alice'), 'res/q1'), res));
  await assertSucceeds(set(at(db('host'), 'res/q1'), res));
  await assertFails(set(at(db('host'), 'res/q1'), res)); // a second host tab cannot reveal (and score) the question again
  await assertSucceeds(get(at(db('alice'), 'res/q1')));
  await assertFails(set(at(db('host'), 'res/q2'), { ...res, majority: 'most' }));
  await assertFails(set(at(db('host'), 'res/q2'), { ...res, correct: 9 }));
});

// ---- group mode
const vote = (path, uid, value) => set(at(db(uid), `vote/q1/g1/${uid}/${path}`), value);

test('in group mode only the owner forms groups', async () => {
  await seedRoom({ mode: 'group' });
  await assertSucceeds(set(at(db('host'), 'group'), { alice: 'g2', bob: 'g2', carol: 'g1', dan: 'g1' }));
  await assertFails(set(at(db('alice'), 'group/alice'), 'g2'));
  await assertFails(update(at(db('host'), 'group'), { alice: 'team-red' }));
  await assertSucceeds(get(at(db('alice'), 'group')));
});

test('solo players cannot use the group vote paths and group members cannot use the solo paths', async () => {
  await seedRoom();
  await assertFails(vote('bid', 'alice', { pct: 10 }));
  await seedRoom({ mode: 'group' });
  await assertFails(set(at(db('alice'), 'bid/q1/alice'), bid()));
  await assertFails(set(at(db('alice'), 'bid/q1/g1'), bid()));
});

test('a group member votes on the wager for their own group, as themselves, until the group is done', async () => {
  await seedRoom({ mode: 'group' });
  await assertSucceeds(vote('bid', 'alice', { pct: 30 }));
  await assertSucceeds(vote('bid', 'alice', { pct: 50, ok: true })); // votes can change; Ready is part of the vote
  await assertSucceeds(vote('bid', 'bob', { pct: 20 }));
  await assertFails(set(at(db('alice'), 'vote/q1/g1/bob/bid'), { pct: 99 })); // not for a teammate
  await assertFails(set(at(db('carol'), 'vote/q1/g1/carol/bid'), { pct: 10 })); // not in another group
  await assertFails(set(at(db('alice'), 'vote/q1/g2/alice/bid'), { pct: 10 }));
  await assertFails(vote('bid', 'alice', { pct: 120 }));
  await assertFails(vote('bid', 'alice', { pct: 10, ok: false }));
  await assertFails(vote('bid', 'alice', { ok: true })); // a Ready needs a wager
  await assertFails(set(at(db('alice'), 'vote/q1/g1/alice'), { bid: { pct: 10 } })); // whole-vote writes are not allowed
  await seed((d) => set(at(d, 'bid/q1/g1'), { pct: 20, ts: 1 }));
  await assertFails(vote('bid', 'alice', { pct: 90 })); // the host has settled the group's wager
});

test('a group token vote needs the group to hold an unspent token', async () => {
  await seedRoom({ mode: 'group' });
  await assertFails(vote('bid', 'alice', { pct: 10, tok: 'dd' }));
  await seed((d) => set(at(d, 'perk/g1'), { unlocked: true, used: false }));
  await assertSucceeds(vote('bid', 'alice', { pct: 10, tok: 'dd' }));
  await assertFails(vote('bid', 'alice', { pct: 10, tok: 'laser' }));
});

test('group votes on the answer and the side-bet follow the phase', async () => {
  await seedRoom({ mode: 'group', phase: 'bid' });
  await assertFails(vote('ans', 'alice', { v: 1 })); // the options are not out yet
  await seedRoom({ mode: 'group', phase: 'answer' });
  await assertSucceeds(vote('ans', 'alice', { v: 1 }));
  await assertSucceeds(vote('ans', 'alice', { v: 2, ok: true }));
  await assertFails(vote('ans', 'alice', { v: 4 }));
  await assertFails(vote('side', 'alice', { v: 'right' })); // the group has not answered yet
  await seed((d) => set(at(d, 'ans/q1/g1'), { v: 1, ts: 1 }));
  await assertFails(vote('ans', 'alice', { v: 3 })); // the host has locked the group's answer
  await assertSucceeds(vote('side', 'alice', { v: 'right' }));
  await assertSucceeds(vote('side', 'alice', { ok: true })); // Ready without a bet
  await assertFails(vote('side', 'alice', { v: 'maybe' }));
  await seed((d) => set(at(d, 'side/q1/g1'), { v: 'right', ts: 1 }));
  await assertFails(vote('side', 'alice', { v: 'wrong' }));
});

test('votes stop at the deadline', async () => {
  await seedRoom({ mode: 'group', curOver: { deadline: Date.now() - 5000 } });
  await assertFails(vote('bid', 'alice', { pct: 10 }));
});

test('a group\'s votes are private to the group (and the owner)', async () => {
  await seedRoom({ mode: 'group', extra: { 'vote/q1/g1/alice/bid': { pct: 30 }, 'vote/q1/g2/carol/bid': { pct: 70 } } });
  await assertSucceeds(get(at(db('bob'), 'vote/q1/g1')));
  await assertSucceeds(get(at(db('bob'), 'vote/q1/g1/alice')));
  await assertFails(get(at(db('bob'), 'vote/q1/g2')));
  await assertFails(get(at(db('bob'), 'vote/q1')));
  await assertSucceeds(get(at(db('host'), 'vote/q1')));
});

test('only the host writes a group\'s bid, answer and side-bet; members read them', async () => {
  await seedRoom({ mode: 'group', phase: 'answer', extra: { 'ans/q1/g1': { v: 1, ts: 1 }, 'ans/q1/g2': { v: 2, ts: 1 } } });
  await assertFails(set(at(db('alice'), 'ans/q1/g1'), answer()));
  await assertFails(set(at(db('alice'), 'side/q1/g1'), side()));
  await assertSucceeds(set(at(db('host'), 'side/q1/g1'), side()));
  await assertSucceeds(set(at(db('host'), 'bid/q1/g1'), bid()));
  await assertSucceeds(get(at(db('bob'), 'ans/q1/g1')));
  await assertFails(get(at(db('bob'), 'ans/q1/g2')));
});

test('a group\'s members read the group\'s score and token, nobody else\'s', async () => {
  await seedRoom({ mode: 'group', extra: { 'score/g1': { pts: 1100, ok: 1 }, 'score/g2': { pts: 900, ok: 0 }, 'perk/g1': { unlocked: true, used: false } } });
  await assertSucceeds(get(at(db('alice'), 'score/g1')));
  await assertSucceeds(get(at(db('bob'), 'perk/g1')));
  await assertFails(get(at(db('alice'), 'score/g2')));
  await assertFails(set(at(db('alice'), 'score/g1'), { pts: 99999, ok: 9 }));
});

test('class stats open to a group once the group has answered', async () => {
  await seedRoom({ mode: 'group', phase: 'answer', extra: { 'ans/q1/g1': { v: 1, ts: 1 }, 'stats/q1': { answered: 2, total: 2, counts: [0, 1, 1, 0] } } });
  await assertSucceeds(get(at(db('alice'), 'stats/q1')));
  await assertSucceeds(get(at(db('bob'), 'stats/q1')));
  await assertFails(get(at(db('carol'), 'stats/q1'))); // g2 has not answered yet
});

// ---- the host's atomic updates
test('the host can move the game on in one update, and cannot leave it half-written', async () => {
  await seedRoom({ phase: 'answer', extra: { 'ans/q1/alice': { v: 1, ts: 1 } } });
  await assertSucceeds(
    update(at(db('host')), {
      'out/q1/alice': { pick: 1, ok: true, pct: 0, wager: 0, main: 150, side: 0, pts: 1150 },
      'score/alice': { pts: 1150, ok: 1, rank: 1, of: 4 },
      'res/q1': { correct: 1, counts: [0, 1, 0, 0], answered: 1, total: 4, accuracy: 100, majority: 'right', category: 'Maths', difficulty: 'medium' },
      cur: cur('reveal'),
    }),
  );
  await assertFails(update(at(db('host')), { 'score/bob': { pts: 1000, ok: 0 }, 'out/q1/bob': { pick: 1 } })); // one bad node rejects the lot
  assert.equal((await get(at(db('host'), 'score/bob'))).val(), null);
});
