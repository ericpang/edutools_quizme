import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { KEY_SHIFTS, MUSIC, MUSIC_STEPS, PROGRESSION, createSounds, musicAt, questionNotes, stepSeconds } from '../js/sounds.js';

const freqs = (note) => [note.freq, note.from, note.to].filter((f) => f !== undefined);

test('the question fanfare is short, quiet enough, and audible', () => {
  for (let n = 1; n <= 9; n++) {
    const notes = questionNotes(n);
    const length = Math.max(...notes.map((note) => note.at + note.dur));
    assert.ok(length > 0.5 && length < 1.2, `question ${n} lasts ${length.toFixed(2)}s`);
    for (const note of notes) {
      assert.ok(['sine', 'triangle'].includes(note.type), 'soft waveforms only');
      assert.ok(note.at >= 0 && note.dur > 0.05, 'starts on time and lasts long enough to hear');
      assert.ok(note.gain > 0 && note.gain <= 0.6, `gain ${note.gain}`);
      for (const f of freqs(note)) assert.ok(f > 120 && f < 4200, `${f} Hz is in a pleasant range`);
    }
  }
});

test('it opens with a glide and then rises: boing, then C, E, G, high C', () => {
  const notes = questionNotes(1);
  assert.ok(notes[0].from < notes[0].to, 'the boing glides up');
  const tune = notes.filter((note) => note.pop).map((note) => note.freq);
  assert.equal(tune.length, 4);
  assert.deepEqual([...tune].sort((a, b) => a - b), tune, 'the arpeggio rises');
  assert.ok(Math.abs(tune[0] - 523.25) < 0.01, 'it starts on C5');
  assert.ok(Math.abs(tune[3] / tune[0] - 2) < 0.001, 'and ends an octave higher');
});

test('every note starts in order and the sparkle comes after the tune', () => {
  const notes = questionNotes(1);
  const tune = notes.filter((note) => note.pop);
  const sparkle = notes.filter((note) => note.type === 'sine' && note.at > 0.5);
  assert.equal(sparkle.length, 3);
  assert.ok(Math.min(...sparkle.map((note) => note.at)) > Math.max(...tune.map((note) => note.at)));
});

test('each question is in a different key, and the keys repeat every few questions', () => {
  assert.deepEqual(KEY_SHIFTS, [0, 2, 4]);
  const first = (n) => questionNotes(n).find((note) => note.pop).freq;
  assert.notEqual(first(1), first(2));
  assert.notEqual(first(2), first(3));
  assert.equal(first(1), first(4));
  assert.ok(Math.abs(first(2) / first(1) - 2 ** (2 / 12)) < 1e-9, 'a whole tone higher');
  assert.deepEqual(questionNotes(0), questionNotes(1), 'a bad question number falls back to the first key');
  assert.deepEqual(questionNotes(NaN), questionNotes(1));
});

// ---------------------------------------------------------------- the tune that plays while the clock runs
const C5 = 523.25;
const pitchClass = (freq, key = 0) => (((Math.round(12 * Math.log2(freq / C5)) - key) % 12) + 12) % 12; // 0 = C, in the key of the question
const CHORD_TONES = { C: [0, 4, 7], Am: [9, 0, 4], Em: [4, 7, 11], F: [5, 9, 0], G: [7, 11, 2] };
const ROOT = { C: 0, Am: 9, Em: 4, F: 5, G: 7 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const bars = (options) =>
  PROGRESSION.map((chord, bar) =>
    Array.from({ length: MUSIC.stepsPerBar }, (_, beat) => musicAt(bar * MUSIC.stepsPerBar + beat, options).map((note) => ({ ...note, beat }))),
  );
const voiceOf = (steps, name) => steps.flat().filter((note) => note.voice === name);

test('the tune is eight bars of about fifteen seconds, and comes round again', () => {
  assert.equal(MUSIC_STEPS, 128);
  assert.equal(PROGRESSION.length, MUSIC.bars);
  const seconds = MUSIC_STEPS * stepSeconds();
  assert.ok(seconds > 13 && seconds < 17, `${seconds.toFixed(1)}s`);
  assert.deepEqual(musicAt(MUSIC_STEPS), musicAt(0));
  assert.deepEqual(musicAt(-1), musicAt(MUSIC_STEPS - 1));
  assert.deepEqual(musicAt(5, { n: 4 }), musicAt(5, { n: 1 }), 'the fourth question is back in the first key');
});

test('every note is soft, audible and in a pleasant range, at every tempo and in every key', () => {
  for (const n of [1, 2, 3, 4]) {
    for (const hurry of [false, true]) {
      for (const bar of bars({ n, hurry })) {
        const notes = bar.flat();
        for (const note of notes) {
          assert.ok(['sine', 'triangle'].includes(note.type), 'soft waveforms only');
          assert.ok(note.gain > 0 && note.gain <= 0.5, `${note.voice} gain ${note.gain}`);
          assert.ok((note.len > 0) !== (note.dur > 0), 'a length in steps or a time in seconds, not both');
          assert.ok(note.ring === undefined || (note.len > 0 && note.ring >= 1 && note.ring <= 3.5), 'a note rings on for a few times its length at most');
          assert.ok(note.freq >= 75 && note.freq <= 2300, `${note.voice} ${note.freq.toFixed(0)} Hz`);
          assert.ok(!note.pop || (note.pop > 1 && note.pop <= 1.3), 'a small bounce');
        }
        for (const step of bar) assert.ok(step.reduce((sum, note) => sum + note.gain, 0) <= 1, 'room to spare before it clips');
      }
    }
  }
});

test('the bass bounces on every beat: root, fifth, root, fifth, following the chords', () => {
  bars().forEach((bar, i) => {
    const bass = voiceOf(bar, 'bass');
    assert.deepEqual(bass.map((note) => note.beat), [0, 4, 8, 12], `bar ${i + 1}`);
    const chord = PROGRESSION[i];
    bass.forEach((note, k) => {
      const root = ROOT[chord];
      assert.equal(pitchClass(note.freq), k % 2 === 0 ? root : (root + 7) % 12, `bar ${i + 1} ${chord}, beat ${note.beat}`);
    });
    assert.ok(bass[0].gain > bass[1].gain, 'the downbeat is the strongest');
  });
});

test('the stabs play the chord on the off-beats', () => {
  bars().forEach((bar, i) => {
    const stabs = voiceOf(bar, 'stab');
    assert.equal(stabs.length, 12, `bar ${i + 1}`);
    for (const beat of [2, 6, 10, 14]) {
      const chord = stabs.filter((note) => note.beat === beat).map((note) => pitchClass(note.freq));
      assert.deepEqual([...chord].sort((a, b) => a - b), [...CHORD_TONES[PROGRESSION[i]]].sort((a, b) => a - b), `bar ${i + 1}, step ${beat}`);
    }
  });
});

test('the lead sings a chord tone on every beat, stays in the scale, and never overlaps itself', () => {
  for (const n of [1, 2, 3]) {
    bars({ n }).forEach((bar, i) => {
      const chord = PROGRESSION[i];
      const lead = voiceOf(bar, 'lead');
      assert.ok(lead.length >= 6, `bar ${i + 1} has a tune`);
      for (const note of lead) {
        const pc = pitchClass(note.freq, KEY_SHIFTS[n - 1]);
        if (note.beat % 4 === 0) assert.ok(CHORD_TONES[chord].includes(pc), `bar ${i + 1} ${chord}, step ${note.beat}: pitch class ${pc}`);
        else assert.ok(MAJOR.includes(pc), `bar ${i + 1}, step ${note.beat}: pitch class ${pc} is out of the scale`);
      }
      lead.forEach((note, k) => {
        const end = note.beat + note.len;
        assert.ok(end <= MUSIC.stepsPerBar, 'a note never runs into the next bar');
        if (lead[k + 1]) assert.ok(end <= lead[k + 1].beat, `bar ${i + 1}: the note at step ${note.beat} runs into the next`);
      });
    });
  }
});

test('the last bar ends with a bright run that rises into the next time round', () => {
  const all = bars();
  all.slice(0, -1).forEach((bar) => assert.equal(voiceOf(bar, 'sparkle').length, 0));
  const run = voiceOf(all.at(-1), 'sparkle');
  assert.deepEqual(run.map((note) => note.beat), [13, 14, 15]);
  assert.deepEqual([...run.map((note) => note.freq)].sort((a, b) => a - b), run.map((note) => note.freq), 'it rises');
  for (const note of run) assert.ok(CHORD_TONES.G.includes(pitchClass(note.freq)), 'and belongs to the last chord');
});

test('the tune is in the same key as the sting of the same question', () => {
  for (const n of [1, 2, 3, 4]) {
    const sting = questionNotes(n).find((note) => note.pop).freq; // the sting starts on its tonic
    const bass = musicAt(0, { n }).find((note) => note.voice === 'bass').freq; // the tune starts on its tonic, two octaves down
    assert.ok(Math.abs(bass * 4 - sting) < 1e-9, `question ${n}`);
  }
});

test('a clock ticks every beat, tick then tock, and twice as often when time is nearly up', () => {
  const ticks = (options) => Array.from({ length: MUSIC_STEPS }, (_, step) => musicAt(step, options).filter((note) => note.voice === 'tick').map((note) => ({ ...note, step }))).flat();
  const calm = ticks({ hurry: false });
  const rushed = ticks({ hurry: true });
  assert.equal(calm.length, MUSIC_STEPS / 4);
  assert.equal(rushed.length, MUSIC_STEPS / 2);
  assert.ok(calm.every((note, i) => note.step === i * 4));
  assert.ok(calm.every((note, i) => (i % 2 === 0) === (note.freq > calm[1].freq)), 'high, low, high, low');
  assert.ok(rushed[0].gain > calm[0].gain, 'a little louder');
  assert.ok(stepSeconds(true) < stepSeconds(false));
  assert.ok(Math.abs(stepSeconds(true) / stepSeconds(false) - MUSIC.bpm / MUSIC.hurryBpm) < 1e-9);
});

// ---------------------------------------------------------------- playing it (against a stand-in for the browser's audio)
function fakeAudio({ suspended = false } = {}) {
  const made = [];
  class Param {
    value = 0;
    setValueAtTime(value) {
      this.value = value;
    }
    exponentialRampToValueAtTime() {}
    setTargetAtTime(target) {
      this.target = target;
    }
  }
  class Node {
    connect(next) {
      return next;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  class FakeContext {
    static locked = suspended; // the browser refuses to start sound until someone taps
    static fails = false; // the audio device breaks
    currentTime = 0;
    state = FakeContext.locked ? 'suspended' : 'running';
    destination = new Node();
    oscillators = [];
    gains = [];
    constructor() {
      made.push(this);
    }
    resume() {
      if (!FakeContext.locked) this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      const node = new Node();
      node.gain = new Param();
      this.gains.push(node);
      return node;
    }
    createOscillator() {
      if (FakeContext.fails) throw new Error('no audio device');
      const node = new Node();
      node.frequency = new Param();
      node.start = (time) => {
        node.startedAt = time;
      };
      node.stop = (time) => {
        node.stoppedAt = time;
      };
      this.oscillators.push(node);
      return node;
    }
  }
  return { FakeContext, made };
}

// Sounds on a fake audio device and a fake clock: advance(seconds) moves the audio clock and the page's timers together.
function listen(t, options) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(() => mock.timers.reset());
  const { FakeContext, made } = fakeAudio(options);
  const sounds = createSounds({ AudioContext: FakeContext });
  const ctx = () => made[0];
  const advance = (seconds) => {
    for (let spent = 0; spent < seconds - 1e-9; spent += 0.1) {
      ctx().currentTime += 0.1;
      mock.timers.tick(100);
    }
  };
  return { sounds, ctx, made, advance, FakeContext };
}
const isTick = (osc) => Math.abs(osc.stoppedAt - osc.startedAt - 0.075) < 1e-9; // a tick lasts 45 ms (plus the 30 ms the oscillator is left on)

test('the tune starts at once, keeps handing over the next stretch as the clock moves, and ignores being asked again', (t) => {
  const { sounds, ctx, advance } = listen(t);
  sounds.music(true, { n: 1 });
  const first = ctx().oscillators.length;
  assert.ok(first > 0, 'the first stretch is ready at once');
  assert.ok(ctx().oscillators.every((osc) => osc.startedAt >= 0.1 && osc.startedAt < 0.8), 'only a short way ahead');
  const gains = ctx().gains.length;
  sounds.music(true, { n: 1 });
  assert.equal(ctx().oscillators.length, first, 'asking again changes nothing');
  assert.equal(ctx().gains.length, gains, 'and does not start a second tune');
  advance(3);
  assert.ok(ctx().oscillators.length > first + 30, `${ctx().oscillators.length} notes after three seconds`);
  assert.ok(Math.max(...ctx().oscillators.map((osc) => osc.startedAt)) >= 3);
});

test('it fades out and goes quiet when the question is over', (t) => {
  const { sounds, ctx, advance } = listen(t);
  sounds.music(true);
  advance(1);
  const bus = ctx().gains[1];
  sounds.music(false);
  const heard = ctx().oscillators.length;
  assert.equal(bus.gain.target, 0, 'it fades rather than cuts off');
  advance(5);
  assert.equal(ctx().oscillators.length, heard, 'nothing more is played');
  assert.equal(bus.disconnected, true, 'and it lets go of the speakers');
  sounds.music(true);
  assert.ok(ctx().oscillators.length > heard, 'the next question starts a fresh tune');
});

test('it waits for the sting to ring out', (t) => {
  const { sounds, ctx, advance } = listen(t);
  sounds.question(1);
  const sting = ctx().oscillators.length;
  const rungOut = Math.max(...ctx().oscillators.map((osc) => osc.stoppedAt)) - 0.03;
  sounds.music(true, { n: 1 });
  advance(2);
  const tune = ctx().oscillators.slice(sting);
  assert.ok(tune.length > 0);
  assert.ok(Math.min(...tune.map((osc) => osc.startedAt)) >= rungOut - 0.05 - 1e-9, 'it does not talk over the sting');
});

test('when time is nearly up the tune speeds up and the clock ticks faster', (t) => {
  const { sounds, ctx, advance } = listen(t);
  const gaps = (times) => times.slice(1).map((time, i) => time - times[i]);
  sounds.music(true, { n: 1 });
  advance(3);
  const calm = ctx().oscillators.filter(isTick).map((osc) => osc.startedAt);
  assert.ok(calm.length >= 5);
  for (const gap of gaps(calm)) assert.ok(Math.abs(gap - 4 * stepSeconds()) < 1e-6, 'a tick on every beat');
  sounds.music(true, { n: 1, hurry: true });
  advance(3);
  const late = ctx().oscillators.filter(isTick).map((osc) => osc.startedAt).slice(-6);
  for (const gap of gaps(late)) assert.ok(Math.abs(gap - 2 * stepSeconds(true)) < 1e-6, 'a tick on every half beat, faster');
});

test('it plays nothing while the sound is off, and stops at once when it is switched off', (t) => {
  const { sounds, ctx, made, advance } = listen(t);
  sounds.setEnabled(false);
  sounds.music(true);
  sounds.question(1);
  assert.equal(made.length, 0, 'not even an audio context is made');
  sounds.setEnabled(true);
  sounds.music(true);
  advance(1);
  const heard = ctx().oscillators.length;
  assert.ok(heard > 0);
  sounds.setEnabled(false);
  advance(3);
  assert.equal(ctx().oscillators.length, heard, 'switching off silences it at once');
  sounds.music(true);
  advance(1);
  assert.equal(ctx().oscillators.length, heard, 'and it stays silent');
  sounds.setEnabled(true);
  sounds.music(true);
  assert.ok(ctx().oscillators.length > heard, 'switching on in the middle of a question brings it back');
});

test('a page that was too busy to keep up skips ahead instead of playing a burst', (t) => {
  const { sounds, ctx } = listen(t);
  sounds.music(true);
  const before = ctx().oscillators.length;
  ctx().currentTime = 100; // frozen for a minute and a half
  mock.timers.tick(100);
  const burst = ctx().oscillators.slice(before);
  assert.ok(burst.length > 0 && burst.length < 40, `${burst.length} notes`);
  assert.ok(burst.every((osc) => osc.startedAt >= 100), 'nothing is played late');
});

test('a broken audio device is reported once and never reaches the page that asked for the sound', (t) => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const { sounds, ctx, advance, FakeContext } = listen(t);
  FakeContext.fails = true;
  assert.doesNotThrow(() => sounds.music(true));
  assert.doesNotThrow(() => sounds.question(1));
  assert.doesNotThrow(() => advance(2), 'nor does the timer that was handing notes over');
  assert.doesNotThrow(() => sounds.music(false));
  assert.doesNotThrow(() => sounds.setEnabled(false));
  assert.equal(sounds.enabled, false, 'the switch still works');
  assert.equal(warn.mock.callCount(), 1, 'one warning, not one per tick');
  assert.equal(ctx().oscillators.length, 0);

  const refused = createSounds({
    AudioContext: class {
      constructor() {
        throw new Error('too many audio contexts');
      }
    },
  });
  assert.doesNotThrow(() => refused.music(true));
  assert.doesNotThrow(() => refused.unlock());
  assert.equal(warn.mock.callCount(), 2);
});

test('a context the browser left suspended starts when it is unlocked, without piling notes up meanwhile', (t) => {
  const { sounds, ctx, FakeContext } = listen(t, { suspended: true });
  sounds.music(true);
  assert.equal(ctx().state, 'suspended');
  const waiting = ctx().oscillators.length;
  assert.ok(waiting > 0, 'the first stretch is ready for when it starts');
  mock.timers.tick(5000); // the audio clock is stopped, so nothing new is handed over
  assert.equal(ctx().oscillators.length, waiting);
  FakeContext.locked = false; // someone taps
  sounds.unlock();
  assert.equal(ctx().state, 'running');
});
