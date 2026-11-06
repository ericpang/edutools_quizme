// The host's setup screen: game settings and the quiz builder. Drafts survive a refresh (localStorage).
import { LETTERS, LIMITS, SAMPLE_QUIZ, blankQuestion, exportQuiz, normalizeQuiz, parseQuiz, validateQuiz } from './quiz.js';
import { DIFFICULTIES, GROUP_SIZE, GROUP_SIZE_MAX, GROUP_SIZE_MIN, multiplier } from './scoring.js';
import { ICON } from './shapes.js';
import { fill, h, icon, store, toast } from './ui.js';

const DRAFT_KEY = 'qm.admin.draft';
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint && h('small', {}, hint));

const defaults = () => ({ title: '', mode: 'solo', groupSize: GROUP_SIZE, maxWager: 100, questions: [blankQuestion()] });

function loadDraft() {
  const saved = store.get(DRAFT_KEY);
  if (!saved) return defaults();
  const quiz = normalizeQuiz(saved);
  return {
    ...defaults(),
    title: quiz.title,
    mode: saved.mode === 'group' ? 'group' : 'solo',
    groupSize: Math.min(GROUP_SIZE_MAX, Math.max(GROUP_SIZE_MIN, Number(saved.groupSize) || GROUP_SIZE)),
    maxWager: [100, 75, 50, 25].includes(saved.maxWager) ? saved.maxWager : 100,
    questions: quiz.questions.length ? quiz.questions : [blankQuestion()],
  };
}

// onCreate(quiz, settings) is called with a quiz that passed validation.
export function builderView({ onCreate }) {
  const draft = loadDraft();
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(DRAFT_KEY, draft), 250);
  };
  const touch = () => {
    save();
    problems.hidden = true;
  };

  // ---- settings
  const title = h('input', { class: 'input', id: 'title', value: draft.title, maxlength: LIMITS.title, placeholder: 'e.g. Unit 3 review', oninput: (e) => ((draft.title = e.target.value), touch()) });
  const groupSize = h(
    'select',
    { class: 'input', id: 'groupSize', onchange: (e) => ((draft.groupSize = Number(e.target.value)), touch()) },
    Array.from({ length: GROUP_SIZE_MAX - GROUP_SIZE_MIN + 1 }, (_, i) => GROUP_SIZE_MIN + i).map((n) => h('option', { value: n, selected: n === draft.groupSize }, `${n} players`)),
  );
  const groupField = field('Players per group', groupSize, 'Players are shuffled into random, balanced groups when the game starts.');
  const maxWager = h(
    'select',
    { class: 'input', id: 'maxWager', onchange: (e) => ((draft.maxWager = Number(e.target.value)), touch()) },
    [100, 75, 50, 25].map((n) => h('option', { value: n, selected: n === draft.maxWager }, n === 100 ? 'Up to 100% of their points' : `Up to ${n}%`)),
  );
  const modeChoice = (value, label, hint) =>
    h(
      'label',
      { class: 'seg' },
      h('input', { type: 'radio', name: 'mode', value, checked: draft.mode === value, onchange: () => ((draft.mode = value), (groupField.hidden = value !== 'group'), touch()) }),
      h('span', { class: 'seg-body' }, h('b', {}, label), h('small', {}, hint)),
    );
  groupField.hidden = draft.mode !== 'group';

  // ---- questions
  const list = h('ol', { class: 'qlist' });

  function move(i, by) {
    const j = i + by;
    if (j < 0 || j >= draft.questions.length) return;
    [draft.questions[i], draft.questions[j]] = [draft.questions[j], draft.questions[i]];
    touch();
    renderList(j);
  }
  function remove(i) {
    draft.questions.splice(i, 1);
    if (!draft.questions.length) draft.questions.push(blankQuestion());
    touch();
    renderList(Math.min(i, draft.questions.length - 1));
  }
  function duplicate(i) {
    draft.questions.splice(i + 1, 0, structuredClone(draft.questions[i]));
    touch();
    renderList(i + 1);
  }
  function add() {
    if (draft.questions.length >= LIMITS.maxQuestions) return toast(`A quiz can have up to ${LIMITS.maxQuestions} questions.`);
    draft.questions.push(blankQuestion());
    touch();
    renderList(draft.questions.length - 1);
  }

  const tool = (path, label, onclick, disabled) => h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': label, title: label, onclick, disabled }, icon(path, { size: 20 }));

  function card(q, i) {
    const set = (patch) => {
      Object.assign(q, patch);
      touch();
    };
    const diff = (d) =>
      h(
        'label',
        { class: 'seg' },
        h('input', { type: 'radio', name: `difficulty-${i}`, value: d, checked: q.difficulty === d, onchange: () => set({ difficulty: d }) }),
        h('span', { class: 'seg-body' }, h('b', {}, cap(d)), h('small', {}, `pays ×${multiplier(d)}`)),
      );
    const optionRow = (text, k) =>
      h(
        'div',
        { class: 'opt-row' },
        h('input', { type: 'radio', class: 'opt-correct', name: `correct-${i}`, checked: q.correctIndex === k, 'aria-label': `Option ${LETTERS[k]} is the right answer`, onchange: () => set({ correctIndex: k }) }),
        h('span', { class: `opt-key o${k}` }, LETTERS[k]),
        h('input', { class: 'input', value: text, maxlength: LIMITS.option, placeholder: `Option ${LETTERS[k]}`, 'aria-label': `Option ${LETTERS[k]}`, oninput: (e) => ((q.options[k] = e.target.value), touch()) }),
        tool(ICON.cross, `Remove option ${LETTERS[k]}`, () => {
          q.options.splice(k, 1);
          if (q.correctIndex === k) q.correctIndex = 0;
          else if (q.correctIndex > k) q.correctIndex--;
          touch();
          renderList(i);
        }, q.options.length <= LIMITS.minOptions),
      );

    return h(
      'li',
      { class: 'qcard', id: `q${i + 1}` },
      h('header', { class: 'qcard-head' }, h('h3', {}, `Question ${i + 1}`), h('div', { class: 'qtools' }, tool(ICON.up, 'Move up', () => move(i, -1), i === 0), tool(ICON.down, 'Move down', () => move(i, 1), i === draft.questions.length - 1), tool(ICON.copy, 'Duplicate question', () => duplicate(i)), tool(ICON.trash, 'Delete question', () => remove(i)))),
      h('div', { class: 'grid2' }, field('Category', h('input', { class: 'input', value: q.category, maxlength: LIMITS.category, placeholder: 'e.g. Cell biology', oninput: (e) => set({ category: e.target.value }) }), 'Players see this before they wager.'), h('fieldset', { class: 'token' }, h('legend', {}, 'Difficulty'), h('div', { class: 'seg-row' }, DIFFICULTIES.map(diff)))),
      field('Question', h('textarea', { class: 'input', rows: 2, maxlength: LIMITS.text, placeholder: 'Write the question', oninput: (e) => set({ text: e.target.value }) }, q.text)),
      h('fieldset', { class: 'opts' }, h('legend', {}, 'Options: mark the right answer'), q.options.map(optionRow), q.options.length < LIMITS.maxOptions && h('button', { class: 'btn small', type: 'button', onclick: () => (q.options.push(''), touch(), renderList(i, `option-${q.options.length - 1}`)) }, icon(ICON.plus, { size: 16 }), 'Add option')),
      h(
        'details',
        { class: 'more' },
        h('summary', {}, 'Time limit and explanation'),
        h('div', { class: 'grid2' }, field('Answer time in seconds', h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: LIMITS.minTime, max: LIMITS.maxTime, value: q.timeLimitSec ?? '', placeholder: 'Default', oninput: (e) => set({ timeLimitSec: e.target.value ? Math.round(Number(e.target.value)) : null }) }), `${LIMITS.minTime} to ${LIMITS.maxTime}. Leave empty for the default.`)),
        field('Explanation, shown after the answer is revealed', h('textarea', { class: 'input', rows: 2, maxlength: LIMITS.explanation, oninput: (e) => set({ explanation: e.target.value }) }, q.explanation)),
      ),
    );
  }

  // Rebuild the list (after a structural change) and put the keyboard where the host was working.
  function renderList(focusIndex, focusField) {
    fill(list, draft.questions.map(card));
    count.textContent = `${draft.questions.length} ${draft.questions.length === 1 ? 'question' : 'questions'}`;
    if (focusIndex === undefined) return;
    const cardEl = list.children[focusIndex];
    const target = focusField ? cardEl?.querySelector(`[aria-label="Option ${LETTERS[Number(focusField.split('-')[1])]}"]`) : cardEl?.querySelector('input[type="text"], input:not([type])');
    target?.focus();
    cardEl?.scrollIntoView({ block: 'nearest' });
  }

  // ---- import, export, sample
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'importFile' });
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    const { quiz, problems: found } = parseQuiz(await chosen.text());
    if (!quiz) return toast('That file is not valid JSON.');
    Object.assign(draft, { title: quiz.title || draft.title, questions: quiz.questions.length ? quiz.questions : [blankQuestion()] });
    title.value = draft.title;
    save();
    renderList();
    toast(found.length ? `Imported with ${found.length} thing${found.length === 1 ? '' : 's'} to fix.` : `Imported ${quiz.questions.length} questions.`);
  });
  const exportJson = () => {
    const link = h('a', { href: URL.createObjectURL(new Blob([exportQuiz(draft)], { type: 'application/json' })), download: `${(draft.title || 'quiz').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz'}.json` });
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const loadSample = () => {
    Object.assign(draft, { title: SAMPLE_QUIZ.title, questions: structuredClone(SAMPLE_QUIZ.questions) });
    title.value = draft.title;
    touch();
    renderList();
    toast('Loaded the sample quiz. Edit it or create the game.');
  };

  // ---- create
  const problems = h('section', { class: 'problems', id: 'problems', role: 'alert', hidden: true });
  const count = h('span', { class: 'muted' });
  const form = h(
    'form',
    {
      class: 'builder',
      id: 'builder',
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        const quiz = normalizeQuiz(draft);
        const found = validateQuiz(quiz);
        if (found.length) {
          fill(
            problems,
            h('h2', { class: 'sub' }, 'Fix these before you create the game'),
            h('ul', {}, found.map((p) => h('li', {}, p.index === null ? '' : h('a', { href: `#q${p.index + 1}` }, `Question ${p.index + 1}`), p.index === null ? p.message : `: ${p.message}`))),
          );
          problems.hidden = false;
          problems.scrollIntoView({ block: 'center' });
          return;
        }
        onCreate(quiz, { mode: draft.mode, groupSize: draft.groupSize, maxWager: draft.maxWager });
      },
    },
    h('h1', { class: 'title' }, 'Set up a game'),
    h(
      'section',
      { class: 'settings' },
      field('Quiz title', title),
      h('fieldset', { class: 'token' }, h('legend', {}, 'How do players take part?'), h('div', { class: 'seg-row' }, modeChoice('solo', 'On their own', 'Everyone has their own score'), modeChoice('group', 'In groups', 'Random teams decide together'))),
      groupField,
      field('Largest wager', maxWager, 'Players can wager up to this share of their points on one question.'),
    ),
    h(
      'section',
      { class: 'questions' },
      h(
        'div',
        { class: 'q-toolbar' },
        h('h2', { class: 'sub' }, 'Questions ', count),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', id: 'sampleBtn', onclick: loadSample }, 'Load sample quiz'), h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, icon(ICON.upload, { size: 16 }), 'Import JSON'), h('button', { class: 'btn small', type: 'button', onclick: exportJson }, icon(ICON.download, { size: 16 }), 'Export JSON')),
      ),
      list,
      h('button', { class: 'btn', type: 'button', id: 'addBtn', onclick: add }, icon(ICON.plus, { size: 18 }), 'Add question'),
    ),
    problems,
    h('div', { class: 'builder-bar' }, h('button', { class: 'btn primary big', type: 'submit', id: 'createBtn' }, 'Create game'), h('p', { class: 'muted' }, 'You get a code and a QR code for players to join.')),
    file,
  );
  renderList();
  return { el: form, update() {} };
}
