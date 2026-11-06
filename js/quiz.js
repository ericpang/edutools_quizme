// The quiz a host builds: cleaning, checking, importing and exporting it (pure; no DOM or Firebase).
import { DIFFICULTIES } from './scoring.js';

export const LIMITS = { title: 60, category: 40, text: 300, option: 120, explanation: 300, minOptions: 2, maxOptions: 4, maxQuestions: 50, minTime: 5, maxTime: 120 };
export const LETTERS = 'ABCD';

export const blankQuestion = () => ({ category: '', difficulty: 'medium', text: '', options: ['', ''], correctIndex: 0, timeLimitSec: null, explanation: '' });

const line = (value) => (value === null || value === undefined ? '' : String(value)).replace(/\s+/g, ' ').trim();

// Shape anything (a parsed file, an old draft) into a quiz with the right types. Does not judge it: see validateQuiz.
export function normalizeQuiz(raw) {
  const questions = (Array.isArray(raw?.questions) ? raw.questions : []).map((q) => {
    const time = Number(q?.timeLimitSec);
    return {
      category: line(q?.category),
      difficulty: DIFFICULTIES.includes(q?.difficulty) ? q.difficulty : 'medium',
      text: line(q?.text),
      options: (Array.isArray(q?.options) ? q.options : []).slice(0, LIMITS.maxOptions).map(line),
      correctIndex: Number.isInteger(q?.correctIndex) ? q.correctIndex : 0,
      timeLimitSec: Number.isFinite(time) && time > 0 ? Math.round(time) : null,
      explanation: line(q?.explanation),
    };
  });
  return { title: line(raw?.title), questions };
}

// Everything that stops a quiz from being played, as [{ index, message }] (index is the question's position, or null).
export function validateQuiz(quiz) {
  const problems = [];
  const add = (index, message) => problems.push({ index, message });
  if (!quiz.title) add(null, 'Give the quiz a title.');
  else if (quiz.title.length > LIMITS.title) add(null, `The title can have up to ${LIMITS.title} characters.`);
  if (!quiz.questions.length) add(null, 'Add at least one question.');
  if (quiz.questions.length > LIMITS.maxQuestions) add(null, `A quiz can have up to ${LIMITS.maxQuestions} questions.`);

  quiz.questions.forEach((q, i) => {
    if (!q.category) add(i, 'Add a category: players see it before they wager.');
    else if (q.category.length > LIMITS.category) add(i, `The category can have up to ${LIMITS.category} characters.`);
    if (!DIFFICULTIES.includes(q.difficulty)) add(i, 'Pick easy, medium or hard.');
    if (!q.text) add(i, 'Write the question.');
    else if (q.text.length > LIMITS.text) add(i, `The question can have up to ${LIMITS.text} characters.`);
    if (q.options.length < LIMITS.minOptions || q.options.length > LIMITS.maxOptions) add(i, `Use ${LIMITS.minOptions} to ${LIMITS.maxOptions} options.`);
    q.options.forEach((option, k) => {
      if (!option) add(i, `Option ${LETTERS[k]} is empty: fill it in or remove it.`);
      else if (option.length > LIMITS.option) add(i, `Option ${LETTERS[k]} can have up to ${LIMITS.option} characters.`);
    });
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) add(i, 'Mark the correct option.');
    if (q.timeLimitSec !== null && !(q.timeLimitSec >= LIMITS.minTime && q.timeLimitSec <= LIMITS.maxTime)) add(i, `The time limit is ${LIMITS.minTime} to ${LIMITS.maxTime} seconds.`);
    if (q.explanation.length > LIMITS.explanation) add(i, `The explanation can have up to ${LIMITS.explanation} characters.`);
  });
  return problems;
}

// Read a quiz from JSON text. `quiz` is null when the text is not JSON at all; `problems` lists what is wrong.
export function parseQuiz(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { quiz: null, problems: [{ index: null, message: 'That is not valid JSON.' }] };
  }
  const quiz = normalizeQuiz(raw);
  return { quiz, problems: validateQuiz(quiz) };
}

export function exportQuiz(quiz) {
  const questions = quiz.questions.map((q) => ({
    category: q.category,
    difficulty: q.difficulty,
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    ...(q.timeLimitSec ? { timeLimitSec: q.timeLimitSec } : {}),
    ...(q.explanation ? { explanation: q.explanation } : {}),
  }));
  return JSON.stringify({ title: quiz.title, questions }, null, 2);
}

// The shape stored in the database under quiz/<qid>: q1, q2, ... in play order.
export function toStored(quiz) {
  return Object.fromEntries(
    quiz.questions.map((q, i) => [
      `q${i + 1}`,
      {
        category: q.category,
        difficulty: q.difficulty,
        text: q.text,
        options: q.options,
        correct: q.correctIndex,
        ...(q.timeLimitSec ? { timeLimitSec: q.timeLimitSec } : {}),
        ...(q.explanation ? { explanation: q.explanation } : {}),
      },
    ]),
  );
}

export const SAMPLE_QUIZ = normalizeQuiz({
  title: 'General knowledge warm-up',
  questions: [
    { category: 'Cell biology', difficulty: 'hard', text: "Which organelle produces most of a cell's ATP?", options: ['Golgi apparatus', 'Ribosome', 'Mitochondrion', 'Lysosome'], correctIndex: 2, explanation: 'Mitochondria run the final stages of respiration, where most ATP is made.' },
    { category: 'World geography', difficulty: 'easy', text: 'Which is the longest river in Africa?', options: ['Congo', 'Niger', 'Nile', 'Zambezi'], correctIndex: 2 },
    { category: 'Chemistry', difficulty: 'medium', text: 'What is the chemical symbol for sodium?', options: ['So', 'Na', 'Sd', 'S'], correctIndex: 1, explanation: 'Na comes from natrium, the Latin name for sodium.' },
    { category: 'Modern history', difficulty: 'medium', text: 'In which year did the Berlin Wall fall?', options: ['1985', '1987', '1989', '1991'], correctIndex: 2 },
    { category: 'Mathematics', difficulty: 'easy', text: 'What is 7 × 8?', options: ['54', '56', '58', '64'], correctIndex: 1 },
    { category: 'Literature', difficulty: 'hard', text: "Who wrote the novel 'One Hundred Years of Solitude'?", options: ['Gabriel García Márquez', 'Jorge Luis Borges', 'Isabel Allende', 'Mario Vargas Llosa'], correctIndex: 0 },
    { category: 'Physics', difficulty: 'medium', text: 'What is the SI unit of force?', options: ['Joule', 'Newton', 'Watt', 'Pascal'], correctIndex: 1 },
    { category: 'Technology', difficulty: 'easy', text: "What does 'HTTP' stand for?", options: ['HyperText Transfer Protocol', 'High Transfer Text Process', 'HyperText Transmission Program', 'Host Transfer Type Protocol'], correctIndex: 0 },
  ],
});
