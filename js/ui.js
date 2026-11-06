// Small DOM helpers. Text always goes in through textContent, so a player's name can never inject markup.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// h('button', { class: 'btn', onclick: fn, disabled: true }, 'Label', otherNode)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child.nodeType ? child : document.createTextNode(child));
  }
  return el;
}

// Replace an element's children; like h(), it takes nodes, strings and arrays, and skips false, null and undefined.
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== false && c !== null && c !== undefined).map((c) => (c.nodeType ? c : document.createTextNode(c))));
  return el;
}

// An inline SVG from a path string (icons and shapes), drawn on a 24x24 grid in the current text colour.
export function icon(path, { size = 20, label = '', color = 'currentColor' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', color);
  svg.setAttribute('class', 'icon');
  if (label) svg.setAttribute('aria-label', label);
  else svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

// A modal question with two buttons, built on <dialog> so focus, Escape and the backdrop just work. Resolves to true/false.
export function confirmDialog({ title, text, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'dialogTitle' },
      h(
        'form',
        { method: 'dialog', class: 'stack' },
        h('h2', { class: 'sub', id: 'dialogTitle' }, title),
        h('p', {}, text),
        h('div', { class: 'row end' }, h('button', { class: 'btn', value: 'cancel' }, cancel), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, value: 'ok', autofocus: true }, confirm)),
      ),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

let toastTimer;
export function toast(message, ms = 3200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// localStorage that never throws (private windows and blocked storage just forget).
export const store = {
  get(key, fallback = null) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// 1250 -> "1,250"; signed(+750) -> "+750"; signed(-400) -> "−400" (a real minus sign, not a hyphen).
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

// Run render() at most once per animation frame, however many times it is asked for.
export function frameThrottle(render) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
}

// Seconds left until a server-time deadline, rounded up, never below zero.
export const secondsLeft = (deadline, now) => Math.max(0, Math.ceil((deadline - now) / 1000));
