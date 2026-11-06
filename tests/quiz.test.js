import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, SAMPLE_QUIZ, blankQuestion, exportQuiz, normalizeQuiz, parseQuiz, toStored, validateQuiz } from '../js/quiz.js';

const good = () => normalizeQuiz({ title: 'T', questions: [{ category: 'Maths', difficulty: 'easy', text: '1+1?', options: ['1', '2'], correctIndex: 1 }] });
const messages = (quiz) => validateQuiz(quiz).map((p) => p.message);

test('the sample quiz is playable', () => {
  assert.deepEqual(validateQuiz(SAMPLE_QUIZ), []);
  assert.equal(SAMPLE_QUIZ.questions.length, 8);
});

test('a good quiz passes and a blank question explains what is missing', () => {
  assert.deepEqual(validateQuiz(good()), []);
  const quiz = { title: '', questions: [blankQuestion()] };
  const problems = messages(quiz);
  assert.ok(problems.includes('Give the quiz a title.'));
  assert.ok(problems.some((m) => m.includes('category')));
  assert.ok(problems.includes('Write the question.'));
  assert.ok(problems.some((m) => m.startsWith('Option A is empty')));
});

test('problems point at the question they belong to', () => {
  const quiz = good();
  quiz.questions.push({ ...blankQuestion(), category: 'x', text: 'y', options: ['a', 'b'] });
  quiz.questions[1].correctIndex = 5;
  const problems = validateQuiz(quiz);
  assert.deepEqual(problems.map((p) => p.index), [1]);
  assert.equal(problems[0].message, 'Mark the correct option.');
});

test('limits are enforced', () => {
  const quiz = good();
  quiz.questions[0].options = ['a', 'b', 'c', 'd', 'e'];
  assert.ok(messages(quiz).includes('Use 2 to 4 options.'));
  const long = good();
  long.questions[0].text = 'x'.repeat(LIMITS.text + 1);
  assert.ok(messages(long).some((m) => m.includes('question can have up to')));
  const timed = good();
  timed.questions[0].timeLimitSec = 3;
  assert.ok(messages(timed).some((m) => m.includes('time limit')));
  const many = { title: 'T', questions: Array.from({ length: LIMITS.maxQuestions + 1 }, () => good().questions[0]) };
  assert.ok(messages(many).some((m) => m.includes('up to 50 questions')));
});

test('normalizing fixes types and trims text', () => {
  const quiz = normalizeQuiz({ title: '  A   B ', questions: [{ category: ' c ', difficulty: 'impossible', text: 7, options: [' x ', 2, null, 'y', 'z'], correctIndex: '1', timeLimitSec: '30.4' }, null] });
  assert.equal(quiz.title, 'A B');
  assert.equal(quiz.questions[0].difficulty, 'medium');
  assert.equal(quiz.questions[0].text, '7');
  assert.deepEqual(quiz.questions[0].options, ['x', '2', '', 'y']); // at most four
  assert.equal(quiz.questions[0].correctIndex, 0); // a string is not an index
  assert.equal(quiz.questions[0].timeLimitSec, 30);
  assert.equal(quiz.questions.length, 2);
});

test('export then import gives the same quiz', () => {
  const { quiz, problems } = parseQuiz(exportQuiz(SAMPLE_QUIZ));
  assert.deepEqual(problems, []);
  assert.deepEqual(quiz, SAMPLE_QUIZ);
});

test('importing something that is not a quiz explains why', () => {
  assert.deepEqual(parseQuiz('not json').problems.map((p) => p.message), ['That is not valid JSON.']);
  assert.equal(parseQuiz('not json').quiz, null);
  assert.ok(parseQuiz('{}').problems.some((p) => p.message === 'Add at least one question.'));
});

test('questions are stored as q1, q2, ... with the key as `correct`', () => {
  const stored = toStored(SAMPLE_QUIZ);
  assert.deepEqual(Object.keys(stored), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  assert.equal(stored.q1.correct, 2);
  assert.equal('correctIndex' in stored.q1, false);
  assert.equal(stored.q2.explanation, undefined); // optional fields are left out, never written as null
  assert.equal(stored.q1.explanation.startsWith('Mitochondria'), true);
});
