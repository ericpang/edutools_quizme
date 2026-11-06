// Colour themes. The palettes live in css/style.css as tokens on <html data-theme="...">; this picks one and remembers
// it on this device. Black is the default. Each page also has a tiny inline script in its <head> that applies a saved
// theme before the first paint, so there is no flash of the wrong colours.
import { h, store } from './ui.js';

export const DEFAULT_THEME = 'black';
// color is the browser toolbar colour (<meta name="theme-color">); swatch is [ground, text] for the picker's dot.
export const THEMES = [
  { id: 'black', name: 'Black', color: '#000000', swatch: ['#000000', '#f4f4f2'] },
  { id: 'spruce', name: 'Spruce', color: '#0d3b45', swatch: ['#0d3b45', '#eef5f2'] },
  { id: 'light', name: 'Light', color: '#f5f6f3', swatch: ['#f5f6f3', '#14211f'] },
];
const KEY = 'qm.theme';

export const isTheme = (id) => THEMES.some((t) => t.id === id);

export function savedTheme() {
  const saved = store.get(KEY);
  return isTheme(saved) ? saved : DEFAULT_THEME;
}

export const currentTheme = () => (isTheme(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : DEFAULT_THEME);

export function applyTheme(id, { save = true } = {}) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
  if (save) store.set(KEY, theme.id);
  return theme;
}

// Three round swatches, one per theme: a radio group, so the arrow keys and screen readers work as they should.
export function themePicker() {
  const now = currentTheme();
  return h(
    'div',
    { class: 'theme-pick', role: 'radiogroup', 'aria-label': 'Colour theme' },
    h('span', { class: 'theme-label' }, 'Theme'),
    THEMES.map((theme) =>
      h(
        'label',
        { class: 'swatch' },
        h('input', { type: 'radio', name: 'theme', value: theme.id, checked: theme.id === now, onchange: () => applyTheme(theme.id) }),
        h('span', { class: 'swatch-body' }, h('span', { class: 'swatch-dot', style: `--a: ${theme.swatch[0]}; --b: ${theme.swatch[1]}` }), theme.name),
      ),
    ),
  );
}

// Apply the saved theme and put the picker in `slot`.
export function mountTheme(slot) {
  applyTheme(savedTheme(), { save: false });
  slot?.replaceChildren(themePicker());
}
