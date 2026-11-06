// Runs the engine on the host's page: watches the room, and writes the next step whenever the engine has one.
// It keeps no game state of its own. Everything comes from the database, so a refresh picks the game up where it was.
import { advance, autoStep, finishPatch, removePatch, shufflePatch } from './engine.js';

const EMPTY = { meta: null, cur: null, players: {}, group: {}, score: {}, perk: {}, bid: {}, ans: {}, side: {}, vote: {}, stats: null, res: null, out: {} };
const ROOM_KEYS = ['meta', 'cur', 'players', 'group', 'score', 'perk'];
const QUESTION_KEYS = ['bid', 'ans', 'side', 'vote', 'stats', 'res', 'out']; // watched per question (cur.qid)

export class Host {
  constructor(room, { onChange, onError }) {
    this.room = room;
    this.onChange = onChange;
    this.onError = onError;
    this.state = { ...EMPTY, quiz: null };
    this.pending = new Set(); // watchers that have not reported yet: the engine does not act on half a picture
    this.offs = [];
    this.questionOffs = [];
    this.qid = null;
    this.busy = false;
    this.blockedUntil = 0;
  }

  async start() {
    this.state.quiz = await this.room.getQuiz();
    for (const key of ROOM_KEYS) this.watch(key, key, this.offs);
    this.timer = setInterval(() => this.tick(), 250);
  }

  stop() {
    clearInterval(this.timer);
    for (const off of [...this.offs, ...this.questionOffs]) off();
    this.offs = [];
    this.questionOffs = [];
  }

  watch(key, path, offs) {
    this.pending.add(key);
    offs.push(
      this.room.watch(
        path,
        (value) => {
          this.state[key] = value ?? EMPTY[key];
          this.pending.delete(key);
          if (key === 'cur') this.followQuestion();
          this.changed();
        },
        (err) => this.onError?.(err),
      ),
    );
  }

  // When the question changes, drop what was known about the old one and watch the new one.
  followQuestion() {
    const qid = this.state.cur?.qid ?? null;
    if (qid === this.qid) return;
    this.qid = qid;
    for (const off of this.questionOffs) off();
    this.questionOffs = [];
    for (const key of QUESTION_KEYS) {
      this.state[key] = EMPTY[key];
      this.pending.delete(key);
    }
    if (qid) for (const key of QUESTION_KEYS) this.watch(key, `${key}/${qid}`, this.questionOffs);
  }

  changed() {
    this.onChange?.(this.state);
    clearTimeout(this.poked);
    this.poked = setTimeout(() => this.tick(), 0);
  }

  get loaded() {
    return this.pending.size === 0 && this.state.meta && this.state.cur && this.state.quiz;
  }

  serverNow = () => this.room.serverNow();

  async tick() {
    if (this.busy || !this.loaded || Date.now() < this.blockedUntil) return;
    const patch = autoStep(this.state, this.serverNow());
    if (patch) await this.write(patch);
  }

  // One write at a time. A refused write (rules not published, or a bug) pauses the loop and tells the host.
  async write(patch) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.room.apply(patch);
      this.onError?.(null);
    } catch (err) {
      this.blockedUntil = Date.now() + 4000;
      this.onError?.(err, patch);
    } finally {
      this.busy = false;
    }
  }

  // The host's buttons
  next() {
    const patch = this.loaded && advance(this.state, this.serverNow());
    return patch ? this.write(patch) : undefined;
  }
  finish() {
    return this.loaded ? this.write(finishPatch(this.state)) : undefined;
  }
  shuffle() {
    const patch = this.loaded && shufflePatch(this.state);
    return patch ? this.write(patch) : undefined;
  }
  remove(uid) {
    return this.write(removePatch(uid));
  }
  setOpen(open) {
    return this.room.setMeta({ open });
  }
}
