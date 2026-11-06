// End-to-end test: the real pages in headless Chrome (a host and phone-sized players) against the Firebase emulators,
// so the real security rules run too. Local only, like tests/rules: `npm run test:e2e`.
// Needs Java (for the emulators) and Chrome or Edge; set CHROME_PATH if it isn't found. Screenshots land in tests/e2e/shots/.
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = new URL('../../', import.meta.url);
const PORT = process.env.PORT ?? '5199';
process.env.PORT = PORT;
await import(new URL('tools/serve.mjs', root).href);

const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(existsSync);
if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH to a Chrome or Edge executable.');

const SHOTS = fileURLToPath(new URL('shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}`;
const DB = 'http://127.0.0.1:9000';
const NS = 'demo-quizme-default-rtdb';
const rest = async (path) => (await fetch(`${DB}/${path}.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
};
const errors = [];
const pages = []; // [label, page] for every page opened, so a failure can show what each one looked like
let roomCode = null;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, async (err) => {
    console.log(`\nSCRIPT ERROR: ${err?.message ?? err}`);
    console.log((err?.stack ?? '').split('\n').filter((line) => line.includes('run.mjs')).slice(0, 3).join('\n'));
    console.log(`page errors so far:\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}`);
    // What was on screen and in the database when it went wrong (screenshots: tests/e2e/shots/FAILED-*.png)
    for (const [label, page] of pages) await page.screenshot({ path: `${SHOTS}FAILED-${label}.png` }).catch(() => {});
    if (roomCode) console.log(`room at the time: ${JSON.stringify(await rest(`quizzes/${roomCode}`).catch(() => null))?.slice(0, 3500)}`);
    await browser.close().catch(() => {});
    process.exit(1);
  });
}

async function open(url, viewport, label) {
  const ctx = await browser.createBrowserContext(); // separate storage = separate anonymous user
  const page = await ctx.newPage();
  pages.push([label, page]);
  page.setDefaultTimeout(20000);
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    window.__sounds = 0; // oscillators created so far
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return;
    const create = Audio.prototype.createOscillator;
    Audio.prototype.createOscillator = function (...args) {
      window.__sounds++;
      return create.apply(this, args);
    };
  });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}
const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const big = { width: 1600, height: 900 };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const click = (page, sel) => page.$eval(sel, (e) => e.click());
const until = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 25000 }, ...args);
const hasText = (page, sel, needle) => until(page, (s, n) => document.querySelector(s)?.textContent.includes(n), sel, needle);
const setDial = (page, pct) =>
  page.$eval(
    '.dial-range',
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    pct,
  );
const letters = 'ABCD';
const fits = async (page, what) => {
  await page.setViewport({ width: 1366, height: 768 });
  const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await page.setViewport(big);
  check(`the ${what} screen fits a 1366x768 projector without scrolling`, over <= 1, `${over}px over`);
};
const sounds = (page) => page.evaluate(() => window.__sounds);
let mutedAt = 0;

// ---------------------------------------------------------------- the host sets up a game
async function hostSetup({ group = false, questions = 3 }) {
  const admin = await open(`${BASE}/admin.html?emulator`, big, group ? 'admin-group' : 'admin');
  await admin.waitForSelector('#builder');
  if (group) {
    await admin.$eval('input[name="mode"][value="group"]', (e) => e.click());
    await admin.select('#groupSize', '2');
  }
  await click(admin, '#sampleBtn');
  const have = await admin.$$eval('.qcard', (c) => c.length);
  for (let i = have; i > questions; i--) await admin.$$eval('[aria-label="Delete question"]', (els) => els.at(-1).click());
  await shot(admin, `${group ? 'g' : 's'}-host-1-builder`);
  await click(admin, '#createBtn');
  await until(admin, () => /^[A-HJKMNP-Z2-9]{6}$/.test(document.querySelector('#bigCode')?.textContent ?? ''));
  const code = await text(admin, '#bigCode');
  roomCode = code;
  return { admin, code };
}

async function join(code, name) {
  const page = await open(`${BASE}/student.html?room=${code}&emulator`, phone, name);
  await page.waitForSelector('#joinForm');
  await page.type('#name', name);
  await click(page, '#joinBtn');
  await hasText(page, '#view h1', 'in,');
  return page;
}

const playersByName = async (code) => Object.fromEntries(Object.entries((await rest(`quizzes/${code}/players`)) ?? {}).map(([uid, p]) => [p.name, uid]));

// ================================================================ solo
console.log('\n--- solo game');
{
  const { admin, code } = await hostSetup({ questions: 3 });
  check('host gets a 6-character code', true, code);
  await admin.waitForSelector('#qr canvas, #qr img');
  check('QR code is drawn', true);
  check('black is the default theme', (await admin.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join())) === 'black,rgb(0, 0, 0)');
  const meta = await rest(`quizzes/${code}/meta`);
  check('game exists with the host as owner', !!meta?.owner && meta.mode === 'solo' && meta.open === true && meta.maxWager === 100);
  const stored = await rest(`quizzes/${code}/quiz`);
  check('3 questions stored with their keys', Object.keys(stored).length === 3 && stored.q1.correct === 2);

  const ana = await join(code, 'Ana');
  const ben = await join(code, 'Ben');
  const cleo = await join(code, 'Cleo');
  await shot(ana, 's-phone-1-lobby');
  await until(admin, () => document.querySelectorAll('#roster .person').length === 3);
  check('host sees 3 players', true);
  await shot(admin, 's-host-2-lobby');
  const uid = await playersByName(code);

  // ---- question 1 (Cell biology, hard, answer C)
  await click(admin, '#startBtn');
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.dial-range');
  await hasText(admin, '.p-cat', 'Cell biology');
  check('projector shows the category, not the question', !(await admin.$('.p-question')));
  check('phones do not have the question text yet', !(await ana.$('.q-text')));
  await setDial(ana, 50);
  await shot(ana, 's-phone-2-bid');
  await shot(admin, 's-host-3-bid');
  await fits(admin, 'wager');
  await click(ana, '#lockBtn');
  await setDial(ben, 20);
  await click(ben, '#lockBtn');
  await setDial(cleo, 0);
  await click(cleo, '#lockBtn');
  const bids = await rest(`quizzes/${code}/bid/q1`);
  check('wagers stored per player', bids[uid.Ana].pct === 50 && bids[uid.Ben].pct === 20 && bids[uid.Cleo].pct === 0);
  await hasText(ana, '.status', 'Wager locked');

  // everyone locked in: the question appears
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.option');
  check('the question appears once everyone has bid', (await text(ana, '.q-text')).includes('ATP'));
  await shot(admin, 's-host-4-answer');
  await fits(admin, 'question');
  check('the question fanfare plays on the host when the question appears', (await sounds(admin)) > 0, `${await sounds(admin)} notes`);
  check('phones stay quiet', (await sounds(ana)) === 0);
  const stung = await sounds(admin);
  await admin.waitForFunction((n) => window.__sounds > n + 12, { timeout: 8000 }, stung); // only the music can add this many notes
  check('the music keeps playing on the host while the clock runs on the question', true);
  const pick = async (page, i) => {
    await page.$$eval('.options .option', (els, k) => els[k].click(), i);
    await click(page, '#lockBtn');
  };
  await pick(ana, 2); // C: right
  await pick(ben, 0); // A: wrong
  await pick(cleo, 2); // C: right
  await ana.waitForSelector('[data-bet]');
  await until(ana, () => document.querySelector('.bars .bar-row'));
  check('live class stats appear after answering', (await ana.$$eval('.bar-row', (r) => r.length)) === 4);
  await shot(ana, 's-phone-3-answered');
  await ana.$eval('[data-bet="right"]', (e) => e.click());
  await ben.$eval('[data-bet="wrong"]', (e) => e.click());
  await cleo.$eval('[data-bet="none"]', (e) => e.click());

  // everyone answered and settled their side-bet: the host reveals
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.verdict');
  check('reveal shows the verdict on each phone', (await text(ana, '.verdict')) === 'Right' && (await text(ben, '.verdict')) === 'Wrong' && (await text(cleo, '.verdict')) === 'Right');
  await sleep(1500); // let the balance count up
  await shot(ana, 's-phone-4-reveal-right');
  await shot(ben, 's-phone-4-reveal-wrong');
  await shot(admin, 's-host-5-reveal');
  await fits(admin, 'reveal');
  const revealed = await sounds(admin);
  await sleep(1200);
  check('the music stops when the answer is revealed', (await sounds(admin)) === revealed, `${revealed} then ${await sounds(admin)}`);
  const score = await rest(`quizzes/${code}/score`);
  check('scores follow the rules (right +600 x2 +50 bet, wrong -200 -50, right +100 x2)', score[uid.Ana].pts === 2250 && score[uid.Ben].pts === 750 && score[uid.Cleo].pts === 1200, `${score[uid.Ana].pts} / ${score[uid.Ben].pts} / ${score[uid.Cleo].pts}`);
  check('balance on the phone matches', (await text(ana, '#balance')).replace(/\D/g, '') === '2250');

  // ---- standings
  await click(admin, '#nextBtn');
  await admin.waitForSelector('.board-row');
  check('projector lists the top players', (await admin.$$eval('.board-name', (n) => n.map((e) => e.textContent))).join() === 'Ana,Cleo,Ben');
  await shot(admin, 's-host-6-standings');
  await fits(admin, 'standings');
  await click(admin, '#soundBtn'); // sound off for question 2
  mutedAt = await sounds(admin);
  check('the sound switch reads "Sound off"', (await text(admin, '#soundBtn')).includes('off') && (await admin.$eval('#soundBtn', (e) => e.getAttribute('aria-pressed'))) === 'false');
  await ben.waitForSelector('.panel.perk:not([hidden])');
  await ana.waitForSelector('.rank-line');
  check('the player in last place unlocks a Safety Net token', true);
  check('players in front do not', !(await ana.$('.panel.perk:not([hidden])')));
  await shot(ben, 's-phone-5-standings-token');

  // ---- question 2 (World geography, easy, answer C): Ben spends a Shield on a full wager and loses
  await click(admin, '#nextBtn');
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.dial-range');
  await ben.waitForSelector('.token:not([hidden])');
  check('only the token holder is offered a token', !(await ana.$('.token:not([hidden])')));
  await ben.$eval('input[name="token"][value="sh"]', (e) => e.click());
  await setDial(ben, 100);
  await shot(ben, 's-phone-6-bid-shield');
  await click(ben, '#lockBtn');
  for (const p of [ana, cleo]) {
    await setDial(p, 10);
    await click(p, '#lockBtn');
  }
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.option');
  await pick(ana, 2);
  await pick(ben, 1);
  await pick(cleo, 2);
  for (const p of [ana, ben, cleo]) {
    await p.waitForSelector('[data-bet]');
    await p.$eval('[data-bet="none"]', (e) => e.click());
  }
  await ben.waitForSelector('.verdict');
  check('with the sound off, the next question is silent', (await sounds(admin)) === mutedAt, `${await sounds(admin)} vs ${mutedAt}`);
  await click(admin, '#soundBtn');
  check('turning the sound back on plays a preview', (await sounds(admin)) > mutedAt);
  const score2 = await rest(`quizzes/${code}/score`);
  check('a Shield makes a wrong full wager free', score2[uid.Ben].pts === 750, score2[uid.Ben].pts);
  check('the token is marked as spent', (await rest(`quizzes/${code}/perk/${uid.Ben}`)).used === true);
  await sleep(1200);
  await shot(ben, 's-phone-7-reveal-shield');

  // ---- question 3, then the end
  await click(admin, '#nextBtn'); // standings
  await admin.waitForSelector('.board-row');
  await click(admin, '#nextBtn'); // question 3
  await hasText(admin, '.p-cat', 'Chemistry');
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.dial-range');
  await click(admin, '#nextBtn'); // skip the bids: the host can move on at any time
  await admin.waitForSelector('.p-question');
  for (const p of [ana, ben, cleo]) await p.waitForSelector('.option');
  // the switch works in the middle of a question: off silences the music, on brings it back
  await click(admin, '#soundBtn');
  const hushed = await sounds(admin);
  await sleep(800);
  check('switching the sound off in the middle of a question silences the music', (await sounds(admin)) === hushed, `${hushed} then ${await sounds(admin)}`);
  await click(admin, '#soundBtn');
  await admin.waitForFunction((n) => window.__sounds > n + 25, { timeout: 8000 }, hushed); // the preview is 11 notes; the rest is the music
  check('...and switching it back on brings the music back', true);
  await pick(ana, 0);
  await click(admin, '#nextBtn'); // reveal
  await admin.waitForSelector('.p-verdict');
  await cleo.waitForSelector('.verdict');
  check('someone who did not answer sees "No answer"', (await text(cleo, '.verdict')) === 'No answer');
  await click(admin, '#nextBtn'); // standings (last question)
  await hasText(admin, '.p-title', 'Almost there');
  await click(admin, '#nextBtn'); // final
  await admin.waitForSelector('.podium');
  check('podium shows the top three', (await admin.$$eval('.podium-col', (c) => c.length)) === 3);
  await shot(admin, 's-host-7-final');
  await fits(admin, 'podium');
  await ana.waitForSelector('.cal-list');
  check('players get a calibration report', (await ana.$$eval('.cal-row', (r) => r.length)) >= 1);
  await shot(ana, 's-phone-8-final');
  check('final rank is on the phone', (await text(ana, '.rank-line')).includes('#1'));

  // ---- refreshing keeps everything
  await ben.reload({ waitUntil: 'domcontentloaded' });
  await ben.waitForSelector('.rank-line');
  check('a refreshed phone resumes the game', (await text(ben, '.rank-line')).includes('#3'));
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.podium');
  check('a refreshed host page resumes the game', true);

  // ---- themes
  await admin.$eval('input[name="theme"][value="light"]', (e) => e.click());
  check('the host can switch to the light theme', (await admin.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(245, 246, 243)');
  await shot(admin, 's-host-8-final-light');
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.podium');
  check('the theme is remembered after a refresh', (await admin.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await admin.$eval('input[name="theme"][value="spruce"]', (e) => e.click());
  await shot(admin, 's-host-9-final-spruce');
  await admin.$eval('input[name="theme"][value="black"]', (e) => e.click());
  await ana.$eval('input[name="theme"][value="light"]', (e) => e.click());
  await shot(ana, 's-phone-9-final-light');
  await ana.$eval('input[name="theme"][value="black"]', (e) => e.click());

  // ---- ending the game deletes it
  await click(admin, '#endBtn');
  await admin.waitForSelector('dialog[open]');
  await admin.$eval('dialog[open] button[value="ok"]', (e) => e.click());
  await sleep(1500);
  check('ending the game deletes its data', (await rest(`quizzes/${code}`)) === null);
  await ben.waitForFunction(() => document.querySelector('#view h1')?.textContent.includes('ended'));
  check('phones are told the game ended', true);
}

// ================================================================ group mode
console.log('\n--- group game');
{
  const { admin, code } = await hostSetup({ group: true, questions: 2 });
  const meta = await rest(`quizzes/${code}/meta`);
  check('group game created with groups of 2', meta.mode === 'group' && meta.groupSize === 2);
  const names = ['Dee', 'Eli', 'Fay', 'Gus'];
  const phones = {};
  for (const n of names) phones[n] = await join(code, n);
  await until(admin, () => document.querySelectorAll('#roster .person').length === 4);
  await admin.waitForSelector('#shuffleBtn:not([disabled])');
  await click(admin, '#shuffleBtn');
  await until(admin, () => document.querySelectorAll('.group-card').length === 2);
  check('shuffle makes two groups', true);
  await shot(admin, 'g-host-2-lobby');
  const uid = await playersByName(code);
  const groups = await rest(`quizzes/${code}/group`);
  const teamOf = (g) => names.filter((n) => groups[uid[n]] === g);
  const [g1, g2] = [teamOf('g1'), teamOf('g2')];
  check('two balanced teams of two', g1.length === 2 && g2.length === 2, `${g1} | ${g2}`);
  await hasText(phones[g1[0]], '#view', g1[1]);
  await shot(phones[g1[0]], 'g-phone-1-lobby');

  await click(admin, '#startBtn');
  for (const n of names) await phones[n].waitForSelector('.dial-range');
  check('phones show the team panel while bidding', (await phones[g1[0]].$$eval('.team-row', (r) => r.length)) === 2);

  // g1 wagers 60 and 20 (the group takes the lower middle, 20); g2 wagers 10 and 10
  await setDial(phones[g1[0]], 60);
  await setDial(phones[g1[1]], 20);
  await until(phones[g1[0]], (name) => document.querySelector('.team-list')?.textContent.includes('20%'), g1[1]);
  check('teammates see each other\'s votes live', true);
  await shot(phones[g1[0]], 'g-phone-2-bid');
  for (const n of g1) await click(phones[n], '#readyBtn');
  for (const n of g2) {
    await setDial(phones[n], 10);
    await click(phones[n], '#readyBtn');
  }
  for (const n of names) await phones[n].waitForSelector('.option');
  const bids = await rest(`quizzes/${code}/bid/q1`);
  check('the group wager is the lower median of the votes', bids.g1.pct === 20 && bids.g2.pct === 10, `${bids.g1?.pct}/${bids.g2?.pct}`);

  // answers: g1 both pick C (right); g2 splits and the captain breaks the tie
  const choose = async (n, i) => {
    await phones[n].$$eval('.options .option', (els, k) => els[k].click(), i);
    await click(phones[n], '#readyBtn');
  };
  await choose(g1[0], 2);
  await choose(g1[1], 2);
  await shot(phones[g1[0]], 'g-phone-3-answer');
  const captain = g2[0]; // question 1: the first member to join
  await choose(g2[0], 0);
  await phones[g2[1]].$$eval('.options .option', (els) => els[1].click()); // the other member votes differently
  await click(phones[g2[1]], '#readyBtn');
  for (const n of names) await phones[n].waitForSelector('[data-bet]');
  const ans = await rest(`quizzes/${code}/ans/q1`);
  check('team g1 answered C; the g2 tie went to the captain or the lowest option', ans.g1.v === 2 && [0, 1].includes(ans.g2.v), `${ans.g1?.v}/${ans.g2?.v} captain ${captain}`);
  await shot(phones[g1[0]], 'g-phone-4-side');

  // side-bets: each team votes, then Ready
  for (const n of g1) {
    await phones[n].$eval('[data-bet="right"]', (e) => e.click());
    await click(phones[n], '#sideReadyBtn');
  }
  for (const n of g2) await click(phones[n], '#sideReadyBtn'); // Ready with no bet
  await phones[g1[0]].waitForSelector('.verdict');
  const score = await rest(`quizzes/${code}/score`);
  check('scores are per group', Object.keys(score).sort().join() === 'g1,g2' && score.g1.pts > 1000 && score.g2.pts < 1000, `${score.g1?.pts}/${score.g2?.pts}`);
  check('both members see the group result', (await text(phones[g1[1]], '.verdict')) === 'Right');
  await sleep(1300);
  await shot(phones[g1[0]], 'g-phone-5-reveal');
  await shot(admin, 'g-host-3-reveal');

  // standings, question 2, final
  await click(admin, '#nextBtn');
  await admin.waitForSelector('.board-row');
  check('standings rank groups', (await admin.$$eval('.board-name', (n) => n.length)) === 2);
  await shot(admin, 'g-host-4-standings');

  // a latecomer joins in the middle of the game and is placed in the smallest group
  const hal = await open(`${BASE}/student.html?room=${code}&emulator`, phone, 'Hal');
  await hal.waitForSelector('#joinForm');
  await hal.type('#name', 'Hal');
  await click(hal, '#joinBtn');
  await hal.waitForSelector('.group-badge');
  const halUid = (await playersByName(code)).Hal;
  const halGroup = await rest(`quizzes/${code}/group/${halUid}`);
  check('a latecomer is placed in a group mid-game', /^g[12]$/.test(halGroup ?? ''), halGroup);
  await shot(hal, 'g-phone-7-latecomer');

  await click(admin, '#nextBtn');
  for (const n of names) await phones[n].waitForSelector('.dial-range');
  await click(admin, '#nextBtn'); // to the answers
  await admin.waitForSelector('.p-question');
  await click(admin, '#nextBtn'); // reveal
  await admin.waitForSelector('.p-verdict');
  await click(admin, '#nextBtn'); // standings
  await hasText(admin, '.p-title', 'Almost there');
  await click(admin, '#nextBtn'); // final
  await admin.waitForSelector('.podium');
  await phones[g1[0]].waitForSelector('.cal-list');
  check('group players get a report too', true);
  await shot(phones[g1[0]], 'g-phone-6-final');

  await click(admin, '#endBtn');
  await admin.waitForSelector('dialog[open]');
  await admin.$eval('dialog[open] button[value="ok"]', (e) => e.click());
  await sleep(800);
}

// ================================================================ the front page
console.log('\n--- front page');
{
  const home = await open(`${BASE}/index.html`, phone, 'home');
  await home.waitForSelector('.dial-range');
  await shot(home, 'home-phone');
  await home.type('#code', 'zzz');
  await click(home, '#joinForm button[type="submit"]');
  check('a short code is rejected with a message', (await text(home, '#codeError')).includes('6 letters'));
  await home.$eval('.dial-range', (el) => {
    el.value = 100;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Chrome reports a mixed colour as color(srgb 1 0.36 0.36) and a plain one as rgb(255, 93, 93): read both as [r, g, b]
  const rgb = (css) => (css.startsWith('color(') ? css.match(/[\d.]+/g).slice(-3).map((v) => Math.round(Number(v) * 255)) : css.match(/\d+/g).slice(0, 3).map(Number)).join();
  const risk = async () => rgb(await home.$eval('.dial-pct', (e) => getComputedStyle(e).color));
  check('a full wager turns the dial red on the black theme', (await risk()) === '255,93,93', await risk());
  await home.$eval('input[name="theme"][value="light"]', (e) => e.click());
  check('...and a deeper red on the light theme', (await risk()) === '198,40,40', await risk());
  await shot(home, 'home-phone-light');
  const wide = await open(`${BASE}/index.html`, big, 'home-wide');
  await wide.waitForSelector('.dial-range');
  await shot(wide, 'home-wide');
}

check('no errors in any page', errors.length === 0, errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : '');
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
