// The big screen: build a quiz, open a game, show the players what is happening and run each round.
import { signIn } from './firebase.js';
import { Room } from './room.js';
import { Host } from './host.js';
import { toStored } from './quiz.js';
import { ICON } from './shapes.js';
import { createSounds } from './sounds.js';
import { mountTheme } from './theme.js';
import { $, confirmDialog, fill, frameThrottle, icon, secondsLeft, store, toast } from './ui.js';
import { builderView } from './admin-builder.js';
import { answerScreen, bidScreen, finalScreen, lobbyScreen, revealScreen, standingsScreen } from './admin-views.js';

const ROOM_KEY = 'qm.admin.room'; // the host's page is the game: a refresh must find its way back to it
const stage = $('#stage');

const A = { uid: null, room: null, host: null, joinUrl: '', joinLabel: '', key: null, view: null, span: 1 };
const sounds = createSounds();

// ---------------------------------------------------------------- start up
async function boot() {
  try {
    A.uid = await signIn();
  } catch {
    return fill(stage, 'Can’t connect to the game server. Check your connection and reload.');
  }
  const code = store.get(ROOM_KEY);
  if (code) {
    try {
      const room = new Room(code, A.uid);
      const meta = await room.getMeta();
      if (meta?.owner === A.uid) return resume(room);
    } catch {
      /* fall through to setup */
    }
    store.remove(ROOM_KEY);
  }
  showSetup();
}

function showSetup() {
  setChrome(false);
  const builder = builderView({ onCreate: createGame });
  A.key = 'setup';
  A.view = builder;
  fill(stage, builder.el);
  document.title = 'QuizMe: host';
}

async function createGame(quiz, settings) {
  const button = $('#createBtn');
  button.disabled = true;
  try {
    const room = await Room.create(A.uid, { title: quiz.title, ...settings }, toStored(quiz), quiz.questions.length);
    store.set(ROOM_KEY, room.code);
    await resume(room);
  } catch (err) {
    button.disabled = false;
    toast(err?.code === 'PERMISSION_DENIED' ? 'The database refused the new game. The QuizMe rules may not be published yet.' : 'Could not create the game. Check your connection and try again.', 6000);
  }
}

async function resume(room) {
  A.room = room;
  const page = new URL('student.html', location.href);
  A.joinUrl = `${page.origin}${page.pathname}?room=${room.code}`;
  A.joinLabel = `${page.host}${page.pathname}`;
  A.host = new Host(room, { onChange: () => render(), onError: showProblem });
  await A.host.start();
  document.title = `QuizMe: ${room.code}`;
  setChrome(true);
  fill(stage, 'Loading the game…');
}

// ---------------------------------------------------------------- the frame around every screen
function setChrome(inGame) {
  $('#chips').hidden = !inGame;
  $('#barActions').hidden = !inGame;
  if (!inGame) $('#controls').hidden = true;
  if (!inGame) $('#timer').hidden = true;
}

function showProblem(err) {
  const box = $('#problem');
  box.hidden = !err;
  if (!err) return;
  console.error(err);
  box.textContent = err.code === 'PERMISSION_DENIED' ? 'The database refused an update. The QuizMe rules may not be published yet: publish database.rules.json in the Firebase console, then reload this page.' : 'An update did not go through. The game will try again in a few seconds.';
}

const NEXT = {
  bid: 'Show the question',
  answer: 'Reveal the answer',
  reveal: 'Show standings',
  standings: (state) => (state.cur.n >= state.cur.total ? 'See final results' : 'Next question'),
  final: 'Set up a new game',
};
const PHASE = { bid: 'Wagers', answer: 'Answers', reveal: 'Answer revealed', standings: 'Standings', final: 'Game over' };

const BUILD = { lobby: lobbyScreen, bid: bidScreen, answer: answerScreen, reveal: revealScreen, standings: standingsScreen, final: finalScreen };

const render = frameThrottle(() => {
  const state = A.host?.state;
  if (!state?.cur || !state.meta) return;
  const { cur } = state;
  const key = cur.phase === 'lobby' || cur.phase === 'final' ? cur.phase : `${cur.phase}:${cur.qid}`;
  if (key !== A.key) {
    const wasBidding = A.key?.startsWith('bid:'); // a live change, not the page loading into a game in progress
    A.key = key;
    A.span = 1;
    A.view = BUILD[cur.phase]({ A, host: A.host });
    fill(stage, A.view.el);
    if (cur.phase === 'answer' && wasBidding) sounds.question(cur.n); // the question appears: a cute fanfare
    $('#announce').textContent = { lobby: 'Lobby open.', bid: `Question ${cur.n}: place your wagers.`, answer: 'The question is out.', reveal: 'The answer is revealed.', standings: 'Standings.', final: 'Game over.' }[cur.phase];
  }
  A.view.update(state);

  $('#chipCode').textContent = A.room.code;
  const players = Object.values(state.players);
  const online = players.filter((p) => p.on).length;
  $('#chipCount').textContent = online;
  $('#chipUnit').textContent = online === 1 ? 'player online' : 'players online';

  const controls = $('#controls');
  controls.hidden = cur.phase === 'lobby';
  if (cur.phase !== 'lobby') {
    const label = NEXT[cur.phase];
    $('#nextBtn').textContent = typeof label === 'function' ? label(state) : label;
    $('#finishBtn').hidden = cur.phase === 'final' || (cur.phase === 'standings' && cur.n >= cur.total);
    $('#phaseLabel').textContent = cur.phase === 'final' ? PHASE.final : `${PHASE[cur.phase]} · question ${cur.n} of ${cur.total}`;
  }
});

// The countdown along the top of the stage. It only shows while the clock is running. The question's music plays for exactly
// as long as the bar moves on the question (not during the wagers), and speeds up when the bar turns red.
const LOW_MS = 5000;
setInterval(() => {
  const cur = A.host?.state.cur;
  const running = cur && (cur.phase === 'bid' || cur.phase === 'answer') && cur.deadline;
  $('#timer').hidden = !running;
  const left = running ? cur.deadline - A.host.serverNow() : 0;
  sounds.music(Boolean(running) && cur.phase === 'answer' && left > 0, { n: cur?.n, hurry: left < LOW_MS });
  if (!running) return;
  A.span = Math.max(A.span, left, 1000);
  $('#timerFill').style.transform = `scaleX(${Math.max(0, Math.min(1, left / A.span))})`;
  $('#timer').classList.toggle('is-low', left < LOW_MS);
  $('#timerNum').textContent = secondsLeft(cur.deadline, A.host.serverNow());
}, 200);

// ---------------------------------------------------------------- the host's buttons
async function endGame(message) {
  const ok = await confirmDialog({ title: 'End this game?', text: message, confirm: 'End game', danger: true });
  if (!ok) return;
  A.host.stop();
  try {
    await A.room.end();
  } catch {
    /* already gone */
  }
  store.remove(ROOM_KEY);
  location.reload();
}

$('#nextBtn').addEventListener('click', () => {
  const state = A.host.state;
  if (state.cur.phase === 'final') return endGame('Players lose access to their final results, and you go back to setup.');
  A.host.next();
});
$('#finishBtn').addEventListener('click', async () => {
  if (await confirmDialog({ title: 'Finish the game now?', text: 'The current question is dropped and players see the final results.', confirm: 'Finish game' })) A.host.finish();
});
// the sound switch (the choice is remembered on this device); turning it on plays the fanfare so the host can hear it works,
// and brings the music back if a question is out
function paintSound() {
  const on = sounds.enabled;
  const button = $('#soundBtn');
  button.setAttribute('aria-pressed', String(on));
  fill(button, icon(on ? ICON.sound : ICON.mute, { size: 18 }), on ? 'Sound on' : 'Sound off');
}
$('#soundBtn').addEventListener('click', () => {
  sounds.setEnabled(!sounds.enabled);
  paintSound();
  if (sounds.enabled) sounds.question(A.host?.state.cur?.n);
});
document.addEventListener('pointerdown', () => sounds.unlock(), { once: true }); // browsers allow sound after the first click
paintSound();
mountTheme($('#themeSlot'));

$('#endBtn').addEventListener('click', () => endGame('The game and everyone’s results are deleted for good.'));
$('#fullscreenBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));

boot();
