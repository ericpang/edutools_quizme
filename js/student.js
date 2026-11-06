// The phone: join with a code and a name, then follow the host through each round.
import { db, onValue, ref, signIn } from './firebase.js';
import { Room } from './room.js';
import { isCode, normalizeCode } from './codes.js';
import { groupColor, groupLabel } from './grouping.js';
import { START_POINTS } from './scoring.js';
import { $, fill, fmt, frameThrottle, h, secondsLeft, store } from './ui.js';
import { answerView, bidView, finalView, lobbyView, noticeView, revealView, standingsView } from './student-views.js';

const view = $('#view');

// Everything the screens draw from. The watchers below keep it current; views only read it.
const S = {
  uid: null,
  room: null,
  meta: null,
  cur: null,
  me: null,
  players: {}, // group mode only: names and presence of my teammates
  group: {}, // group mode only: who is in which group
  subject: null, // who scores: my uid, or my group's id in group mode
  score: null,
  perk: null,
  bid: null,
  ans: null,
  side: null,
  out: null,
  res: null,
  stats: null,
  vote: {},
  removed: false,
  ended: false,
};
const loaded = new Set(); // static watchers that have reported
const live = new Map(); // key -> { path, off, loaded }: watchers that follow the subject and the question
let mounted = { key: null, view: null };
let span = 1; // how long the current countdown started at, for the bar
let flushed = '';

// ---------------------------------------------------------------- joining
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

function showJoin({ code = '', error = '' } = {}) {
  const saved = store.get('qm.profile', {});
  const codeInput = h('input', { class: 'input code-input', id: 'code', maxlength: 6, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'ABC234', value: code });
  const nameInput = h('input', { class: 'input', id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'First name or nickname', value: saved.name ?? '' });
  const problem = h('p', { class: 'error', id: 'joinError', role: 'alert', hidden: !error }, error);
  const submit = h('button', { class: 'btn primary big', type: 'submit', id: 'joinBtn' }, 'Join game');
  const fail = (message) => {
    problem.textContent = message;
    problem.hidden = false;
  };

  const form = h(
    'form',
    {
      class: 'stack',
      id: 'joinForm',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const name = nameInput.value.replace(/\s+/g, ' ').trim();
        const entered = normalizeCode(codeInput.value);
        if (!isCode(entered)) return fail('The code has 6 letters and numbers, like ABC234.');
        if (!name) return fail('Type your name so the host knows who you are.');
        submit.disabled = true;
        problem.hidden = true;
        try {
          const room = new Room(entered, S.uid);
          const meta = await room.getMeta();
          if (!meta) return fail('Can’t find that game. Check the code on the big screen.');
          const existing = await room.getMe();
          if (!existing && !meta.open) return fail('This game has started and isn’t letting new players in.');
          if (existing) await room.rejoin(name);
          else await room.join(name);
          store.set('qm.profile', { name });
          const url = new URL(location.href); // keep the page's other parameters (like ?emulator) when remembering the code
          url.searchParams.set('room', entered);
          history.replaceState(null, '', url);
          begin(room, meta);
        } catch (err) {
          fail(err?.code === 'PERMISSION_DENIED' ? 'You can’t join this game: it is closed, or the host removed you.' : 'Something went wrong. Check your connection and try again.');
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('h1', { class: 'title' }, 'Join the game'),
    field('Game code', codeInput),
    field('Your name', nameInput),
    problem,
    submit,
  );
  fill(view, form);
  (code ? nameInput : codeInput).focus({ preventScroll: true });
}

async function boot() {
  try {
    S.uid = await signIn();
  } catch {
    return fill(view, noticeView('Can’t connect', 'We could not sign you in. Check your connection and reload the page.').el);
  }
  const code = normalizeCode(new URLSearchParams(location.search).get('room'));
  if (!isCode(code)) return showJoin();
  const room = new Room(code, S.uid);
  try {
    const meta = await room.getMeta();
    if (!meta) return showJoin({ code, error: 'Can’t find that game. Check the code on the big screen.' });
    if (await room.getMe()) {
      await room.rejoin(); // a refresh: carry on where the game is
      return begin(room, meta);
    }
    showJoin({ code });
  } catch {
    showJoin({ code, error: 'Something went wrong. Check your connection and try again.' });
  }
}

// ---------------------------------------------------------------- following the game
function begin(room, meta) {
  S.room = room;
  S.meta = meta;
  document.title = `QuizMe · ${room.code}`;
  const group = meta.mode === 'group';
  const watch = (key, path, apply) =>
    room.watch(
      path,
      (value) => {
        apply(value);
        loaded.add(key);
        sync();
        render();
      },
      () => {},
    );

  watch('meta', 'meta', (v) => {
    S.meta = v;
    S.ended = v === null;
  });
  watch('cur', 'cur', (v) => (S.cur = v));
  if (group) {
    watch('players', 'players', (v) => {
      S.players = v ?? {};
      S.me = S.players[S.uid] ?? null;
      S.removed = !S.me;
    });
    watch('group', 'group', (v) => {
      S.group = v ?? {};
      S.subject = S.group[S.uid] ?? null;
    });
  } else {
    S.subject = S.uid;
    watch('me', `players/${S.uid}`, (v) => {
      S.me = v;
      S.removed = v === null;
    });
  }
  onValue(ref(db, '.info/connected'), (s) => ($('#offline').hidden = s.val() !== false));
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', render);
}

// The watchers that depend on who I score for and on which question is on: they are swapped when either changes.
function wanted() {
  const want = {};
  const qid = S.cur?.qid;
  if (S.subject) {
    want.score = `score/${S.subject}`;
    want.perk = `perk/${S.subject}`;
  }
  if (qid) {
    want.res = `res/${qid}`;
    if (S.subject) {
      want.bid = `bid/${qid}/${S.subject}`;
      want.ans = `ans/${qid}/${S.subject}`;
      want.side = `side/${qid}/${S.subject}`;
      want.out = `out/${qid}/${S.subject}`;
      if (S.meta?.mode === 'group') want.vote = `vote/${qid}/${S.subject}`;
      if (S.ans) want.stats = `stats/${qid}`; // the rules only open the stats to someone who has answered
    }
  }
  return want;
}

function sync() {
  const want = wanted();
  for (const [key, entry] of live) {
    if (want[key] === entry.path) continue;
    entry.off();
    live.delete(key);
    S[key] = key === 'vote' ? {} : null; // never show the last question's data on this one
  }
  for (const [key, path] of Object.entries(want)) {
    if (live.has(key)) continue;
    const entry = { path, loaded: false, off: null };
    live.set(key, entry);
    entry.off = S.room.watch(
      path,
      (value) => {
        S[key] = value ?? (key === 'vote' ? {} : null);
        entry.loaded = true;
        sync();
        render();
      },
      () => {
        entry.loaded = true;
        S[key] = key === 'vote' ? {} : null;
        render();
      },
    );
  }
}

// ---------------------------------------------------------------- showing it
const BUILD = { lobby: lobbyView, bid: bidView, answer: answerView, reveal: revealView, standings: standingsView, final: finalView };

function routeKey() {
  if (S.ended) return 'ended';
  if (S.removed && loaded.has('meta')) return 'removed';
  if (!S.meta || !S.cur || !loaded.has('cur')) return null;
  if ([...live.values()].some((entry) => !entry.loaded)) return null;
  const { phase, qid } = S.cur;
  if (S.meta.mode === 'group' && !S.subject && phase !== 'lobby') return 'grouping';
  return phase === 'lobby' || phase === 'final' ? phase : `${phase}:${qid}`;
}

const NOTICE = {
  ended: ['The game has ended', 'The host closed this game. Thanks for playing!'],
  removed: ['You were removed', 'The host took you out of this game.'],
  grouping: ['Hold on', 'The host is putting you in a group.'],
};

function announce(key) {
  const { cur } = S;
  const text = {
    lobby: 'You are in the lobby.',
    bid: `Question ${cur?.n}. ${cur?.category}, ${cur?.difficulty}. Place your wager.`,
    answer: 'The question is out. Pick an answer.',
    reveal: 'The answer is revealed.',
    standings: 'Standings.',
    final: 'Game over.',
  }[key.split(':')[0]];
  if (text) $('#announce').textContent = text;
}

function mount(key) {
  const type = key.split(':')[0];
  const next = NOTICE[type] ? noticeView(...NOTICE[type]) : BUILD[type]({ S, room: S.room });
  fill(view, next.el);
  mounted = { key, view: next };
  span = 1;
  announce(key);
}

const render = frameThrottle(() => {
  const key = routeKey();
  const chrome = S.room && key !== 'ended' && key !== 'removed';
  $('#topbar').hidden = !chrome;
  if (chrome) {
    const grouped = S.meta?.mode === 'group' && S.subject;
    fill($('#who'), grouped ? [h('span', { class: 'group-badge', style: `--group: ${groupColor(S.subject)}` }, h('span', { class: 'group-dot' }), groupLabel(S.subject))] : (S.me?.name ?? ''));
    $('#balance').textContent = fmt(S.score?.pts ?? START_POINTS);
  }
  if (key === null) return;
  if (key !== mounted.key) mount(key);
  mounted.view.update();
});

// The countdown bar, and sending a choice that was made but not locked in just before the deadline.
function tick() {
  const cur = S.cur;
  const running = S.room && cur && (cur.phase === 'bid' || cur.phase === 'answer') && cur.deadline && mounted.key === `${cur.phase}:${cur.qid}`;
  $('#timer').hidden = !running;
  if (!running) return;
  const left = cur.deadline - S.room.serverNow();
  span = Math.max(span, left, 1000);
  $('#timerFill').style.transform = `scaleX(${Math.max(0, Math.min(1, left / span))})`;
  $('#timer').classList.toggle('is-low', left < 5000);
  $('#timerNum').textContent = `${secondsLeft(cur.deadline, S.room.serverNow())}s`;
  if (left < 700 && flushed !== mounted.key) {
    flushed = mounted.key;
    mounted.view.flush?.();
  }
}

boot();
