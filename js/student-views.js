// The player's screens, one builder per game phase. A view is { el, update(), flush?() }: `el` is built once when the
// phase starts, update() repaints the live parts from the shared state S whenever the database changes, and flush()
// sends a choice the player made but did not lock in, just before the deadline.
import { createDial, tokenName } from './dial.js';
import { captainOf } from './decide.js';
import { teamOf } from './engine.js';
import { groupColor, groupLabel } from './grouping.js';
import { calibration } from './report.js';
import { SIDE_BET_STAKE, START_POINTS, multiplier, shares } from './scoring.js';
import { ICON, OPTIONS } from './shapes.js';
import { fill, fmt, h, icon, signed, toast } from './ui.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const isGroup = (S) => S.meta?.mode === 'group';
const balance = (S) => S.score?.pts ?? START_POINTS;
const holdsToken = (S) => S.perk?.unlocked === true && S.perk?.used !== true;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const units = (S) => (isGroup(S) ? 'groups' : 'players');

function failed(err) {
  toast(err?.code === 'PERMISSION_DENIED' ? 'Too late: that part of the round has closed.' : 'That did not go through. Check your connection and try again.');
}

const questionHead = (cur) =>
  h(
    'div',
    { class: 'q-head' },
    h('span', { class: 'q-count' }, `Question ${cur.n} of ${cur.total}`),
    h('span', { class: 'tags' }, h('span', { class: 'tag' }, cur.category), h('span', { class: `tag diff-${cur.difficulty}` }, `${cap(cur.difficulty)} · pays ×${multiplier(cur.difficulty)}`)),
  );

// ---- group helpers
// Your teammates, what each has voted for this step, and who is Ready.
function teamPanel(S, step, describe) {
  const list = h('ul', { class: 'team-list' });
  const el = h('section', { class: 'team', 'aria-label': 'Your group' }, list);
  const update = () => {
    const team = teamOf(S, S.subject);
    const captain = captainOf(team, S.cur.n);
    fill(list, 
      ...team.map((uid) => {
        const vote = S.vote?.[uid]?.[step];
        return h(
          'li',
          { class: `team-row${S.players[uid]?.on === false ? ' is-away' : ''}` },
          h('span', { class: 'team-name' }, `${S.players[uid]?.name ?? '…'}${uid === S.uid ? ' (you)' : ''}`, uid === captain && icon(ICON.crown, { size: 16, label: 'Captain' })),
          h('span', { class: 'team-vote' }, vote && describe(vote) ? describe(vote) : 'Thinking…'),
          h('span', { class: `team-ready${vote?.ok ? ' is-on' : ''}` }, vote?.ok ? [icon(ICON.check, { size: 16 }), 'Ready'] : ''),
        );
      }),
    );
  };
  return { el, update };
}

function readyButton(label, onclick, id) {
  const btn = h('button', { class: 'btn primary big', type: 'button', id, 'aria-pressed': 'false', onclick }, label);
  btn.set = (on) => {
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Ready: tap to change' : label;
    btn.classList.toggle('is-on', on);
  };
  return btn;
}

const captainNote = (S) => {
  const captain = captainOf(teamOf(S, S.subject), S.cur.n);
  return h('p', { class: 'muted small' }, 'Captain this round: ', h('b', {}, captain === S.uid ? 'you' : (S.players[captain]?.name ?? '…')), '. A tie goes to the captain’s pick.');
};

// ---- before the game
export function lobbyView({ S }) {
  const title = h('h1', { class: 'title' });
  const body = h('div', { class: 'stack' });
  return {
    el: h('section', { class: 'stack' }, title, body),
    update() {
      title.textContent = `You’re in, ${S.me?.name ?? ''}.`;
      if (!isGroup(S)) return fill(body, h('p', { class: 'lead' }, 'Waiting for the host to start the game.'));
      if (!S.subject) return fill(body, h('p', { class: 'lead' }, 'Waiting for the host. Groups are formed at random just before the game starts.'));
      const team = teamOf(S, S.subject);
      fill(body, 
        h('p', { class: 'group-badge', style: `--group: ${groupColor(S.subject)}` }, h('span', { class: 'group-dot' }), groupLabel(S.subject)),
        h('p', { class: 'lead' }, 'Your teammates:'),
        h('ul', { class: 'team-list' }, team.map((uid) => h('li', { class: 'team-row' }, h('span', { class: 'team-name' }, S.players[uid]?.name ?? '…', uid === S.uid ? ' (you)' : '')))),
        h('p', { class: 'muted' }, 'The host may shuffle the groups again before the game starts.'),
      );
    },
  };
}

// ---- bid: wager before you see the question
export function bidView({ S, room }) {
  const group = isGroup(S);
  const cur = S.cur;
  const draft = { token: null, touched: false };
  let restored = false;

  const send = (ok) => room.vote(cur.qid, S.subject, 'bid', { pct: dial.value, ...(draft.token ? { tok: draft.token } : {}), ...(ok ? { ok: true } : {}) }).catch(failed);

  const dial = createDial({
    score: balance(S),
    difficulty: cur.difficulty,
    max: S.meta.maxWager,
    onInput: () => (draft.touched = true),
    onChange: () => group && send(false),
  });

  // the Safety Net token chooser, only for someone who holds one
  const pickToken = (value) => {
    draft.token = value;
    draft.touched = true;
    dial.setToken(value);
    if (group) send(false);
  };
  const seg = (value, label, hint, path) =>
    h(
      'label',
      { class: 'seg' },
      h('input', { type: 'radio', name: 'token', value, checked: value === '', onchange: () => pickToken(value || null) }),
      h('span', { class: 'seg-body' }, h('b', {}, path && icon(path, { size: 18 }), label), h('small', {}, hint)),
    );
  const tokenBox = h('fieldset', { class: 'token', hidden: true }, h('legend', {}, 'You hold a Safety Net token'), h('div', { class: 'seg-row' }, seg('', 'Keep it', 'Use it later'), seg('dd', 'Double Down', 'A right answer pays twice', ICON.double), seg('sh', 'Shield', 'A wrong answer costs nothing', ICON.shield)));

  const lockBtn = h('button', { class: 'btn primary big', type: 'button', id: 'lockBtn', onclick: lockSolo }, 'Lock in wager');
  const readyBtn = readyButton('Ready', () => send(!S.vote?.[S.uid]?.bid?.ok), 'readyBtn');
  const status = h('p', { class: 'status', hidden: true });
  const team = teamPanel(S, 'bid', (v) => `${v.pct}%${v.tok ? ` · ${tokenName(v.tok)}` : ''}`);

  async function lockSolo() {
    if (S.bid) return;
    lockBtn.disabled = true;
    try {
      await room.bid(cur.qid, dial.value, draft.token);
    } catch (err) {
      failed(err);
      lockBtn.disabled = false;
    }
  }

  const el = h(
    'section',
    { class: 'stack' },
    questionHead(cur),
    h('h1', { class: 'title' }, 'How sure are you?'),
    h('p', { class: 'lead' }, group ? 'Agree a wager with your group before you see the question. Speed never counts.' : 'Wager before you see the question. Speed never counts.'),
    dial.el,
    tokenBox,
    group && team.el,
    status,
    group ? readyBtn : lockBtn,
    group && captainNote(S),
  );

  return {
    el,
    update() {
      const locked = !!S.bid;
      dial.setScore(balance(S));
      if (group && !restored) {
        restored = true;
        const mine = S.vote?.[S.uid]?.bid;
        if (mine) {
          dial.setValue(mine.pct);
          draft.token = mine.tok ?? null;
          dial.setToken(draft.token);
          for (const input of tokenBox.querySelectorAll('input')) input.checked = input.value === (draft.token ?? '');
        }
      }
      if (locked) {
        dial.setValue(S.bid.pct);
        dial.setToken(S.bid.token ?? null);
      }
      dial.lock(locked);
      tokenBox.hidden = locked || !holdsToken(S);
      lockBtn.hidden = locked;
      readyBtn.hidden = locked;
      status.hidden = !locked;
      if (locked) {
        const pts = Math.floor((balance(S) * S.bid.pct) / 100);
        status.textContent = `${group ? 'Your group wagered' : 'Wager locked:'} ${S.bid.pct}% (${fmt(pts)} points)${S.bid.token ? ` with ${tokenName(S.bid.token)}` : ''}. The question appears when everyone has locked in.`;
      }
      if (group) {
        readyBtn.set(!!S.vote?.[S.uid]?.bid?.ok);
        team.update();
      }
    },
    flush() {
      if (!group && !S.bid && draft.touched) lockSolo();
    },
  };
}

// ---- answer: pick an option, then see the crowd and bet on it
export function answerView({ S, room }) {
  const group = isGroup(S);
  const cur = S.cur;
  let picked = null;
  let restored = false;

  const buttons = cur.options.map((text, i) =>
    h(
      'button',
      { class: `option o${i}`, type: 'button', 'aria-pressed': 'false', onclick: () => pick(i) },
      h('span', { class: 'option-mark' }, icon(OPTIONS[i].shape, { size: 24 }), h('b', {}, OPTIONS[i].letter)),
      h('span', { class: 'option-text' }, text),
    ),
  );
  const lockBtn = h('button', { class: 'btn primary big', type: 'button', id: 'lockBtn', onclick: lockSolo, disabled: true }, 'Lock in answer');
  const readyBtn = readyButton('Ready', () => picked !== null && room.vote(cur.qid, S.subject, 'ans', { v: picked, ...(S.vote?.[S.uid]?.ans?.ok ? {} : { ok: true }) }).catch(failed), 'readyBtn');
  const status = h('p', { class: 'status', hidden: true });
  const team = teamPanel(S, 'ans', (v) => (v.v === undefined ? '' : `chose ${OPTIONS[v.v]?.letter ?? '?'}`));

  function pick(i) {
    if (S.ans) return;
    picked = i;
    paint();
    if (group) room.vote(cur.qid, S.subject, 'ans', { v: i }).catch(failed);
  }
  async function lockSolo() {
    if (S.ans || picked === null) return;
    lockBtn.disabled = true;
    try {
      await room.answer(cur.qid, picked);
    } catch (err) {
      failed(err);
      lockBtn.disabled = false;
    }
  }
  function paint() {
    const chosen = S.ans ? S.ans.v : picked;
    buttons.forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String(chosen === i));
      btn.disabled = !!S.ans;
      btn.classList.toggle('is-dim', chosen !== null && chosen !== i);
    });
    lockBtn.disabled = picked === null || !!S.ans;
  }

  // after answering
  const bars = h('div', { class: 'bars' });
  const statsNote = h('p', { class: 'muted small' });
  const statsBox = h('section', { class: 'panel', hidden: true }, h('h2', { class: 'sub' }, 'How the class is answering'), bars, statsNote);

  const stake = () => Math.min(SIDE_BET_STAKE, balance(S));
  const sideNote = h('p', { class: 'muted small' });
  const sideTeam = teamPanel(S, 'side', (v) => (v.v === 'right' ? 'most will be right' : v.v === 'wrong' ? 'most will be wrong' : v.v === 'none' ? 'no bet' : ''));
  const sideReady = readyButton('Ready', () => room.vote(cur.qid, S.subject, 'side', { ...(S.vote?.[S.uid]?.side?.v ? { v: S.vote[S.uid].side.v } : {}), ...(S.vote?.[S.uid]?.side?.ok ? {} : { ok: true }) }).catch(failed), 'sideReadyBtn');
  const betBtn = (v, label) =>
    h('button', { class: 'btn', type: 'button', 'data-bet': v, 'aria-pressed': 'false', onclick: () => bet(v) }, label);
  const betButtons = [betBtn('right', 'Most will be right'), betBtn('wrong', 'Most will be wrong'), betBtn('none', 'No bet')];
  const sideBox = h(
    'section',
    { class: 'panel', hidden: true },
    h('h2', { class: 'sub' }, 'Side-bet'),
    h('p', {}, group ? 'Will most of the groups get this right? Vote, then press Ready.' : 'Will most of the class get this right?'),
    h('div', { class: 'bet-row' }, betButtons),
    sideNote,
    group && sideTeam.el,
    group && sideReady,
  );
  function bet(v) {
    if (S.side) return;
    const call = group ? room.vote(cur.qid, S.subject, 'side', { v }) : room.sideBet(cur.qid, v);
    call.catch(failed);
  }

  const el = h(
    'section',
    { class: 'stack' },
    questionHead(cur),
    h('h1', { class: 'q-text' }, cur.text),
    h('div', { class: 'options' }, buttons),
    group && h('div', { class: 'stack' }, h('div', { hidden: false, class: 'stack tight', 'data-when': 'open' }, team.el, captainNote(S), readyBtn)),
    !group && lockBtn,
    status,
    statsBox,
    sideBox,
  );

  return {
    el,
    update() {
      const answered = !!S.ans;
      if (group && !restored) {
        restored = true;
        picked = S.vote?.[S.uid]?.ans?.v ?? null;
      }
      paint();
      lockBtn.hidden = answered;
      if (group) {
        const open = el.querySelector('[data-when="open"]');
        open.hidden = answered;
        readyBtn.set(!!S.vote?.[S.uid]?.ans?.ok);
        team.update();
      }
      status.hidden = !answered;
      if (answered) status.textContent = group ? `Your group locked in ${OPTIONS[S.ans.v].letter}.` : `Answer locked: ${OPTIONS[S.ans.v].letter}.`;

      statsBox.hidden = !answered;
      sideBox.hidden = !answered;
      if (!answered) return;

      if (S.stats) {
        const pct = shares(S.stats.counts ?? [], S.stats.answered);
        fill(bars, 
          ...cur.options.map((_, i) =>
            h('div', { class: 'bar-row' }, h('span', { class: `bar-key o${i}` }, OPTIONS[i].letter), h('span', { class: 'bar-track' }, h('span', { class: `bar-fill o${i}`, style: `width: ${pct[i]}%` })), h('span', { class: 'bar-val num' }, `${pct[i]}%`)),
          ),
        );
        statsNote.textContent = `${S.stats.answered} of ${S.stats.total} ${units(S)} have answered so far. This does not say which option is right.`;
      } else {
        fill(bars);
        statsNote.textContent = 'Live class stats appear once a few answers are in.';
      }

      const placed = S.side?.v;
      const voted = S.vote?.[S.uid]?.side?.v;
      const shown = group ? (placed ?? voted) : placed;
      for (const btn of betButtons) {
        btn.setAttribute('aria-pressed', String(shown === btn.dataset.bet));
        btn.disabled = !!placed;
      }
      sideNote.textContent = placed
        ? placed === 'none'
          ? 'No bet this round.'
          : `Bet placed: most ${units(S)} will be ${placed}. You stake ${fmt(stake())} points at even odds.`
        : `${fmt(stake())} points at even odds. If exactly half are right, you keep your stake.`;
      if (group) {
        sideReady.hidden = !!placed;
        sideReady.set(!!S.vote?.[S.uid]?.side?.ok);
        sideTeam.update();
      }
    },
    flush() {
      if (!group && !S.ans && picked !== null) lockSolo();
    },
  };
}

// ---- reveal: what happened
export function revealView({ S }) {
  const cur = S.cur;
  const verdict = h('p', { class: 'verdict', 'aria-live': 'polite' });
  const options = h(
    'div',
    { class: 'options is-static' },
    cur.options.map((text, i) => h('div', { class: `option o${i}`, 'data-i': i }, h('span', { class: 'option-mark' }, icon(OPTIONS[i].shape, { size: 24 }), h('b', {}, OPTIONS[i].letter)), h('span', { class: 'option-text' }, text), h('span', { class: 'option-flag' }))),
  );
  const lines = h('dl', { class: 'lines' });
  const total = h('output', { class: 'total num' });
  const note = h('p', { class: 'muted' });
  const why = h('p', { class: 'explain', hidden: true });
  let counted = false;

  function countUp(from, to) {
    if (reduceMotion() || from === to) return (total.textContent = fmt(to));
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / 1100);
      total.textContent = fmt(from + (to - from) * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  return {
    el: h('section', { class: 'stack' }, questionHead(cur), verdict, h('h1', { class: 'q-text small' }, cur.text), options, lines, h('p', { class: 'total-row' }, h('span', {}, 'New balance'), total), note, why),
    update() {
      const { out, res } = S;
      if (!out || !res) {
        verdict.textContent = '';
        fill(lines);
        note.textContent = res ? 'You have no result for this question.' : 'Waiting for the results…';
        return;
      }
      const mark = out.pick < 0 ? 'none' : out.ok ? 'right' : 'wrong';
      verdict.className = `verdict is-${mark}`;
      verdict.textContent = mark === 'none' ? (isGroup(S) ? 'No answer from your group' : 'No answer') : cap(mark === 'right' ? 'right' : 'wrong');
      options.querySelectorAll('.option').forEach((opt, i) => {
        opt.classList.toggle('is-correct', i === res.correct);
        opt.classList.toggle('is-mine', i === out.pick);
        opt.classList.toggle('is-dim', i !== res.correct && i !== out.pick);
        fill(opt.querySelector('.option-flag'), i === res.correct ? icon(ICON.check, { size: 26, label: 'Correct answer' }) : i === out.pick ? icon(ICON.cross, { size: 26, label: 'Your answer' }) : '');
      });
      const row = (k, v, cls = '') => [h('dt', {}, k), h('dd', { class: cls }, v)];
      fill(lines, 
        ...row('Wager', `${out.pct}% · ${fmt(out.wager)} points`),
        ...row(out.pick < 0 ? 'No answer' : out.ok ? 'Right answer' : 'Wrong answer', `${signed(out.main)}${out.token ? ` · ${tokenName(out.token)}` : ''}`, out.main > 0 ? 'is-gain' : out.main < 0 ? 'is-loss' : ''),
        ...row('Side-bet', out.bet ? `${out.bet === 'right' ? 'Most right' : 'Most wrong'} · ${out.side ? signed(out.side) : 'push'}` : 'No bet', out.side > 0 ? 'is-gain' : out.side < 0 ? 'is-loss' : ''),
      );
      if (!counted) {
        counted = true;
        countUp(Math.max(0, out.pts - out.main - out.side), out.pts); // from the balance before this question
      }
      note.textContent = `${res.accuracy}% of ${units(S)} answered correctly (${res.answered} of ${res.total}).`;
      why.hidden = !res.explanation;
      why.textContent = res.explanation ?? '';
    },
  };
}

// ---- standings
export function standingsView({ S }) {
  const rank = h('p', { class: 'rank-line' });
  const points = h('p', { class: 'lead' });
  const perk = h('section', { class: 'panel perk', hidden: true }, h('h2', { class: 'sub' }, h('span', {}, icon(ICON.shield, { size: 20 }), ' Safety Net token')), h('p', {}, 'You hold one token for the rest of the game. Arm it when you wager: Double Down doubles a right answer, Shield makes a wrong one free.'));
  const last = S.cur.n >= S.cur.total;
  return {
    el: h('section', { class: 'stack' }, h('h1', { class: 'title' }, `After question ${S.cur.n}`), rank, points, perk, h('p', { class: 'muted' }, last ? 'That was the last question. The final results are next.' : 'The next question starts when the host is ready.')),
    update() {
      const sc = S.score;
      fill(rank, sc?.rank ? [h('span', { class: 'num rank' }, `#${sc.rank}`), ` of ${sc.of}`] : '');
      points.textContent = `${fmt(balance(S))} points${isGroup(S) ? ` for ${groupLabel(S.subject)}` : ''}`;
      perk.hidden = !holdsToken(S);
    },
  };
}

// ---- final
export function finalView({ S, room }) {
  const rank = h('p', { class: 'rank-line' });
  const report = h('section', { class: 'panel', hidden: true });
  let loading = false;

  async function load() {
    loading = true;
    try {
      const rows = await room.history(S.cur.total, S.subject, isGroup(S));
      const played = rows.filter((r) => r.out && r.res);
      const cal = calibration(played.map((r) => ({ category: r.res.category, pct: r.out.pct, ok: r.out.ok })));
      if (!cal) return;
      const said = { over: 'a little overconfident: you bet more than you earned', under: 'a little underconfident: you could have risked more', calibrated: 'well calibrated: your wagers matched your results' };
      const bar = (label, value, cls) => h('span', { class: 'cal-bar' }, h('span', { class: `cal-fill ${cls}`, style: `width: ${value}%` }), h('span', { class: 'cal-val num' }, `${label} ${value}%`));
      const agree = isGroup(S) ? played.filter((r) => r.vote?.v !== undefined && r.ans && r.vote.v === r.ans.v).length : null;
      const voted = isGroup(S) ? played.filter((r) => r.vote?.v !== undefined).length : 0;
      fill(report, 
        h('h2', { class: 'sub' }, 'How well did your wagers match your results?'),
        h('p', {}, `Overall you wagered ${cal.overall.wager}% on average and were right ${cal.overall.accuracy}% of the time: ${said[cal.overall.verdict]}.`),
        h('ul', { class: 'cal-list' }, cal.categories.map((c) => h('li', { class: 'cal-row' }, h('span', { class: 'cal-cat' }, c.category, h('small', {}, ` ${c.n} question${c.n === 1 ? '' : 's'}`)), bar('Wagered', c.wager, 'is-wager'), bar('Right', c.accuracy, 'is-right')))),
        agree !== null && voted > 0 && h('p', { class: 'muted' }, `Your answer vote matched your group’s choice on ${agree} of ${voted} questions.`),
        h('p', { class: 'muted small' }, 'Wagering about as much as you are often right is what calibrated confidence looks like.'),
      );
      report.hidden = false;
    } catch {
      /* the report is a bonus: stay quiet if it cannot be loaded */
    }
  }

  return {
    el: h('section', { class: 'stack' }, h('h1', { class: 'title' }, 'Game over'), rank, report),
    update() {
      const sc = S.score;
      fill(rank, sc?.rank ? [h('span', { class: 'num rank' }, `#${sc.rank}`), ` of ${sc.of} · ${fmt(sc.pts)} points`] : `${fmt(balance(S))} points`);
      if (!loading && S.subject) load();
    },
  };
}

// ---- notices
export const noticeView = (title, text) => ({ el: h('section', { class: 'stack' }, h('h1', { class: 'title' }, title), h('p', { class: 'lead' }, text)), update() {} });
