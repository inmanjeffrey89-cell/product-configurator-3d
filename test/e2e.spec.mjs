import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test', 'out');
const pricing = JSON.parse(await readFile(path.join(root, 'src', 'pricing.json'), 'utf8'));

const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

let server;
let baseUrl = process.env.BASE_URL;
let browser;

function expectedPrice({ product, material = 'matte', body = 'navy', accent = 'clay', monogram = false }) {
  const row = pricing.products[product];
  const extra = (id) => pricing.colors.find((c) => c.id === id).extra;
  const total = row.base + row.material[material] + extra(body) + extra(accent) + (monogram ? pricing.monogram : 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency }).format(total);
}

async function startServer() {
  const port = 8000 + Math.floor(Math.random() * 1000);
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      return url;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('local server did not start');
}

async function openApp(context, hash = '', viewport = { width: 1280, height: 800 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`${baseUrl}/${hash}`);
  await page.waitForSelector('.stage.is-ready', { timeout: 60_000 });
  await page.waitForFunction(() => window.configurator && window.configurator.stats().calls > 0);
  return { page, errors };
}

before(async () => {
  await mkdir(outDir, { recursive: true });
  if (!baseUrl) baseUrl = await startServer();
  baseUrl = baseUrl.replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('renders the product with real WebGL draw calls', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context);

  assert.equal(await page.locator('canvas#view').count(), 1);
  const stats = await page.evaluate(() => window.configurator.stats());
  assert.ok(stats.calls > 0, `draw calls: ${stats.calls}`);
  assert.ok(stats.triangles > 1000, `triangles: ${stats.triangles}`);

  const distinctColors = await page.evaluate(async () => {
    const blob = await window.configurator.snapshot();
    const bitmap = await createImageBitmap(blob);
    const probe = document.createElement('canvas');
    probe.width = 160;
    probe.height = 100;
    const ctx = probe.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, probe.width, probe.height);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });
  assert.ok(distinctColors > 100, `distinct colors in the frame: ${distinctColors}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('price follows the pricing table as options change', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context);
  const total = page.locator('#price-total');

  assert.equal(await total.textContent(), expectedPrice({ product: 'mug' }));

  await page.locator('input[name="material"][value="gloss"]').check({ force: true });
  assert.equal(await total.textContent(), expectedPrice({ product: 'mug', material: 'gloss' }));

  await page.locator('input[name="body"][value="brass"]').check({ force: true });
  assert.equal(await total.textContent(), expectedPrice({ product: 'mug', material: 'gloss', body: 'brass' }));

  await page.locator('#monogram').check({ force: true });
  await page.locator('#monogram-text').fill('ab');
  assert.equal(await page.locator('#monogram-text').inputValue(), 'AB');
  assert.equal(await total.textContent(), expectedPrice({ product: 'mug', material: 'gloss', body: 'brass', monogram: true }));

  await page.locator('input[name="product"][value="chair"]').check({ force: true });
  assert.equal(await total.textContent(), expectedPrice({ product: 'chair', material: 'gloss', body: 'brass', monogram: true }));
  assert.equal(await page.locator('#product-name').textContent(), 'Chair');

  const hash = await page.evaluate(() => location.hash);
  assert.equal(hash, '#p=chair&body=brass&accent=clay&mat=gloss&mono=1&text=AB');
  await context.close();
});

test('a shared hash restores every control', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context, '#p=backpack&body=sage&accent=oxblood&mat=metal&mono=1&text=QX');

  assert.ok(await page.locator('input[name="product"][value="backpack"]').isChecked());
  assert.ok(await page.locator('input[name="body"][value="sage"]').isChecked());
  assert.ok(await page.locator('input[name="accent"][value="oxblood"]').isChecked());
  assert.ok(await page.locator('input[name="material"][value="metal"]').isChecked());
  assert.ok(await page.locator('#monogram').isChecked());
  assert.equal(await page.locator('#monogram-text').inputValue(), 'QX');
  assert.equal(
    await page.locator('#price-total').textContent(),
    expectedPrice({ product: 'backpack', material: 'metal', body: 'sage', accent: 'oxblood', monogram: true }),
  );
  await context.close();
});

test('copy share link puts the current URL on the clipboard', async () => {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const { page } = await openApp(context, '#p=chair&body=charcoal&accent=brass&mat=matte');
  await page.locator('#share').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('copied'));
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard, await page.evaluate(() => location.href));
  assert.ok(clipboard.endsWith('#p=chair&body=charcoal&accent=brass&mat=matte'));
  await context.close();
});

test('download PNG saves a real image of the view', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const { page } = await openApp(context, '#p=mug&body=navy&accent=brass&mat=gloss&mono=1&text=JI');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  assert.equal(download.suggestedFilename(), 'mug-navy-brass-gloss.png');
  const file = path.join(outDir, download.suggestedFilename());
  await download.saveAs(file);
  const { size } = await stat(file);
  assert.ok(size > 20_000, `png size: ${size}`);
  const head = (await readFile(file)).subarray(0, 8);
  assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await context.close();
});

test('desktop and phone layouts render and screenshot', async () => {
  const context = await browser.newContext();
  const desktop = await openApp(context, '#p=mug&body=navy&accent=clay&mat=gloss&mono=1&text=JI');
  await desktop.page.locator('label[for="auto-rotate"]').click();
  assert.ok(!(await desktop.page.locator('#auto-rotate').isChecked()));
  await desktop.page.screenshot({ path: path.join(outDir, 'screenshot.png') });
  const panelBox = await desktop.page.locator('#panel').boundingBox();
  assert.ok(panelBox.x > 800, 'panel sits to the right on desktop');
  assert.ok(!(await desktop.page.locator('.sheet-toggle').isVisible()));
  assert.deepEqual(desktop.errors, []);
  await desktop.page.close();

  const phone = await openApp(context, '#p=chair&body=sage&accent=bone&mat=matte', { width: 390, height: 844 });
  const toggle = phone.page.locator('.sheet-toggle');
  assert.ok(await toggle.isVisible());
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await phone.page.screenshot({ path: path.join(outDir, 'screenshot-phone.png') });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await phone.page.waitForTimeout(400);
  await phone.page.screenshot({ path: path.join(outDir, 'screenshot-phone-open.png') });
  const width = await phone.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, `no horizontal overflow, scrollWidth ${width}`);
  assert.deepEqual(phone.errors, []);
  await context.close();
});
