import assert from 'node:assert/strict';
import type { Browser, Page } from '@playwright/test';
import { ContextClient } from '../../packages/context-sdk/src';
import { COPY } from '../../src/lib/ui/copy';

/** Real quiz UI + real memory HTTP. Only quiz generation is an explicit fixture. */
export async function verifyQuizBrowser(browser: Browser, base: string, token: string): Promise<void> {
  const question = { id: 'synthetic-objective', stem: '【合成验收题面】请选择条件概率。'.repeat(20), type: 'single', options: ['A. Joint probability', 'B. Conditional probability'], answer: 'B' };
  const subjective = { id: 'synthetic-subjective', stem: '【合成验收】解释条件概率。', type: 'short', options: [], answer: '合成参考答案：限定条件下的概率。' };
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.setDefaultNavigationTimeout(120_000);
  const owner = new ContextClient({ baseUrl: `${base}/api/context/v1`, token });
  let releaseAuth: () => void = () => undefined;
  const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
  // Delay the real auth response until the first click, reproducing the cold-start race.
  await page.route('**/api/auth/me', async (route) => { await authGate; await route.continue(); });
  await page.addInitScript((accessToken) => localStorage.setItem('meetmind_access_token', accessToken), token);
  await page.route('**/api/llm/models', (route) => route.fulfill({ json: { models: [{ id: 'synthetic-model' }], workshopModel: 'synthetic-model' } }));
  await page.route('**/api/apps/execute', (route) => route.fulfill({ json: { ok: true, result: {
    pluginId: 'quiz-arena', version: '1', cards: [], tasks: [], trace: [], render: { mode: 'quiz', payload: { questions: [question, subjective] } },
  } } }));
  try {
    await page.goto(`${base}/app/matrix/quiz?dataSource=demo`);
    await page.getByText(question.stem, { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: /Conditional probability/ }).click();
    const first = await submitAttempt(page, owner, async () => {
      await page.getByRole('button', { name: COPY.apps.quiz.confirmAnswer, exact: true }).click();
      releaseAuth();
    });
    const firstContent = JSON.parse((await owner.source(first)).event.content!);
    assert.equal(firstContent.question.stem, question.stem);
    assert.equal(firstContent.response.submittedAnswer, question.options[1]);
    assert.equal(firstContent.conditions.referenceSeenInCurrentViewBeforeSubmission, false);

    await page.getByRole('button', { name: COPY.apps.quiz.nextQuestion, exact: true }).click();
    await page.getByText(subjective.stem, { exact: true }).waitFor();
    await page.getByRole('button', { name: COPY.apps.quiz.revealReference, exact: true }).click();
    const self = await submitAttempt(page, owner, () => page.getByRole('button', { name: COPY.apps.quiz.selfCorrect, exact: true }).click());
    const selfContent = JSON.parse((await owner.source(self)).event.content!);
    assert.equal(selfContent.response.submittedAnswer, null);
    assert.equal(selfContent.grading.basis, 'learner_self_report');
    assert.equal(selfContent.conditions.referenceSeenInCurrentViewBeforeSubmission, true);

    await page.getByRole('button', { name: COPY.apps.quiz.viewResult, exact: true }).click();
    await page.getByRole('button', { name: COPY.apps.quiz.restart, exact: true }).click();
    await page.getByRole('button', { name: /Conditional probability/ }).click();
    const repeat = await submitAttempt(page, owner, () => page.getByRole('button', { name: COPY.apps.quiz.confirmAnswer, exact: true }).click());
    assert.notEqual(repeat, first);
    const repeated = JSON.parse((await owner.source(repeat)).event.content!);
    assert.equal(repeated.conditions.referenceSeenInCurrentViewBeforeSubmission, true);
  } finally { releaseAuth(); await page.close(); }
}

async function submitAttempt(page: Page, owner: ContextClient, action: () => Promise<void>): Promise<string> {
  const before = (await owner.events()).events.filter((event) => event.type === 'practice.attempt').map((event) => event.id);
  await action();
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    const next = (await owner.events()).events.filter((event) => event.type === 'practice.attempt' && !before.includes(event.id));
    if (next[0]) return next[0].id;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert.fail('quiz_attempt_event_not_received');
}
