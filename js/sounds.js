// Cute, bright sound effects, synthesised with the Web Audio API (no audio files). The host's page plays a short sting when a
// question appears, then a bouncy tune that loops while the answer clock runs. questionNotes() and musicAt() are those sounds
// as plain data, so they can be tested without a browser.
import { store } from './ui.js';

const C5 = 523.25; // Hz
const hz = (semitones) => C5 * 2 ** (semitones / 12);

// Each question is a step higher in key (C, D, E, then round again), so a long game does not repeat itself exactly.
export const KEY_SHIFTS = [0, 2, 4];
const keyOf = (n) => KEY_SHIFTS[(Math.max(1, Math.floor(n) || 1) - 1) % KEY_SHIFTS.length];

// Notes: { type, at, dur, gain } plus either freq, or from and to (a glide); `pop` makes a note start that much sharp
// and settle, which is what gives the arpeggio its bounce. at and dur are in seconds.
export function questionNotes(n = 1) {
  const key = keyOf(n);
  const f = (semitones) => hz(semitones + key);
  return [
    // a springy "boing" that glides up into the tune
    { type: 'sine', at: 0, dur: 0.18, from: f(-12), to: f(-2), gain: 0.55 },
    // the tune: a bouncy rising arpeggio (C, E, G, high C)
    { type: 'triangle', at: 0.11, dur: 0.13, freq: f(0), gain: 0.5, pop: 1.05 },
    { type: 'triangle', at: 0.2, dur: 0.13, freq: f(4), gain: 0.5, pop: 1.05 },
    { type: 'triangle', at: 0.29, dur: 0.13, freq: f(7), gain: 0.5, pop: 1.05 },
    { type: 'triangle', at: 0.38, dur: 0.3, freq: f(12), gain: 0.55, pop: 1.05 },
    // a sparkle on top
    { type: 'sine', at: 0.54, dur: 0.08, freq: f(16), gain: 0.26 },
    { type: 'sine', at: 0.6, dur: 0.08, freq: f(19), gain: 0.26 },
    { type: 'sine', at: 0.66, dur: 0.16, freq: f(24), gain: 0.26 },
    // a soft chord that rings under the last note
    { type: 'triangle', at: 0.38, dur: 0.55, freq: f(0), gain: 0.14 },
    { type: 'triangle', at: 0.38, dur: 0.55, freq: f(4), gain: 0.14 },
    { type: 'triangle', at: 0.38, dur: 0.55, freq: f(7), gain: 0.14 },
  ];
}

// ---------------------------------------------------------------- the tune that plays while the clock runs
// Eight bars of 16 steps (sixteenth notes), about 15 s before it comes round again, in the same key as the sting: a bouncy bass
// (root, fifth, root, fifth), chord stabs on the off-beats, a bell-like lead and a ticking clock. In the last seconds it speeds
// up and ticks twice as often. Pitches are semitones above C5; the lead plays a chord tone of the bar on every beat.
export const MUSIC = { bpm: 132, hurryBpm: 156, stepsPerBar: 16, bars: 8 };
export const MUSIC_STEPS = MUSIC.stepsPerBar * MUSIC.bars;
export const stepSeconds = (hurry = false) => 60 / (hurry ? MUSIC.hurryBpm : MUSIC.bpm) / 4;

const CHORDS = {
  C: { bass: -24, stab: [-12, -8, -5] }, // bass C3; stabs C4 E4 G4
  Am: { bass: -27, stab: [-12, -8, -3] }, // A2; C4 E4 A4
  Em: { bass: -32, stab: [-13, -8, -5] }, // E2; B3 E4 G4
  F: { bass: -31, stab: [-12, -7, -3] }, // F2; C4 F4 A4
  G: { bass: -29, stab: [-13, -10, -5] }, // G2; B3 D4 G4
};
export const PROGRESSION = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G'];

// The lead, one list per bar: [step, semitones, length in steps]. The first four bars hop up and down the chord; the last four
// are syncopated, and the last bar ends with a bright run (SPARKLE) that spills into the next time round.
const LEAD = [
  [[0, 4, 2], [2, 7, 2], [4, 12, 4], [8, 7, 2], [10, 4, 2], [12, 7, 4]],
  [[0, 4, 2], [2, 9, 2], [4, 12, 4], [8, 9, 2], [10, 4, 2], [12, 9, 4]],
  [[0, 5, 2], [2, 9, 2], [4, 12, 4], [8, 9, 2], [10, 7, 2], [12, 5, 4]],
  [[0, 2, 2], [2, 7, 2], [4, 11, 4], [8, 7, 2], [10, 2, 2], [12, 7, 2], [14, 11, 2]],
  [[0, 12, 3], [3, 7, 1], [4, 4, 2], [6, 7, 2], [8, 12, 3], [11, 7, 1], [12, 4, 2], [14, 7, 2]],
  [[0, 11, 3], [3, 7, 1], [4, 4, 2], [6, 7, 2], [8, 11, 3], [11, 7, 1], [12, 4, 2], [14, 7, 2]],
  [[0, 12, 3], [3, 9, 1], [4, 5, 2], [6, 9, 2], [8, 12, 3], [11, 9, 1], [12, 5, 2], [14, 9, 2]],
  [[0, 11, 3], [3, 7, 1], [4, 2, 2], [6, 7, 2], [8, 11, 2], [10, 14, 2], [12, 7, 1]],
];
const SPARKLE = [[13, 11], [14, 14], [15, 19]];

// The notes that start on one step of the tune (0 to MUSIC_STEPS - 1, then it wraps) for question n. A note is `len` steps long
// (or `dur` seconds, for the tick), so the same notes stretch when the tempo goes up; `ring` makes the sound die away that many
// times more slowly than the note is long, the way a plucked string or a bell keeps going after the next note has started.
export function musicAt(step, { n = 1, hurry = false } = {}) {
  const i = ((Math.floor(step) % MUSIC_STEPS) + MUSIC_STEPS) % MUSIC_STEPS;
  const bar = Math.floor(i / MUSIC.stepsPerBar);
  const beat = i % MUSIC.stepsPerBar;
  const chord = CHORDS[PROGRESSION[bar]];
  const f = (semitones) => hz(semitones + keyOf(n));
  const notes = [];
  if (beat % 4 === 0) {
    const root = beat % 8 === 0;
    notes.push({ voice: 'bass', type: 'triangle', freq: f(chord.bass + (root ? 0 : 7)), len: 3, ring: 2.2, gain: root ? 0.42 : 0.3 });
  }
  if (beat % 4 === 2) for (const s of chord.stab) notes.push({ voice: 'stab', type: 'triangle', freq: f(s), len: 1, ring: 3, gain: 0.06 });
  for (const [at, s, len] of LEAD[bar]) if (at === beat) notes.push({ voice: 'lead', type: 'triangle', freq: f(s), len, ring: 1.8, gain: 0.26, pop: 1.04 });
  if (bar === MUSIC.bars - 1) for (const [at, s] of SPARKLE) if (at === beat) notes.push({ voice: 'sparkle', type: 'sine', freq: f(s), len: 1, ring: 2, gain: 0.16 });
  // the clock: tick, tock, tick, tock (twice as often when time is nearly up)
  if (beat % (hurry ? 2 : 4) === 0) {
    const tick = beat % (hurry ? 4 : 8) === 0;
    notes.push({ voice: 'tick', type: 'triangle', freq: f(tick ? 21 : 14), dur: 0.045, gain: hurry ? 0.09 : 0.07, pop: 1.25 });
  }
  return notes;
}

// ---------------------------------------------------------------- playing it
// One note on the audio clock; start and dur are seconds of context time.
function voice(ctx, out, note, start, dur) {
  const end = start + dur;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = note.type;
  if (note.from) {
    osc.frequency.setValueAtTime(note.from, start);
    osc.frequency.exponentialRampToValueAtTime(note.to, end);
  } else if (note.pop) {
    osc.frequency.setValueAtTime(note.freq * note.pop, start);
    osc.frequency.exponentialRampToValueAtTime(note.freq, start + 0.045);
  } else {
    osc.frequency.setValueAtTime(note.freq, start);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(end + 0.03);
}

// Plays a list of questionNotes() and says when the last one has rung out.
function play(ctx, out, notes) {
  const t0 = ctx.currentTime + 0.03;
  let rungOut = t0;
  for (const note of notes) {
    voice(ctx, out, note, t0 + note.at, note.dur);
    rungOut = Math.max(rungOut, t0 + note.at + note.dur);
  }
  return rungOut;
}

const LOOKAHEAD = 0.75; // seconds of the tune handed to the audio clock ahead of time, so a busy page cannot make it stutter
const PUMP_MS = 100; // how often more of it is handed over
const MUSIC_GAIN = 0.7; // the tune sits a few decibels under the sting (measured by rendering both offline)

// The on/off choice is remembered on this device. Browsers only allow sound after a tap or click, so call unlock() from one;
// the host has always pressed something before the first question (after a refresh mid-question, the tune starts at the first
// click). `AudioContext` can be replaced, which is how the tests listen without a browser.
export function createSounds({ AudioContext: Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let ctx = null;
  let out = null;
  let enabled = store.get('qm.sound', true) !== false;
  let rungOut = 0; // context time when the last sting has finished, so the tune does not talk over it
  let song = null; // the tune while it plays: { bus, timer, step, next, n, hurry }
  let broken = false;

  // Sound is a nicety, and the host's timer calls it: if anything in it fails, say so once and stay quiet from then on, rather
  // than break the page it runs in.
  const safely = (fn) => (...args) => {
    if (broken) return undefined;
    try {
      return fn(...args);
    } catch (err) {
      broken = true;
      console.warn('QuizMe: sound is switched off for this page after an error:', err);
      if (song) clearInterval(song.timer);
      song = null;
      return undefined;
    }
  };

  function context() {
    if (!enabled || !Audio) return null;
    if (!ctx) {
      ctx = new Audio();
      out = ctx.createGain();
      out.gain.value = 0.45;
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Hand over every step that starts before the audio clock's horizon. If the page was too busy to keep up, skip what was
  // missed rather than play it all at once.
  function pump() {
    if (!song) return;
    const now = ctx.currentTime;
    if (song.next < now) song.next = now + 0.05;
    while (song.next < now + LOOKAHEAD) {
      const length = stepSeconds(song.hurry);
      for (const note of musicAt(song.step, song)) voice(ctx, song.bus, note, song.next, note.dur ?? note.len * length * (note.ring ?? 1));
      song.step = (song.step + 1) % MUSIC_STEPS;
      song.next += length;
    }
  }

  function start(n, hurry) {
    const c = context();
    if (!c) return;
    const bus = c.createGain();
    bus.gain.value = MUSIC_GAIN;
    bus.connect(out);
    song = { bus, step: 0, next: Math.max(c.currentTime + 0.1, rungOut - 0.05), n, hurry, timer: setInterval(safely(pump), PUMP_MS) };
    pump();
  }

  function stop() {
    if (!song) return;
    const { bus, timer } = song;
    song = null;
    clearInterval(timer);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.04); // a quick fade, so the tune does not cut off with a click
    setTimeout(() => bus.disconnect(), 400);
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      store.set('qm.sound', on);
      if (!on) safely(stop)();
    },
    unlock: safely(() => {
      context();
    }),
    // the sting for question n (1-based)
    question: safely((n) => {
      const c = context();
      if (c) rungOut = play(c, out, questionNotes(n));
    }),
    // The tune for question n. Say what should be happening, as often as you like: it only starts, quickens or stops when that
    // differs from what is playing. It waits for a sting that is still ringing.
    music: safely((on, { n = 1, hurry = false } = {}) => {
      if (!on || !enabled) return stop();
      if (song) {
        song.n = n;
        song.hurry = hurry;
      } else start(n, hurry);
      return undefined;
    }),
  };
}
