import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_THEME, THEMES, isTheme } from '../js/theme.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('css/style.css');

// The custom properties declared in one rule, e.g. block(":root") or block("html[data-theme='light']").
function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `style.css has a rule for ${selector}`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return new Set([...body.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
}

// What a theme has to define to look right: the surfaces, the text, and the controls drawn on them.
const SURFACE = ['--ground', '--raise', '--sunk', '--track', '--line', '--text', '--muted', '--hover', '--invert', '--on-invert', '--on-invert-muted', '--placeholder', '--tick'];

test('black is the default theme, listed first', () => {
  assert.equal(DEFAULT_THEME, 'black');
  assert.equal(THEMES[0].id, 'black');
  assert.deepEqual(THEMES.map((t) => t.id), ['black', 'spruce', 'light']);
  assert.ok(THEMES.every((t) => isTheme(t.id)));
  assert.ok(!isTheme('neon') && !isTheme(undefined));
});

test('the default tokens in :root are black and define everything', () => {
  assert.match(css, /:root \{[^}]*--ground: #000;/);
  const base = block(':root');
  for (const token of [...SURFACE, '--ramp-0', '--ramp-1', '--ramp-2', '--gain', '--loss', '--focus', '--tone-easy', '--tone-medium', '--tone-hard', '--o0', '--o1', '--o2', '--o3']) assert.ok(base.has(token), `:root defines ${token}`);
});

test('every other theme restyles every surface token', () => {
  for (const theme of THEMES.filter((t) => t.id !== DEFAULT_THEME)) {
    const tokens = block(`html[data-theme='${theme.id}']`);
    for (const token of SURFACE) assert.ok(tokens.has(token), `${theme.id} defines ${token}`);
  }
});

test('the light theme deepens the ramp and the result colours so they read on a pale ground', () => {
  const light = block("html[data-theme='light']");
  for (const token of ['--ramp-0', '--ramp-1', '--ramp-2', '--gain', '--loss', '--tone-easy', '--tone-medium', '--tone-hard', '--focus']) assert.ok(light.has(token), `light defines ${token}`);
});

test('each theme has a toolbar colour and a two-colour swatch', () => {
  for (const theme of THEMES) {
    assert.match(theme.color, /^#[0-9a-f]{6}$/);
    assert.equal(theme.swatch.length, 2);
    assert.ok(theme.swatch.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  }
});

test('the head script on every page agrees with the theme list', () => {
  for (const page of ['index.html', 'admin.html', 'student.html']) {
    const html = read(page);
    assert.ok(html.includes(`<meta name="theme-color" content="${THEMES[0].color}">`), `${page} starts with black's toolbar colour`);
    const script = html.match(/<script>try\{var t=JSON\.parse[^<]*<\/script>/)?.[0];
    assert.ok(script, `${page} applies a saved theme before first paint`);
    for (const theme of THEMES.filter((t) => t.id !== DEFAULT_THEME)) {
      assert.ok(script.includes(`"${theme.id}"`), `${page} knows the ${theme.id} theme`);
      assert.ok(script.includes(theme.color), `${page} sets the ${theme.id} toolbar colour`);
    }
    assert.ok(html.includes('id="themeSlot"'), `${page} has a place for the picker`);
  }
});

test('no colour from the old palette is left hard-coded in the stylesheet', () => {
  assert.doesNotMatch(css, /var\(--(?:ice|amber|vermilion)\)/);
});
