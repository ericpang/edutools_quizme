// The host's screens: the lobby, and one projector view per phase. A screen is { el, update(state) }.
// The big screen never shows individual wagers or the bottom of the ranking.
import { canStart, leaderboard, progress, subjectsOf, teamOf } from './engine.js';
import { groupColor, groupLabel } from './grouping.js';
import { MIN_PLAYERS, multiplier, shares } from './scoring.js';
import { ICON, OPTIONS } from './shapes.js';
import { confirmDialog, fill, fmt, h, icon } from './ui.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const isGroup = (state) => state.meta?.mode === 'group';
const unit = (state, n = 2) => (isGroup(state) ? (n === 1 ? 'group' : 'groups') : n === 1 ? 'player' : 'players');
const byJoin = (a, b) => (a[1].ts ?? 0) - (b[1].ts ?? 0);

const nameOf = (state, id) => (isGroup(state) ? groupLabel(id) : (state.players[id]?.name ?? '…'));
const membersOf = (state, id) => (isGroup(state) ? teamOf(state, id).map((uid) => state.players[uid]?.name ?? '…').join(', ') : '');

const groupBadge = (id) => h('span', { class: 'group-badge', style: `--group: ${groupColor(id)}` }, h('span', { class: 'group-dot' }), groupLabel(id));

// ---- lobby
export function lobbyScreen({ A, host }) {
  const group = isGroup(host.state);
  const qr = h('div', { class: 'qr', id: 'qr', role: 'img', 'aria-label': 'QR code to join the game' });
  if (window.QRCode) new window.QRCode(qr, { text: A.joinUrl, width: 220, height: 220, colorDark: '#0d3b45', colorLight: '#eef5f2', correctLevel: window.QRCode.CorrectLevel.M });

  const roster = h('ul', { class: 'roster', id: 'roster' });
  const heading = h('h2', { class: 'sub', id: 'rosterHead' });
  const groupsBox = h('div', { class: 'groups', id: 'groups' });
  const shuffle = h('button', { class: 'btn', id: 'shuffleBtn', type: 'button', onclick: () => host.shuffle() }, icon(ICON.shuffle, { size: 18 }), 'Shuffle groups');
  const openSwitch = h('input', { type: 'checkbox', id: 'openSwitch', onchange: (e) => host.setOpen(e.target.checked) });
  const start = h('button', { class: 'btn primary big', id: 'startBtn', type: 'button', onclick: () => host.next() }, 'Start game');
  const note = h('p', { class: 'muted', id: 'startNote' });

  const remove = async (uid, name) => {
    if (await confirmDialog({ title: `Remove ${name}?`, text: 'They leave the game and cannot rejoin it.', confirm: 'Remove player', danger: true })) host.remove(uid);
  };

  const el = h(
    'section',
    { class: 'lobby' },
    h('div', { class: 'lobby-join' }, h('p', { class: 'lead' }, 'Join at ', h('b', {}, A.joinLabel)), h('p', { class: 'lead' }, 'and enter the code'), h('p', { class: 'code num', id: 'bigCode' }, A.room.code), qr),
    h(
      'div',
      { class: 'lobby-side' },
      heading,
      roster,
      group && h('div', { class: 'row' }, shuffle),
      group && groupsBox,
      h('label', { class: 'switch' }, openSwitch, h('span', {}, 'Let new players join')),
      start,
      note,
    ),
  );

  return {
    el,
    update(state) {
      const players = Object.entries(state.players).sort(byJoin);
      fill(heading, `${players.filter(([, p]) => p.on).length} online`, players.length !== players.filter(([, p]) => p.on).length ? ` · ${players.length} joined` : '');
      fill(
        roster,
        players.map(([uid, p]) =>
          h('li', { class: `person${p.on ? '' : ' is-away'}` }, h('span', { class: 'dot', title: p.on ? 'Online' : 'Away' }), h('span', { class: 'person-name' }, p.name), h('button', { class: 'person-x', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => remove(uid, p.name) }, icon(ICON.cross, { size: 14 }))),
        ),
      );
      if (group) {
        const subs = subjectsOf(state);
        shuffle.disabled = players.filter(([, p]) => p.on).length < MIN_PLAYERS.group;
        fill(
          groupsBox,
          subs.length
            ? subs.map((s) => h('article', { class: 'group-card', style: `--group: ${groupColor(s.id)}` }, h('h3', {}, groupBadge(s.id)), h('p', {}, s.members.map((uid) => state.players[uid]?.name).join(', '))))
            : h('p', { class: 'muted' }, 'Groups are formed when you press Shuffle groups, or automatically when you start.'),
        );
      }
      openSwitch.checked = state.meta.open === true;
      const can = canStart(state);
      start.disabled = !can.ok;
      note.textContent = can.ok ? (group ? 'Players are shuffled into groups if you have not done it yet.' : 'You can start with whoever has joined. Late players cannot join once the game starts.') : can.reason;
    },
  };
}

// ---- bid: players see only the category and difficulty
export function bidScreen() {
  const count = h('p', { class: 'p-kicker' });
  const category = h('h1', { class: 'p-cat' });
  const diff = h('p', { class: 'p-diff' });
  const done = h('b', { class: 'num' });
  const of = h('span', {});
  return {
    el: h('section', { class: 'p-center' }, count, category, diff, h('p', { class: 'p-note' }, 'Place your wager. The question appears when everyone has locked in.'), h('p', { class: 'p-progress' }, done, of)),
    update(state) {
      const { cur } = state;
      count.textContent = `Question ${cur.n} of ${cur.total}`;
      category.textContent = cur.category;
      diff.className = `p-diff diff-${cur.difficulty}`;
      diff.textContent = `${cap(cur.difficulty)} · a right answer pays ×${multiplier(cur.difficulty)}`;
      const p = progress(state);
      done.textContent = p ? p.done : 0;
      of.textContent = ` of ${p?.total ?? 0} ${unit(state, p?.total)} have locked in`;
    },
  };
}

const optionTile = (text, i) => h('div', { class: `option o${i}`, 'data-i': i }, h('span', { class: 'option-mark' }, icon(OPTIONS[i].shape, { size: 28 }), h('b', {}, OPTIONS[i].letter)), h('span', { class: 'option-text' }, text), h('span', { class: 'option-flag' }), h('span', { class: 'option-count num' }));

// ---- answer
export function answerScreen() {
  const count = h('p', { class: 'p-kicker' });
  const question = h('h1', { class: 'p-question' });
  const options = h('div', { class: 'options is-grid' });
  const done = h('b', { class: 'num' });
  const of = h('span', {});
  let built = '';
  return {
    el: h('section', { class: 'p-answer' }, count, question, options, h('p', { class: 'p-progress' }, done, of)),
    update(state) {
      const { cur } = state;
      count.textContent = `Question ${cur.n} of ${cur.total} · ${cur.category}`;
      question.textContent = cur.text;
      if (built !== cur.qid) {
        built = cur.qid;
        fill(options, cur.options.map(optionTile));
      }
      const p = progress(state);
      done.textContent = p ? p.done : 0;
      of.textContent = ` of ${p?.total ?? 0} ${unit(state, p?.total)} have answered`;
    },
  };
}

// ---- reveal
export function revealScreen() {
  const question = h('h1', { class: 'p-question small' });
  const options = h('div', { class: 'options is-grid' });
  const verdict = h('p', { class: 'p-verdict' });
  const bets = h('p', { class: 'p-note' });
  const why = h('p', { class: 'explain', hidden: true });
  let built = '';
  return {
    el: h('section', { class: 'p-answer' }, question, options, verdict, bets, why),
    update(state) {
      const { cur, res } = state;
      question.textContent = cur.text;
      if (built !== cur.qid) {
        built = cur.qid;
        fill(options, cur.options.map(optionTile));
      }
      if (!res) return fill(verdict, 'Scoring…');
      const most = Math.max(1, ...res.counts);
      options.querySelectorAll('.option').forEach((tile, i) => {
        tile.classList.toggle('is-correct', i === res.correct);
        tile.classList.toggle('is-dim', i !== res.correct);
        tile.style.setProperty('--share', `${Math.round(((res.counts[i] ?? 0) / most) * 100)}%`);
        tile.querySelector('.option-count').textContent = res.counts[i] ?? 0;
        fill(tile.querySelector('.option-flag'), i === res.correct ? icon(ICON.check, { size: 36, label: 'Correct answer' }) : '');
      });
      const u = unit(state);
      verdict.textContent = res.answered === 0 ? `No ${u} answered.` : `${res.accuracy}% of ${u} were right. ${{ right: 'Most got it right.', wrong: 'Most got it wrong.', push: 'Exactly half got it right.' }[res.majority]}`;
      const placed = Object.values(state.side);
      const right = placed.filter((b) => b.v === 'right').length;
      const wrong = placed.filter((b) => b.v === 'wrong').length;
      bets.textContent = res.majority === 'push' ? 'Side-bets are returned.' : right + wrong ? `Side-bets: ${right} said most would be right, ${wrong} said wrong.` : 'Nobody placed a side-bet.';
      why.hidden = !res.explanation;
      why.textContent = res.explanation ?? '';
    },
  };
}

// ---- standings: the top five only
export function standingsScreen() {
  const title = h('h1', { class: 'p-title' });
  const rows = h('ol', { class: 'board' });
  return {
    el: h('section', { class: 'p-board' }, title, rows),
    update(state) {
      title.textContent = state.cur.n >= state.cur.total ? 'Almost there' : `Top 5 after question ${state.cur.n}`;
      fill(
        rows,
        leaderboard(state)
          .slice(0, 5)
          .map((row) => h('li', { class: 'board-row' }, h('span', { class: 'board-rank num' }, row.rank), h('span', { class: 'board-name' }, isGroup(state) ? groupBadge(row.id) : nameOf(state, row.id), isGroup(state) && h('small', {}, membersOf(state, row.id))), h('span', { class: 'board-pts num' }, fmt(row.pts)))),
      );
    },
  };
}

// ---- final: the podium
export function finalScreen() {
  const title = h('h1', { class: 'p-title' }, 'Final results');
  const podium = h('div', { class: 'podium' });
  const note = h('p', { class: 'p-note' }, 'Everyone gets a private report on their phone: how well their wagers matched their results.');
  return {
    el: h('section', { class: 'p-board' }, title, podium, note),
    update(state) {
      const top = leaderboard(state).slice(0, 3);
      const place = (row, i) =>
        row &&
        h('div', { class: `podium-col place-${i + 1}` }, h('span', { class: 'podium-name' }, isGroup(state) ? groupBadge(row.id) : nameOf(state, row.id)), isGroup(state) && h('small', {}, membersOf(state, row.id)), h('span', { class: 'podium-pts num' }, fmt(row.pts)), h('span', { class: 'podium-step num' }, row.rank));
      fill(podium, [place(top[1], 1), place(top[0], 0), place(top[2], 2)]);
    },
  };
}
