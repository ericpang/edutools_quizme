// The big screen: build a quiz, open a game, show the players what is happening and run each round.
import { signIn } from './firebase.js';
import { Room } from './room.js';
import { Host } from './host.js';
import { toStored } from './quiz.js';
import { $, confirmDialog, fill, frameThrottle, secondsLeft, store, toast } from './ui.js';
import { builderView } from './admin-builder.js';
import { answerScreen, bidScreen, finalScreen, lobbyScreen, revealScreen, standingsScreen } from './admin-views.js';

const ROOM_KEY = 'qm.admin.room'; // the host's page is the game: a refresh must find its way back to it
const stage = $('#stage');

const A = { uid: null, room: null, host: null, joinUrl: '', joinLabel: '', key: null, view: null, span: 1 };

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
    A.key = key;
    A.span = 1;
    A.view = BUILD[cur.phase]({ A, host: A.host });
    fill(stage, A.view.el);
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

// The countdown along the top of the stage. It only shows while the clock is running.
setInterval(() => {
  const cur = A.host?.state.cur;
  const running = cur && (cur.phase === 'bid' || cur.phase === 'answer') && cur.deadline;
  $('#timer').hidden = !running;
  if (!running) return;
  const left = cur.deadline - A.host.serverNow();
  A.span = Math.max(A.span, left, 1000);
  $('#timerFill').style.transform = `scaleX(${Math.max(0, Math.min(1, left / A.span))})`;
  $('#timer').classList.toggle('is-low', left < 5000);
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
$('#endBtn').addEventListener('click', () => endGame('The game and everyone’s results are deleted for good.'));
$('#fullscreenBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));

boot();
