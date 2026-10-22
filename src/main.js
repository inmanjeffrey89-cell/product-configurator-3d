import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { PRODUCTS, MATERIALS } from './products.js';
import { createPanel, initSheet, encodeHash, decodeHash, sanitizeMonogram } from './ui.js';

const pricing = await (await fetch(new URL('./pricing.json', import.meta.url))).json();

const stage = document.querySelector('.stage');
const canvas = document.getElementById('view');
const panelRoot = document.getElementById('panel-body');

const colorsById = new Map(pricing.colors.map((c) => [c.id, c]));
const presetsById = new Map(MATERIALS.map((m) => [m.id, m]));
const productsById = new Map(PRODUCTS.map((p) => [p.id, p]));

const state = {
  product: 'mug',
  body: 'navy',
  accent: 'clay',
  material: 'matte',
  monogram: false,
  text: 'JI',
  autoRotate: true,
  ...decodeHash(location.hash, { products: productsById, colors: colorsById, materials: presetsById }),
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch {
  stage.classList.add('is-failed');
  throw new Error('WebGL is not available');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const BASE_FOV = 32;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.5;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.52;
controls.autoRotateSpeed = 1.2;

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.camera.near = 1;
key.shadow.camera.far = 20;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-4, 3, -2);
scene.add(fill);

const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const materials = {
  body: new THREE.MeshPhysicalMaterial(),
  accent: new THREE.MeshPhysicalMaterial(),
};

let current = null;
let decal = null;
const listeners = new Set();

function applyFinish(material, hex) {
  const preset = presetsById.get(state.material);
  material.color.set(hex);
  material.roughness = preset.roughness;
  material.metalness = preset.metalness;
  material.clearcoat = preset.clearcoat;
  material.clearcoatRoughness = 0.15;
  material.envMapIntensity = preset.metalness ? 1.2 : 0.8;
  material.needsUpdate = true;
}

function contrastColor(hex) {
  const c = new THREE.Color(hex);
  const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luminance < 0.2 ? '#f7f3ea' : '#1c1b18';
}

function monogramTexture(text, color) {
  const size = 512;
  const sheet = document.createElement('canvas');
  sheet.width = size;
  sheet.height = size;
  const ctx = sheet.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 24, 0, Math.PI * 2);
  ctx.stroke();
  const fontSize = text.length > 2 ? 190 : 250;
  ctx.fillStyle = color;
  ctx.font = `600 ${fontSize}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + fontSize * 0.06);
  const texture = new THREE.CanvasTexture(sheet);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function removeDecal() {
  if (!decal) return;
  decal.removeFromParent();
  decal.geometry.dispose();
  decal.material.map.dispose();
  decal.material.dispose();
  decal = null;
}

function placeDecal() {
  removeDecal();
  const { target, position, orientation, size } = current.decal;
  current.group.updateMatrixWorld(true);
  const surfaceHex = colorsById.get(state[target.userData.part]).hex;
  decal = new THREE.Mesh(
    new DecalGeometry(target, position, orientation, size),
    new THREE.MeshStandardMaterial({
      map: monogramTexture(state.text, contrastColor(surfaceHex)),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 0.6,
    }),
  );
  decal.renderOrder = 1;
  current.group.add(decal);
}

function disposeProduct() {
  if (!current) return;
  removeDecal();
  current.group.removeFromParent();
  current.group.traverse((node) => node.geometry?.dispose());
  current = null;
}

function resetView() {
  const { position, target } = current.def.view;
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
}

function loadProduct() {
  disposeProduct();
  const def = productsById.get(state.product);
  current = { def, ...def.build() };
  current.group.traverse((node) => {
    if (node.isMesh && node.userData.part) node.material = materials[node.userData.part];
  });
  scene.add(current.group);
  resetView();
}

function update(patch = {}) {
  const prev = { ...state };
  Object.assign(state, patch);
  state.text = sanitizeMonogram(state.text);

  if (!current || state.product !== prev.product) loadProduct();
  applyFinish(materials.body, colorsById.get(state.body).hex);
  applyFinish(materials.accent, colorsById.get(state.accent).hex);

  const wantsDecal = state.monogram && state.text.length > 0;
  const decalChanged = ['product', 'body', 'accent', 'text'].some((k) => state[k] !== prev[k]);
  if (!wantsDecal) removeDecal();
  else if (!decal || decalChanged) placeDecal();

  controls.autoRotate = state.autoRotate;
  panel.update(state);
  history.replaceState(null, '', encodeHash(state));
  for (const listener of listeners) listener({ ...state });
}

async function snapshot() {
  const backdrop = getComputedStyle(document.documentElement).getPropertyValue('--stage-solid').trim();
  scene.background = new THREE.Color(backdrop);
  renderer.render(scene, camera);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  scene.background = null;
  return blob;
}

async function download() {
  const blob = await snapshot();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.product}-${state.body}-${state.accent}-${state.material}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  panel.setStatus('PNG saved');
}

async function share() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    panel.setStatus('Link copied to clipboard');
  } catch {
    panel.setStatus(`Copy this link: ${url}`);
  }
}

const panel = createPanel(panelRoot, {
  products: PRODUCTS,
  colors: pricing.colors,
  materials: MATERIALS,
  pricing,
  onChange: update,
  onDownload: download,
  onShare: share,
});
initSheet(document.getElementById('panel'), stage);
document.getElementById('reset-view').addEventListener('click', resetView);

function resize() {
  const { clientWidth: width, clientHeight: height } = stage;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = Math.min(60, BASE_FOV / Math.min(camera.aspect, 1) ** 0.75);
  camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(resize).observe(stage);

update();
renderer.render(scene, camera);
stage.classList.add('is-ready');
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

window.configurator = {
  getState: () => ({ ...state }),
  setState: (patch) => update(patch),
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot,
  stats: () => ({ ...renderer.info.render }),
};
