// Everything the app reads and writes in one game lives under quizzes/<code> (see database.rules.json).
// This is the only file that talks to the database.
import { db, get, onDisconnect, onValue, ref, remove, serverTimestamp, set, update } from './firebase.js';
import { makeCode } from './codes.js';

export class Room {
  constructor(code, uid) {
    this.code = code;
    this.uid = uid;
    this.offset = 0; // server clock minus ours, so deadlines (in server time) can be compared with Date.now()
    onValue(ref(db, '.info/serverTimeOffset'), (s) => (this.offset = s.val() ?? 0));
  }

  ref = (path = '') => ref(db, `quizzes/${this.code}${path ? `/${path}` : ''}`);
  serverNow = () => Date.now() + this.offset;

  // Every watcher returns its own unsubscribe function. A refused read (permission denied) reports to onError.
  watch(path, cb, onError) {
    return onValue(this.ref(path), (snap) => cb(snap.val()), (err) => onError?.(err));
  }

  getMeta = async () => (await get(this.ref('meta'))).val();
  getMe = async () => (await get(this.ref(`players/${this.uid}`))).val();

  // ---- players
  async join(name) {
    await set(this.ref(`players/${this.uid}`), { name, on: true, ts: serverTimestamp() });
    this.keepPresent();
  }

  // Back after a refresh: mark me online again (the join time stays as it was).
  async rejoin(name) {
    await update(this.ref(`players/${this.uid}`), { on: true, ...(name ? { name } : {}) });
    this.keepPresent();
  }

  // `on` follows the connection: false when the phone drops, true again when it comes back.
  keepPresent() {
    this.presenceOff?.();
    this.presenceOff = onValue(ref(db, '.info/connected'), (s) => {
      if (s.val() !== true) return;
      const on = this.ref(`players/${this.uid}/on`);
      onDisconnect(on).set(false);
      set(on, true).catch(() => {});
    });
  }

  // Solo mode: I bid, answer and bet for myself, once. The rules refuse a second write.
  bid = (qid, pct, token) => set(this.ref(`bid/${qid}/${this.uid}`), { pct, ...(token ? { token } : {}), ts: serverTimestamp() });
  answer = (qid, v) => set(this.ref(`ans/${qid}/${this.uid}`), { v, ts: serverTimestamp() });
  sideBet = (qid, v) => set(this.ref(`side/${qid}/${this.uid}`), { v, ts: serverTimestamp() });

  // Group mode: my vote on one step ('bid', 'ans' or 'side') for my group. Writing it again changes the vote, and a
  // vote written without `ok` is no longer Ready.
  vote = (qid, group, step, value) => set(this.ref(`vote/${qid}/${group}/${this.uid}/${step}`), value);

  // Everything I need for the end-of-game report: each question's outcome and result, plus (in a group) how my own
  // answer vote compared with the group's answer.
  history(total, subject, group) {
    const read = async (path) => (await get(this.ref(path))).val();
    return Promise.all(
      Array.from({ length: total }, (_, i) => `q${i + 1}`).map(async (qid) => {
        const [out, res, vote, ans] = await Promise.all([read(`out/${qid}/${subject}`), read(`res/${qid}`), group ? read(`vote/${qid}/${subject}/${this.uid}/ans`) : null, group ? read(`ans/${qid}/${subject}`) : null]);
        return { qid, out, res, vote, ans };
      }),
    );
  }

  // ---- the host
  // Claim a fresh code. The rules refuse a code that already has an owner, so a clash just means trying another.
  static async create(uid, settings, stored, total) {
    let last;
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = new Room(makeCode(), uid);
      try {
        await set(room.ref('meta'), { owner: uid, ...settings, open: true, createdAt: serverTimestamp() });
        await update(room.ref(), { quiz: stored, cur: { phase: 'lobby', n: 0, total } });
        return room;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  // One atomic write of everything a step of the game changes (see js/engine.js).
  apply = (patch) => update(this.ref(), patch);
  setMeta = (patch) => update(this.ref('meta'), patch);
  getQuiz = async () => (await get(this.ref('quiz'))).val();
  end = () => remove(this.ref());
}
