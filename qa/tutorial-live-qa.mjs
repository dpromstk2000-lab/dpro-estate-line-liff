import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseURL = (process.env.TUTORIAL_BASE_URL || 'https://dpromstk2000-lab.github.io/dpro-estate-line-liff/').replace(/\/?$/, '/');
const outputDir = process.env.TUTORIAL_QA_DIR || 'qa-results/tutorial-r3';
const viewports = [
  { name:'desktop', width:1440, height:1000 },
  { name:'tablet', width:1024, height:768 },
  { name:'mobile390', width:390, height:844 },
  { name:'mobile320', width:320, height:720 }
];
const forbidden = new Set(['POST','PUT','PATCH','DELETE']);
const results = { standard:'DPRO TUTORIAL STANDARD V1.1', baseURL, startedAt:new Date().toISOString(), viewports:[], failures:[], unsafeWrites:[] };

function check(condition, message, detail={}) {
  if (!condition) results.failures.push({ message, ...detail });
}

async function snapshot(page, viewport, label) {
  const data = await page.evaluate(() => {
    const card = document.querySelector('#dproTutorialCard');
    const highlight = document.querySelector('#dproTutorialHighlight');
    const state = window.DPRO_ESTATE_TUTORIAL?.getState?.();
    const rect = card && !card.hidden ? card.getBoundingClientRect() : null;
    const hrect = highlight && !highlight.hidden ? highlight.getBoundingClientRect() : null;
    return {
      url:location.href,
      innerWidth:window.innerWidth,
      innerHeight:window.innerHeight,
      htmlScrollWidth:document.documentElement.scrollWidth,
      bodyScrollWidth:document.body.scrollWidth,
      state,
      title:document.querySelector('#dproTutorialTitle')?.textContent || '',
      progress:document.querySelector('#dproTutorialProgress')?.textContent || '',
      card:rect ? { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height } : null,
      highlight:hrect ? { left:hrect.left, top:hrect.top, right:hrect.right, bottom:hrect.bottom } : null,
      activeId:document.activeElement?.id || ''
    };
  });
  check(data.innerWidth === viewport.width, 'innerWidth mismatch', { label, expected:viewport.width, actual:data.innerWidth });
  check(data.htmlScrollWidth <= data.innerWidth && data.bodyScrollWidth <= data.innerWidth, 'horizontal overflow', { label, innerWidth:data.innerWidth, html:data.htmlScrollWidth, body:data.bodyScrollWidth });
  if (data.card) check(data.card.left >= 7 && data.card.top >= 7 && data.card.right <= data.innerWidth + .5 && data.card.bottom <= data.innerHeight + .5, 'card outside viewport', { label, card:data.card });
  if (data.highlight) check(data.highlight.left >= 7 && data.highlight.top >= 7 && data.highlight.right <= data.innerWidth + .5 && data.highlight.bottom <= data.innerHeight + .5, 'highlight outside viewport', { label, highlight:data.highlight });
  return data;
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport:{ width:viewport.width, height:viewport.height }, isMobile:viewport.width <= 390, hasTouch:viewport.width <= 390 });
  const page = await context.newPage();
  const record = { ...viewport, steps:[], pageErrors:[], consoleErrors:[], drags:[] };
  results.viewports.push(record);
  page.on('pageerror', error => record.pageErrors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') record.consoleErrors.push(msg.text()); });
  page.on('request', request => {
    const method = request.method().toUpperCase();
    if (!forbidden.has(method)) return;
    const url = request.url();
    if (!(method === 'POST' && /\/api\/admin\/login(?:\?|$)/.test(url))) results.unsafeWrites.push({ viewport:viewport.name, method, url });
  });

  await page.goto(`${baseURL}index.html?demo=1`, { waitUntil:'networkidle' });
  await page.evaluate(() => localStorage.removeItem(window.DPRO_ESTATE_TUTORIAL.storageKey));
  await page.reload({ waitUntil:'networkidle' });
  check(await page.locator('#dproTutorialLauncher').innerText() === 'First10を開始', 'initial launcher label mismatch', { viewport:viewport.name });
  await page.locator('#dproTutorialLauncher').click();

  for (let expected=1; expected<=10; expected += 1) {
    await page.locator('#dproTutorialCard').waitFor({ state:'visible' });
    await page.waitForTimeout(350);
    const data = await snapshot(page, viewport, `${viewport.name}-step-${expected}`);
    record.steps.push(data);
    check(data.state?.currentStep === expected, 'step state mismatch', { viewport:viewport.name, expected, actual:data.state?.currentStep });
    check(data.state?.tutorialId === 'estate-first10-v1.1' && data.state?.schemaVersion === '1.1.0', 'identity/version mismatch', { viewport:viewport.name, expected });
    check(data.progress === `${expected} / 10`, 'progress mismatch', { viewport:viewport.name, expected, actual:data.progress });
    check(Boolean(data.highlight), 'highlight unresolved', { viewport:viewport.name, expected, url:data.url });

    if (expected === 1) {
      const handle = page.locator('#dproTutorialHandle');
      const before = await page.locator('#dproTutorialCard').boundingBox();
      if (viewport.width <= 390) {
        await handle.dispatchEvent('pointerdown', { pointerId:71, pointerType:'touch', clientX:before.x + 60, clientY:before.y + 20, bubbles:true });
        await handle.dispatchEvent('pointermove', { pointerId:71, pointerType:'touch', clientX:before.x + 90, clientY:before.y + 55, bubbles:true });
        await handle.dispatchEvent('pointerup', { pointerId:71, pointerType:'touch', clientX:before.x + 90, clientY:before.y + 55, bubbles:true });
      } else {
        await handle.hover();
        await page.mouse.down();
        await page.mouse.move(Math.min(viewport.width - 40, before.x + 100), Math.min(viewport.height - 40, before.y + 80), { steps:5 });
        await page.mouse.up();
      }
      const after = await page.locator('#dproTutorialCard').boundingBox();
      record.drags.push({ input:viewport.width <= 390 ? 'touch-pointer' : 'mouse-pointer', before, after });
      check(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 4, 'drag did not move card', { viewport:viewport.name });
      await handle.focus();
      await handle.press('Home');
      const keyboardBefore = await page.locator('#dproTutorialCard').boundingBox();
      await handle.press('ArrowDown');
      const keyboard = await page.locator('#dproTutorialCard').boundingBox();
      const availableX = viewport.width - keyboard.width - 16;
      const availableY = viewport.height - keyboard.height - 16;
      const moved = Math.abs(keyboard.x - keyboardBefore.x) + Math.abs(keyboard.y - keyboardBefore.y) >= 1;
      check(moved || (availableX <= 1 && availableY <= 1), 'keyboard drag did not move card', { viewport:viewport.name, availableX, availableY });
    }

    if ([2,6,8,9].includes(expected)) {
      await page.reload({ waitUntil:'networkidle' });
      const resume = await snapshot(page, viewport, `${viewport.name}-reload-${expected}`);
      check(resume.state?.currentStep === expected && resume.state?.status === 'in_progress', 'reload resume mismatch', { viewport:viewport.name, expected, state:resume.state });
    }

    if (expected === 3) {
      await page.keyboard.press('Escape');
      check(await page.locator('#dproTutorialLauncher').isVisible(), 'launcher missing after Escape', { viewport:viewport.name });
      check(await page.evaluate(() => document.activeElement?.id) === 'dproTutorialLauncher', 'focus not restored after Escape', { viewport:viewport.name });
      await page.locator('#dproTutorialLauncher').click();
    }

    if (expected < 10) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => {}),
        page.locator('#dproTutorialNext').click()
      ]);
    } else {
      await page.locator('#dproTutorialNext').click();
    }
  }

  const complete = await page.evaluate(() => window.DPRO_ESTATE_TUTORIAL.getState());
  check(complete.status === 'completed' && complete.completedSteps.length === 10, 'completion mismatch', { viewport:viewport.name, state:complete });
  check(await page.locator('#dproTutorialLauncher').innerText() === 'First10をやり直す', 'replay label mismatch', { viewport:viewport.name });
  await page.locator('#dproTutorialLauncher').click();
  await page.waitForLoadState('domcontentloaded');
  const replay = await page.evaluate(() => window.DPRO_ESTATE_TUTORIAL.getState());
  check(replay.status === 'in_progress' && replay.currentStep === 1 && replay.completedSteps.length === 0, 'replay state mismatch', { viewport:viewport.name, state:replay });

  await page.screenshot({ path:path.join(outputDir, `${viewport.name}.png`), fullPage:false });
  await context.close();
}

await mkdir(outputDir, { recursive:true });
const browser = await chromium.launch({ headless:true });
try {
  for (const viewport of viewports) await runViewport(browser, viewport);
} finally {
  await browser.close();
}
results.finishedAt = new Date().toISOString();
results.pass = results.failures.length === 0 && results.unsafeWrites.length === 0 && results.viewports.every(v => v.pageErrors.length === 0 && v.consoleErrors.length === 0);
await writeFile(path.join(outputDir, 'R3_QA_EVIDENCE.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(outputDir, 'R3_QA_EVIDENCE.txt'), [
  `R3 LIVE QA: ${results.pass ? 'PASS' : 'FAIL'}`,
  `Base URL: ${baseURL}`,
  `Viewports: ${viewports.map(v => `${v.width}x${v.height}`).join(', ')}`,
  `Failures: ${results.failures.length}`,
  `Unsafe writes: ${results.unsafeWrites.length}`,
  `Page errors: ${results.viewports.reduce((n,v) => n + v.pageErrors.length, 0)}`,
  `Console errors: ${results.viewports.reduce((n,v) => n + v.consoleErrors.length, 0)}`,
  '',
  '次のアクション: PASSの場合のみR4 Guide Centerへ進む。'
].join('\n'));
console.log(JSON.stringify({ pass:results.pass, failures:results.failures.length, unsafeWrites:results.unsafeWrites.length }, null, 2));
const publicIssues = [
  ...results.failures.map(item => `CHECK: ${item.message} | ${JSON.stringify(item)}`),
  ...results.unsafeWrites.map(item => `UNSAFE WRITE: ${JSON.stringify(item)}`),
  ...results.viewports.flatMap(viewport => viewport.pageErrors.map(message => `PAGE ERROR ${viewport.name}: ${message}`)),
  ...results.viewports.flatMap(viewport => viewport.consoleErrors.map(message => `CONSOLE ERROR ${viewport.name}: ${message}`))
];
for (const issue of publicIssues.slice(0, 40)) {
  console.error(`::error title=Estate R3 QA::${issue.replace(/[\r\n]/g, ' ')}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    `## Estate Tutorial R3 Live QA: ${results.pass ? 'PASS' : 'FAIL'}`,
    '',
    `- Failures: ${results.failures.length}`,
    `- Unsafe writes: ${results.unsafeWrites.length}`,
    `- Page errors: ${results.viewports.reduce((n,v) => n + v.pageErrors.length, 0)}`,
    `- Console errors: ${results.viewports.reduce((n,v) => n + v.consoleErrors.length, 0)}`,
    '',
    ...publicIssues.slice(0, 40).map(issue => `- ${issue}`),
    ''
  ].join('\n'));
}
if (!results.pass) process.exitCode = 1;
