// The stake dial: the control that makes a wager feel like one. A ruler-style slider whose colour runs from cool to hot
// with the risk, and a two-column ledger underneath: what the wager wins if right, and what it costs if wrong.
import { breakEven, multiplier, stakes } from './scoring.js';
import { fmt, h, signed } from './ui.js';

// ice -> amber -> vermilion, matching --ice, --amber and --vermilion in css/style.css
const STOPS = [
  [0, [143, 227, 238]],
  [50, [255, 209, 102]],
  [100, [255, 93, 93]],
];

export function riskColor(pct) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const [from, to] = p <= 50 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
  const t = (p - from[0]) / (to[0] - from[0]);
  const [r, g, b] = from[1].map((v, i) => Math.round(v + (to[1][i] - v) * t));
  return `rgb(${r} ${g} ${b})`;
}

const TOKENS = { dd: 'Double Down', sh: 'Shield' };

// score: the balance being wagered from; difficulty: easy | medium | hard; max: the host's cap in %.
export function createDial({ score, difficulty, max = 100, value = 0, token = null, onInput = () => {}, onChange = () => {} }) {
  const model = { score, difficulty, max, token };

  const pct = h('output', { class: 'dial-pct num' });
  const stakeLine = h('p', { class: 'dial-stake' });
  const range = h('input', { class: 'dial-range', type: 'range', min: 0, max, step: 1, value: Math.min(value, max), 'aria-label': 'Wager, as a percentage of your points' });
  const marker = h('span', { class: 'dial-marker' }, h('span', { class: 'dial-marker-label' }));
  const rightNum = h('span', { class: 'ledger-v num' });
  const rightNote = h('span', { class: 'ledger-n' });
  const wrongNum = h('span', { class: 'ledger-v num' });
  const wrongNote = h('span', { class: 'ledger-n' });
  const el = h(
    'section',
    { class: 'dial', 'aria-label': 'Your wager' },
    h('div', { class: 'dial-head' }, pct, stakeLine),
    h('div', { class: 'dial-ctl' }, range, h('span', { class: 'dial-ticks', 'aria-hidden': 'true' })),
    h('div', { class: 'dial-axis' }, h('span', {}, 'Play safe'), marker, h('span', {}, model.max < 100 ? `Cap ${model.max}%` : 'All in')),
    h(
      'div',
      { class: 'ledger' },
      h('div', { class: 'ledger-cell is-right' }, h('span', { class: 'ledger-k' }, 'If right'), rightNum, rightNote),
      h('div', { class: 'ledger-cell is-wrong' }, h('span', { class: 'ledger-k' }, 'If wrong'), wrongNum, wrongNote),
    ),
  );

  function render() {
    const v = Number(range.value);
    const s = stakes({ score: model.score, pct: v, difficulty: model.difficulty, max: model.max });
    const doubled = model.token === 'dd';
    const shielded = model.token === 'sh';
    const win = doubled ? s.ifRightDouble : s.ifRight;

    el.style.setProperty('--risk', riskColor(v));
    el.style.setProperty('--at-r', String(breakEven(model.difficulty) / 100)); // where the break-even marker sits
    pct.textContent = `${v}%`;
    stakeLine.replaceChildren('Staking ', h('b', {}, fmt(s.wager)), ` of ${fmt(model.score)} points`);
    rightNum.textContent = signed(win);
    rightNote.textContent = doubled ? 'Double Down: twice the gain' : `${model.difficulty[0].toUpperCase()}${model.difficulty.slice(1)} pays ×${multiplier(model.difficulty)}`;
    wrongNum.textContent = shielded ? '0' : signed(s.ifWrong);
    wrongNote.textContent = shielded ? 'Shield: your wager comes back' : s.wager ? 'The wager is lost' : 'Nothing at risk';
    marker.hidden = breakEven(model.difficulty) > model.max;
    marker.firstChild.textContent = `Worth raising above ${breakEven(model.difficulty)}% sure`;
    range.setAttribute('aria-valuetext', `${v} percent. Staking ${fmt(s.wager)} points: ${signed(win)} if right, ${shielded ? '0' : signed(s.ifWrong)} if wrong.`);
  }

  range.addEventListener('input', () => {
    render();
    onInput(Number(range.value));
  });
  range.addEventListener('change', () => onChange(Number(range.value)));
  render();

  return {
    el,
    get value() {
      return Number(range.value);
    },
    setValue(v) {
      range.value = Math.min(model.max, Math.max(0, v));
      render();
    },
    setToken(t) {
      model.token = t;
      render();
    },
    setScore(s) {
      model.score = s;
      render();
    },
    lock(locked) {
      range.disabled = locked;
      el.classList.toggle('is-locked', locked);
    },
  };
}

export const tokenName = (t) => TOKENS[t] ?? '';
