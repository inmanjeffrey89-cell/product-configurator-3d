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

test('share link falls back to a field that stays when the clipboard is blocked', async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
  });
  const { page, errors } = await openApp(context, '#p=backpack&body=clay&accent=sand&mat=matte');
  await page.locator('#share').click();
  const field = page.locator('#status .status-link');
  await field.waitFor();
  assert.equal(await field.inputValue(), await page.evaluate(() => location.href));
  assert.ok(await field.evaluate((el) => el.selectionEnd - el.selectionStart === el.value.length), 'link is pre-selected');
  await page.waitForTimeout(4500);
  assert.ok(await field.isVisible(), 'the link stays past the 4 s status timer');
  assert.match(await page.locator('#status').textContent(), /Copy this link/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('chair back posts sit behind the back panel and the monogram survives a finish change', async () => {
  const context = await browser.newContext();
  const { page, errors } = await openApp(context, '#p=chair&body=sage&accent=brass&mat=matte&mono=1&text=JI');
  const clearances = await page.evaluate(async () => {
    const { PRODUCTS } = await import(new URL('src/products.js', location.href).href);
    const { group, decal } = PRODUCTS.find((p) => p.id === 'chair').build();
    group.updateMatrixWorld(true);
    const pos = decal.target.geometry.attributes.position;
    const posts = [];
    group.traverse((node) => {
      if (node.isMesh && node !== decal.target && node.geometry.parameters?.height === 1.8) posts.push(node);
    });
    const out = [];
    for (const post of posts) {
      const r = post.geometry.parameters.radiusTop;
      for (const dx of [-0.03, 0, 0.03]) {
        const x = post.position.x + dx;
        const postFront = post.position.z + Math.sqrt(r * r - dx * dx);
        let panelBack = Infinity;
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(pos.getX(i) - x) < 0.01) panelBack = Math.min(panelBack, pos.getZ(i));
        }
        out.push({ x: Number(x.toFixed(3)), postFront, panelBack, clearance: panelBack - postFront });
      }
    }
    return out;
  });
  assert.equal(clearances.length, 6);
  for (const c of clearances) assert.ok(c.clearance > 0.003, `post at x=${c.x} is behind the panel: ${JSON.stringify(c)}`);

  await page.evaluate(() => window.configurator.setState({ autoRotate: false }));
  await page.locator('#reset-view').click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, 'chair-mono.png') });

  await page.locator('input[name="material"][value="metal"]').check({ force: true });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, 'chair-metal-mono.png') });
  assert.deepEqual(errors, []);
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
  const desktop = await openApp(context, '#p=mug&body=navy&accent=brass&mat=gloss&mono=1&text=JI');
  const panelBox = await desktop.page.locator('#panel').boundingBox();
  assert.ok(panelBox.x > 800, 'panel sits to the right on desktop');
  assert.ok(!(await desktop.page.locator('.sheet-toggle').isVisible()));
  assert.equal(await desktop.page.locator('.stage-hint').textContent(), 'Drag to rotate, scroll to zoom');

  // Price and both actions are in view at 1280x800 before any scrolling.
  const inView = async (selector) => {
    const box = await desktop.page.locator(selector).boundingBox();
    return box !== null && box.y >= 0 && box.y + box.height <= 800;
  };
  for (const selector of ['#price-total', '#download', '#share']) {
    assert.ok(await inView(selector), `${selector} is above the fold`);
  }
  // All eight swatches of each group sit on one row.
  for (const name of ['body', 'accent']) {
    const rows = await desktop.page.locator(`input[name="${name}"] + .swatch-dot`).evaluateAll(
      (dots) => new Set(dots.map((dot) => Math.round(dot.getBoundingClientRect().top))).size,
    );
    assert.equal(rows, 1, `${name} swatches on one row`);
  }

  await desktop.page.locator('label[for="auto-rotate"]').click();
  assert.ok(!(await desktop.page.locator('#auto-rotate').isChecked()));
  await desktop.page.locator('#reset-view').click();
  await desktop.page.evaluate(() => document.getElementById('panel').scrollTo(0, 0));
  await desktop.page.waitForTimeout(100);
  await desktop.page.screenshot({ path: path.join(outDir, 'screenshot.png') });
  await desktop.page.emulateMedia({ colorScheme: 'dark' });
  await desktop.page.waitForTimeout(500); // let the 150 ms colour transitions finish
  await desktop.page.screenshot({ path: path.join(outDir, 'desktop-dark.png') });
  assert.deepEqual(desktop.errors, []);
  await context.close();

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await openApp(phoneContext, '#p=chair&body=sage&accent=bone&mat=matte', { width: 390, height: 844 });
  assert.ok(await phone.page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'phone context has a coarse pointer');
  assert.equal(await phone.page.locator('.stage-hint').textContent(), 'Drag to rotate, pinch to zoom');
  assert.match(await phone.page.locator('canvas#view').getAttribute('aria-label'), /pinch to zoom/);
  const toggle = phone.page.locator('.sheet-toggle');
  const cue = phone.page.locator('.sheet-cue');
  assert.ok(await toggle.isVisible());
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await cue.textContent(), 'Customize');
  await phone.page.screenshot({ path: path.join(outDir, 'screenshot-phone.png') });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await cue.textContent(), 'Close');
  await phone.page.waitForTimeout(400);
  await phone.page.screenshot({ path: path.join(outDir, 'screenshot-phone-open.png') });
  const width = await phone.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, `no horizontal overflow, scrollWidth ${width}`);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await cue.textContent(), 'Customize');
  assert.deepEqual(phone.errors, []);
  await phoneContext.close();
});
