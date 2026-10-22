export function sanitizeMonogram(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export function computePrice(pricing, products, state) {
  const product = pricing.products[state.product];
  const productName = products.find((p) => p.id === state.product).name;
  const colorsById = Object.fromEntries(pricing.colors.map((c) => [c.id, c]));
  const lines = [{ label: productName, amount: product.base }];

  const finish = product.material[state.material];
  if (finish) lines.push({ label: `${capitalize(state.material)} finish`, amount: finish });

  for (const role of ['body', 'accent']) {
    const color = colorsById[state[role]];
    if (color && color.extra) lines.push({ label: `${color.name} ${role}`, amount: color.extra });
  }

  if (state.monogram && state.text) lines.push({ label: 'Monogram', amount: pricing.monogram });

  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) };
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function encodeHash(state) {
  const params = new URLSearchParams();
  params.set('p', state.product);
  params.set('body', state.body);
  params.set('accent', state.accent);
  params.set('mat', state.material);
  // Same rule as computePrice and the decal: a monogram with no initials is
  // not a monogram, so it is not shared as one.
  if (state.monogram && state.text) {
    params.set('mono', '1');
    params.set('text', state.text);
  }
  return `#${params.toString()}`;
}

export function decodeHash(hash, valid) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const patch = {};
  const product = params.get('p');
  const body = params.get('body');
  const accent = params.get('accent');
  const material = params.get('mat');
  if (valid.products.has(product)) patch.product = product;
  if (valid.colors.has(body)) patch.body = body;
  if (valid.colors.has(accent)) patch.accent = accent;
  if (valid.materials.has(material)) patch.material = material;
  if (params.has('mono')) {
    patch.monogram = params.get('mono') === '1';
    // An empty string is a valid restored value; it must not fall back to the
    // default initials.
    patch.text = sanitizeMonogram(params.get('text'));
  }
  return patch;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function radioGroup({ name, legend, options, kind, onPick }) {
  const valueEl = el('span', { class: 'legend-value' });
  const legendEl = el('legend', {}, [el('span', { text: legend }), valueEl]);
  const fieldset = el('fieldset', { class: 'group' }, [legendEl]);
  const list = el('div', { class: kind === 'swatch' ? 'swatches' : 'seg' });

  for (const option of options) {
    const input = el('input', { type: 'radio', name, value: option.value, class: 'sr-only' });
    input.addEventListener('change', () => onPick(option.value));
    const children = [input];
    if (kind === 'swatch') {
      children.push(
        el('span', { class: 'swatch-dot', style: `--c:${option.hex}`, 'aria-hidden': 'true' }),
        el('span', { class: 'sr-only', text: option.label }),
      );
    } else {
      children.push(el('span', { class: 'seg-face', text: option.label }));
    }
    list.append(el('label', { class: kind === 'swatch' ? 'swatch' : 'seg-item', title: option.label }, children));
  }

  fieldset.append(list);
  return {
    fieldset,
    set(value) {
      for (const input of fieldset.querySelectorAll('input')) input.checked = input.value === value;
      if (kind === 'swatch') valueEl.textContent = options.find((o) => o.value === value)?.label ?? '';
    },
  };
}

function toggle({ id, label }) {
  const input = el('input', { type: 'checkbox', id, class: 'sr-only' });
  const node = el('label', { class: 'switch', for: id }, [
    input,
    el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    el('span', { class: 'switch-label', text: label }),
  ]);
  return { node, input };
}

export function createPanel(root, { products, colors, materials, pricing, onChange, onDownload, onShare }) {
  const nameEl = el('h1', { class: 'product-name', id: 'product-name' });
  const blurbEl = el('p', { class: 'product-blurb' });

  const productGroup = radioGroup({
    name: 'product',
    legend: 'Product',
    kind: 'seg',
    options: products.map((p) => ({ value: p.id, label: p.name })),
    onPick: (product) => onChange({ product }),
  });
  const bodyGroup = radioGroup({
    name: 'body',
    legend: 'Body color',
    kind: 'swatch',
    options: colors.map((c) => ({ value: c.id, label: c.name, hex: c.hex })),
    onPick: (body) => onChange({ body }),
  });
  const accentGroup = radioGroup({
    name: 'accent',
    legend: 'Accent color',
    kind: 'swatch',
    options: colors.map((c) => ({ value: c.id, label: c.name, hex: c.hex })),
    onPick: (accent) => onChange({ accent }),
  });
  const materialGroup = radioGroup({
    name: 'material',
    legend: 'Finish',
    kind: 'seg',
    options: materials.map((m) => ({ value: m.id, label: m.name })),
    onPick: (material) => onChange({ material }),
  });

  const monogram = toggle({ id: 'monogram', label: 'Add monogram' });
  monogram.input.addEventListener('change', () => onChange({ monogram: monogram.input.checked }));
  const monogramText = el('input', {
    type: 'text', id: 'monogram-text', class: 'text-input', maxlength: '3',
    autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'monogram-help',
  });
  monogramText.addEventListener('input', () => onChange({ text: monogramText.value }));
  const monogramGroup = el('fieldset', { class: 'group' }, [
    el('legend', {}, [el('span', { text: 'Monogram' })]),
    monogram.node,
    el('div', { class: 'field' }, [
      el('label', { for: 'monogram-text', text: 'Initials' }),
      monogramText,
      el('p', { id: 'monogram-help', class: 'help', text: 'Up to 3 letters or numbers.' }),
    ]),
  ]);

  const autoRotate = toggle({ id: 'auto-rotate', label: 'Auto-rotate' });
  autoRotate.input.addEventListener('change', () => onChange({ autoRotate: autoRotate.input.checked }));
  const viewGroup = el('fieldset', { class: 'group' }, [
    el('legend', {}, [el('span', { text: 'View' })]),
    autoRotate.node,
  ]);

  const priceLines = el('dl', { class: 'price-lines' });
  const priceTotal = el('output', { id: 'price-total', class: 'price-amount' });
  const priceBlock = el('section', { class: 'price', 'aria-label': 'Price' }, [
    priceLines,
    el('div', { class: 'price-total' }, [el('span', { text: 'Total' }), priceTotal]),
  ]);

  const downloadButton = el('button', { type: 'button', id: 'download', class: 'btn btn-primary', text: 'Download PNG' });
  downloadButton.addEventListener('click', onDownload);
  const shareButton = el('button', { type: 'button', id: 'share', class: 'btn', text: 'Copy share link' });
  shareButton.addEventListener('click', onShare);
  const status = el('p', { class: 'status', id: 'status', role: 'status', 'aria-live': 'polite' });

  root.append(
    el('div', { class: 'panel-head' }, [nameEl, blurbEl]),
    productGroup.fieldset,
    bodyGroup.fieldset,
    accentGroup.fieldset,
    materialGroup.fieldset,
    monogramGroup,
    viewGroup,
    el('div', { class: 'panel-foot' }, [
      priceBlock,
      el('div', { class: 'actions' }, [downloadButton, shareButton]),
      status,
    ]),
  );

  const sheetTitle = document.getElementById('sheet-title');
  const sheetPrice = document.getElementById('sheet-price');
  let statusTimer = 0;

  return {
    update(state) {
      const product = products.find((p) => p.id === state.product);
      nameEl.textContent = product.name;
      blurbEl.textContent = product.blurb;
      productGroup.set(state.product);
      bodyGroup.set(state.body);
      accentGroup.set(state.accent);
      materialGroup.set(state.material);
      monogram.input.checked = state.monogram;
      monogramText.disabled = !state.monogram;
      if (monogramText.value !== state.text) monogramText.value = state.text;
      autoRotate.input.checked = state.autoRotate;

      const price = computePrice(pricing, products, state);
      priceLines.replaceChildren(...price.lines.map((line, i) => el('div', { class: 'price-line' }, [
        el('dt', { text: line.label }),
        el('dd', { text: (i === 0 ? '' : '+ ') + formatMoney(line.amount, pricing.currency) }),
      ])));
      const total = formatMoney(price.total, pricing.currency);
      priceTotal.textContent = total;
      sheetTitle.textContent = product.name;
      sheetPrice.textContent = total;
    },
    // A plain message clears itself after 4 s. With `sticky` it stays until the
    // next status. With `link` the URL is shown in a readonly field, selected
    // and ready to copy, and it also stays.
    setStatus(message, { sticky = false, link = '' } = {}) {
      clearTimeout(statusTimer);
      status.replaceChildren(message);
      if (link) {
        const field = el('input', {
          type: 'text', class: 'status-link', readonly: '', value: link, 'aria-label': 'Share link',
        });
        field.addEventListener('focus', () => field.select());
        status.append(field);
        field.focus();
        field.select();
      }
      if (!sticky && !link) statusTimer = setTimeout(() => { status.textContent = ''; }, 4000);
    },
  };
}

export function initSheet(panel, stage) {
  const button = panel.querySelector('.sheet-toggle');
  const cue = panel.querySelector('.sheet-cue');
  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    cue.textContent = open ? 'Close' : 'Customize';
  };
  button.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  stage.addEventListener('pointerdown', () => setOpen(false));
  setOpen(false);
}
