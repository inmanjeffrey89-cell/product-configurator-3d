import * as THREE from 'three';

export const MATERIALS = [
  { id: 'matte', name: 'Matte', roughness: 0.85, metalness: 0, clearcoat: 0 },
  { id: 'gloss', name: 'Gloss', roughness: 0.22, metalness: 0, clearcoat: 1 },
  { id: 'metal', name: 'Metal', roughness: 0.32, metalness: 1, clearcoat: 0 },
];

function part(geometry, role) {
  const mesh = new THREE.Mesh(geometry);
  mesh.userData.part = role;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function lathe(points, segments = 72) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

function roundedRect(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function buildMug() {
  const group = new THREE.Group();

  const shell = part(lathe([
    [0, 0], [0.4, 0], [0.47, 0.03], [0.5, 0.1], [0.5, 1.1], [0.5, 1.17], [0.47, 1.2], [0.42, 1.2],
  ]), 'body');
  const lining = part(lathe([[0.42, 1.2], [0.42, 0.16], [0.36, 0.1], [0, 0.1]]), 'body');

  const handle = part(new THREE.TorusGeometry(0.3, 0.055, 20, 48, Math.PI).rotateZ(-Math.PI / 2), 'accent');
  handle.position.set(0.48, 0.62, 0);

  const band = part(new THREE.CylinderGeometry(0.515, 0.515, 0.09, 72), 'accent');
  band.position.y = 1.0;

  group.add(shell, lining, handle, band);
  return {
    group,
    decal: {
      target: shell,
      position: new THREE.Vector3(0, 0.6, 0.5),
      orientation: new THREE.Euler(0, 0, 0),
      size: new THREE.Vector3(0.55, 0.55, 0.4),
    },
  };
}

function buildChair() {
  const group = new THREE.Group();

  const seat = part(
    new THREE.ExtrudeGeometry(roundedRect(0.98, 0.92, 0.14), {
      depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4, curveSegments: 24,
    }).rotateX(-Math.PI / 2).translate(0, 0.9, 0),
    'body',
  );

  const outer = 1.3;
  const inner = 1.25;
  const half = 0.37;
  const arc = new THREE.Shape();
  arc.absarc(0, 0, outer, Math.PI / 2 - half, Math.PI / 2 + half, false);
  arc.absarc(0, 0, inner, Math.PI / 2 + half, Math.PI / 2 - half, true);
  const back = part(
    new THREE.ExtrudeGeometry(arc, {
      depth: 0.5, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 48,
    }).rotateX(-Math.PI / 2).translate(0, 1.22, 0.85),
    'body',
  );

  const legGeometry = new THREE.CylinderGeometry(0.04, 0.03, 0.9, 20);
  const postGeometry = new THREE.CylinderGeometry(0.035, 0.03, 1.8, 20);
  const railAcross = new THREE.CylinderGeometry(0.018, 0.018, 0.8, 12).rotateZ(Math.PI / 2);
  const railAlong = new THREE.CylinderGeometry(0.018, 0.018, 0.72, 12).rotateX(Math.PI / 2);

  for (const x of [-0.4, 0.4]) {
    const leg = part(legGeometry, 'accent');
    leg.position.set(x, 0.45, 0.36);
    const post = part(postGeometry, 'accent');
    post.position.set(x, 0.9, -0.36);
    const side = part(railAlong, 'accent');
    side.position.set(x, 0.3, 0);
    group.add(leg, post, side);
  }
  for (const z of [-0.36, 0.36]) {
    const rail = part(railAcross, 'accent');
    rail.position.set(0, 0.3, z);
    group.add(rail);
  }

  group.add(seat, back);
  return {
    group,
    decal: {
      target: back,
      position: new THREE.Vector3(0, 1.47, -0.4),
      orientation: new THREE.Euler(0, 0, 0),
      size: new THREE.Vector3(0.34, 0.34, 0.07),
    },
  };
}

function buildBackpack() {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.ExtrudeGeometry(roundedRect(0.9, 1.25, 0.2), {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 8, curveSegments: 32,
  });
  bodyGeometry.center();
  bodyGeometry.translate(0, 0.705, 0);
  const body = part(bodyGeometry, 'body');

  const pocketGeometry = new THREE.ExtrudeGeometry(roundedRect(0.58, 0.42, 0.12), {
    depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 6, curveSegments: 24,
  });
  pocketGeometry.center();
  const pocket = part(pocketGeometry, 'accent');
  pocket.position.set(0, 0.38, 0.3);

  const handle = part(new THREE.TorusGeometry(0.13, 0.03, 12, 32, Math.PI), 'accent');
  handle.position.set(0, 1.39, 0);

  group.add(body, pocket, handle);

  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.2, 1.3, -0.12),
      new THREE.Vector3(side * 0.3, 1.0, -0.4),
      new THREE.Vector3(side * 0.33, 0.6, -0.46),
      new THREE.Vector3(side * 0.3, 0.25, -0.38),
      new THREE.Vector3(side * 0.22, 0.12, -0.16),
    ]);
    group.add(part(new THREE.TubeGeometry(curve, 48, 0.045, 12, false), 'accent'));
  }

  return {
    group,
    decal: {
      target: pocket,
      position: new THREE.Vector3(0, 0.38, 0.4),
      orientation: new THREE.Euler(0, 0, 0),
      size: new THREE.Vector3(0.26, 0.26, 0.1),
    },
  };
}

export const PRODUCTS = [
  {
    id: 'mug',
    name: 'Mug',
    blurb: 'Stoneware, 12 oz, with a contrast handle and band.',
    build: buildMug,
    view: { position: [-1.7, 1.5, 3.4], target: [0, 0.55, 0] },
  },
  {
    id: 'chair',
    name: 'Chair',
    blurb: 'Dining chair with a bent back and turned legs.',
    build: buildChair,
    view: { position: [-2.2, 2.0, 3.8], target: [0, 0.85, 0] },
  },
  {
    id: 'backpack',
    name: 'Backpack',
    blurb: 'Daypack, 18 L, front pocket and padded straps.',
    build: buildBackpack,
    view: { position: [-1.6, 1.6, 3.4], target: [0, 0.7, 0] },
  },
];
