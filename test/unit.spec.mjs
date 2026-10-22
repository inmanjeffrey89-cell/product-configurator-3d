// Pure helpers from src/ui.js. No browser, runs in milliseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeMonogram, encodeHash, decodeHash, computePrice } from '../src/ui.js';

const pricing = JSON.parse(await readFile(new URL('../src/pricing.json', import.meta.url), 'utf8'));
const products = [
  { id: 'mug', name: 'Mug' },
  { id: 'chair', name: 'Chair' },
  { id: 'backpack', name: 'Backpack' },
];
const materials = ['matte', 'gloss', 'metal'];
const valid = {
  products: new Set(products.map((p) => p.id)),
  colors: new Set(pricing.colors.map((c) => c.id)),
  materials: new Set(materials),
};
const base = { product: 'mug', body: 'navy', accent: 'clay', material: 'matte', monogram: false, text: 'JI', autoRotate: true };
const extra = (id) => pricing.colors.find((c) => c.id === id).extra;
const hasMonogramLine = (price) => price.lines.some((line) => line.label === 'Monogram');

test('sanitizeMonogram keeps up to three letters or digits, upper-cased', () => {
  assert.equal(sanitizeMonogram('ab'), 'AB');
  assert.equal(sanitizeMonogram('a-b-c-d'), 'ABC');
  assert.equal(sanitizeMonogram(' j i '), 'JI');
  assert.equal(sanitizeMonogram('42x'), '42X');
  assert.equal(sanitizeMonogram(''), '');
  assert.equal(sanitizeMonogram(null), '');
  assert.equal(sanitizeMonogram(undefined), '');
});

test('encode then decode gives back every field', () => {
  for (const text of ['JI', 'ABC', 'A', '7']) {
    const state = { ...base, product: 'chair', body: 'brass', accent: 'oxblood', material: 'gloss', monogram: true, text };
    assert.deepEqual(decodeHash(encodeHash(state), valid), {
      product: 'chair', body: 'brass', accent: 'oxblood', material: 'gloss', monogram: true, text,
    });
  }
  const plain = { ...base, product: 'backpack', body: 'sage', accent: 'sand', material: 'metal' };
  assert.deepEqual(decodeHash(encodeHash(plain), valid), { product: 'backpack', body: 'sage', accent: 'sand', material: 'metal' });
});

test('monogram on with no initials is not shared as a monogram', () => {
  const state = { ...base, monogram: true, text: '' };
  const hash = encodeHash(state);
  assert.equal(hash, '#p=mug&body=navy&accent=clay&mat=matte');
  const patch = decodeHash(hash, valid);
  assert.ok(!('monogram' in patch), 'no monogram flag in the patch');
  assert.ok(!('text' in patch), 'no text in the patch');
  const restored = { ...base, ...patch };
  const sender = computePrice(pricing, products, state);
  const recipient = computePrice(pricing, products, restored);
  assert.equal(recipient.total, sender.total);
  assert.equal(hasMonogramLine(sender), false);
  assert.equal(hasMonogramLine(recipient), false);
});

test('a hash with mono=1 and empty text restores empty initials, not the default', () => {
  const patch = decodeHash('#p=mug&mono=1&text=', valid);
  assert.deepEqual(patch, { product: 'mug', monogram: true, text: '' });
  const restored = { ...base, ...patch };
  assert.equal(hasMonogramLine(computePrice(pricing, products, restored)), false);
  assert.equal(computePrice(pricing, products, restored).total, pricing.products.mug.base);
});

test('monogram off is left out of the hash and mono=0 decodes as off', () => {
  assert.equal(encodeHash({ ...base, monogram: false, text: 'JI' }), '#p=mug&body=navy&accent=clay&mat=matte');
  assert.deepEqual(decodeHash('#mono=0&text=zz', valid), { monogram: false, text: 'ZZ' });
});

test('unknown ids are ignored and text is sanitized on the way in', () => {
  assert.deepEqual(decodeHash('#p=lamp&body=pink&accent=navy&mat=velvet', valid), { accent: 'navy' });
  assert.deepEqual(decodeHash('', valid), {});
  assert.deepEqual(decodeHash('#junk=1', valid), {});
  assert.deepEqual(decodeHash('#mono=1&text=hello%20world', valid), { monogram: true, text: 'HEL' });
  assert.deepEqual(decodeHash('p=mug', valid), { product: 'mug' });
});

test('computePrice totals match the pricing table', () => {
  for (const product of Object.keys(pricing.products)) {
    for (const material of materials) {
      for (const monogram of [false, true]) {
        const state = { ...base, product, material, accent: 'brass', monogram, text: 'JI' };
        const price = computePrice(pricing, products, state);
        const row = pricing.products[product];
        const expected = row.base + row.material[material] + extra('navy') + extra('brass') + (monogram ? pricing.monogram : 0);
        assert.equal(price.total, expected, `${product} ${material} monogram=${monogram}`);
        assert.equal(price.lines[0].label, products.find((p) => p.id === product).name);
        assert.equal(price.lines[0].amount, row.base);
        assert.equal(hasMonogramLine(price), monogram);
        assert.equal(price.lines.some((line) => line.label === 'Brass accent'), true);
      }
    }
  }
});

test('computePrice lines follow the render rules', () => {
  const matte = computePrice(pricing, products, base);
  assert.equal(matte.lines.some((line) => line.label.endsWith('finish')), false, 'matte adds no finish line');
  const gloss = computePrice(pricing, products, { ...base, material: 'gloss' });
  assert.deepEqual(gloss.lines[1], { label: 'Gloss finish', amount: pricing.products.mug.material.gloss });
  const empty = computePrice(pricing, products, { ...base, monogram: true, text: '' });
  assert.equal(hasMonogramLine(empty), false, 'monogram on with no initials costs nothing');
  const both = computePrice(pricing, products, { ...base, body: 'oxblood', accent: 'brass' });
  assert.equal(both.total, pricing.products.mug.base + extra('oxblood') + extra('brass'));
});
