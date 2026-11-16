// Little procedural models for the secrets. Everything is built from primitives here:
// no imported meshes or textures. Each builder returns a group roughly 1.5-2.5 m across,
// centred on its origin.
import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o });
const glow = (color, k = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const gold = () => mat(0xf2c14e, { metalness: 0.9, roughness: 0.25 });
const chrome = () => mat(0xdfe6ee, { metalness: 1, roughness: 0.12 });

function add(g, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  g.add(m);
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cyl = (a, b, h, n = 14) => new THREE.CylinderGeometry(a, b, h, n);
const cone = (r, h, n = 14) => new THREE.ConeGeometry(r, h, n);
const tor = (r, t, n = 24) => new THREE.TorusGeometry(r, t, 8, n);

function flag(g, color, emblem) {
  add(g, cyl(0.035, 0.035, 2.2, 6), chrome(), 0, 0, 0);
  const cloth = new THREE.PlaneGeometry(1.1, 0.7, 8, 1);
  const p = cloth.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 5) * 0.07);
  cloth.computeVertexNormals();
  add(g, cloth, mat(color, { side: THREE.DoubleSide }), 0.57, 0.72, 0);
  add(g, new THREE.CircleGeometry(0.16, 16), mat(emblem, { side: THREE.DoubleSide }), 0.57, 0.72, 0.08);
  add(g, sph(0.07), gold(), 0, 1.13, 0);
}

const BUILD = {
  bottle(g) {
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fd6c0, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1 });
    add(g, cyl(0.34, 0.34, 1.0, 16), glass, 0, -0.1, 0);
    add(g, sph(0.34, 16, 8), glass, 0, 0.4, 0, 0, 0, 0, 1, 0.6, 1);
    add(g, cyl(0.12, 0.14, 0.5, 12), glass, 0, 0.8, 0);
    add(g, cyl(0.13, 0.11, 0.16, 10), mat(0xa9713c), 0, 1.1, 0);
    add(g, cyl(0.14, 0.14, 0.7, 10), mat(0xf4ecd4), 0, -0.1, 0, 0, 0, 0.5);
    g.rotation.z = 0.5;
  },
  gull(g) {
    const m = gold();
    add(g, sph(0.34), m, 0, 0, 0, 0, 0, 0, 1, 0.8, 2.1);
    add(g, sph(0.2), m, 0, 0.16, 0.72);
    add(g, cone(0.08, 0.3, 8), mat(0xff8a2a), 0, 0.14, 1.0, Math.PI / 2);
    for (const s of [-1, 1]) {
      add(g, box(1.3, 0.05, 0.5), m, s * 0.75, 0.22, 0, 0, 0, s * 0.35);
      add(g, box(0.8, 0.04, 0.34), m, s * 1.65, 0.36, -0.05, 0, 0, -s * 0.2);
    }
    add(g, box(0.3, 0.04, 0.5), m, 0, 0.05, -0.85);
    add(g, cyl(0.03, 0.03, 1.2, 6), mat(0x30343c, { metalness: 0.8 }), 0, -0.7, 0);
  },
  buoy(g) {
    add(g, cyl(0.75, 0.55, 0.55, 18), mat(0xd9342b), 0, -0.5, 0);
    add(g, cyl(0.5, 0.75, 0.25, 18), mat(0xf2f2f2), 0, -0.1, 0);
    for (let i = 0; i < 3; i++) add(g, cyl(0.03, 0.03, 1.3, 6), mat(0xd9342b), Math.cos(i * 2.094) * 0.3, 0.6, Math.sin(i * 2.094) * 0.3, 0, 0, 0);
    add(g, cyl(0.36, 0.36, 0.08, 14), mat(0xd9342b), 0, 1.25, 0);
    add(g, sph(0.16), glow(0xfff0a0, 3), 0, 1.45, 0);
  },
  hubcap(g) {
    const c = chrome();
    add(g, cyl(0.85, 0.85, 0.08, 28), c, 0, 0, 0, Math.PI / 2);
    add(g, tor(0.8, 0.07), c);
    for (let i = 0; i < 5; i++) add(g, box(0.16, 0.62, 0.1), mat(0x2a2e36, { metalness: 0.7 }), Math.sin(i * 1.2566) * 0.42, Math.cos(i * 1.2566) * 0.42, 0.04, 0, 0, -i * 1.2566);
    add(g, cyl(0.16, 0.16, 0.16, 14), glow(0xff3344, 0.8), 0, 0, 0.05, Math.PI / 2);
    g.userData.spin = 3;
  },
  cactus(g) {
    const c = mat(0x3f9a4c, { roughness: 0.8 });
    add(g, cyl(0.3, 0.33, 1.9, 12), c, 0, 0, 0);
    add(g, sph(0.3, 12, 8), c, 0, 0.95, 0);
    for (const s of [-1, 1]) {
      add(g, cyl(0.16, 0.16, 0.55, 10), c, s * 0.5, 0.05 + s * 0.12, 0, 0, 0, Math.PI / 2);
      add(g, cyl(0.16, 0.16, 0.7, 10), c, s * 0.76, 0.4 + s * 0.12, 0);
      add(g, sph(0.16, 10, 6), c, s * 0.76, 0.75 + s * 0.12, 0);
    }
    const dark = mat(0x101216, { metalness: 0.6, roughness: 0.2 });
    for (const s of [-1, 1]) add(g, cyl(0.14, 0.14, 0.04, 14), dark, s * 0.15, 0.6, 0.29, Math.PI / 2);
    add(g, box(0.2, 0.03, 0.03), dark, 0, 0.62, 0.3);
    add(g, cyl(0.42, 0.34, 0.4, 12), mat(0xb8643a), 0, -1.1, 0);
  },
  marker(g) {
    add(g, box(0.5, 1.9, 0.26), mat(0xf4f1e8, { roughness: 0.9 }), 0, 0, 0);
    add(g, cyl(0.25, 0.25, 0.26, 16, 1, false, 0, Math.PI), mat(0xf4f1e8, { roughness: 0.9 }), 0, 0.95, 0, Math.PI / 2, 0, Math.PI / 2);
    add(g, box(0.52, 0.34, 0.28), mat(0x1c1f25), 0, 0.5, 0);
    add(g, tor(0.1, 0.035, 16), gold(), 0, 0.5, 0.15);
    add(g, tor(1.1, 0.03, 40), glow(0xffd76a, 1), 0, 0, 0, Math.PI / 2);
  },
  kite(g) {
    const paper = (c) => mat(c, { side: THREE.DoubleSide, roughness: 0.9 });
    const dia = new THREE.BufferGeometry();
    dia.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.1, 0, -0.75, 0.2, 0.12, 0, 0.2, 0, 0, 1.1, 0, 0, 0.2, 0, 0.75, 0.2, 0.12, -0.75, 0.2, 0.12, 0, -1.1, 0, 0, 0.2, 0, 0, 0.2, 0, 0, -1.1, 0, 0.75, 0.2, 0.12], 3));
    dia.computeVertexNormals();
    const m = new THREE.Mesh(dia, [paper(0xff5a5f)]);
    dia.addGroup(0, 6, 0); dia.addGroup(6, 6, 0);
    g.add(m);
    add(g, box(0.03, 2.2, 0.03), mat(0x6b4a2b), 0, 0, 0.02);
    add(g, box(1.5, 0.03, 0.03), mat(0x6b4a2b), 0, 0.2, 0.08);
    for (let i = 0; i < 4; i++) add(g, box(0.26, 0.1, 0.02), paper([0xffc94d, 0x4db8ff, 0x7dff9a, 0xff8ad1][i]), Math.sin(i * 1.3) * 0.2, -1.4 - i * 0.36, 0, 0, 0, i % 2 ? 0.5 : -0.5);
    g.userData.sway = 0.35;
  },
  chime(g) {
    add(g, cyl(0.5, 0.5, 0.06, 18), mat(0x7a5232), 0, 0.8, 0);
    add(g, tor(0.1, 0.02, 12), chrome(), 0, 0.95, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.2566, len = 0.7 + i * 0.16;
      add(g, cyl(0.045, 0.045, len, 8), chrome(), Math.cos(a) * 0.36, 0.7 - len / 2, Math.sin(a) * 0.36);
    }
    add(g, cyl(0.16, 0.16, 0.03, 14), gold(), 0, -0.1, 0);
    add(g, box(0.2, 0.34, 0.01), mat(0xf4ecd4, { side: THREE.DoubleSide }), 0, -0.7, 0);
    g.userData.sway = 0.2;
  },
  lantern(g) {
    add(g, cyl(0.5, 0.36, 1.2, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xff9a3c, emissiveIntensity: 1.3, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }), 0, 0, 0);
    add(g, cyl(0.52, 0.52, 0.06, 12), mat(0x7a2f1c), 0, 0.62, 0);
    add(g, cyl(0.38, 0.38, 0.06, 12), mat(0x7a2f1c), 0, -0.62, 0);
    add(g, sph(0.14), glow(0xfff2c0, 4), 0, -0.3, 0);
    g.userData.bob = 0.5;
  },
  cat(g) {
    const n = glow(0xff4fd8, 2.2), t = 0.045;
    add(g, tor(0.55, t, 28), n, 0, 0, 0);
    for (const s of [-1, 1]) {
      add(g, cyl(t, t, 0.5, 6), n, s * 0.5, 0.62, 0, 0, 0, s * 0.35);
      add(g, cyl(t, t, 0.5, 6), n, s * 0.26, 0.66, 0, 0, 0, -s * 0.65);
      add(g, sph(0.08), glow(0x7dfff0, 3), s * 0.2, 0.1, 0);
      for (const k of [-1, 1]) add(g, cyl(0.02, 0.02, 0.5, 5), glow(0x7dfff0, 2), s * 0.62, -0.12 + k * 0.07, 0, 0, 0, Math.PI / 2 + s * k * 0.2);
    }
    add(g, cone(0.07, 0.1, 3), n, 0, -0.08, 0, Math.PI);
    add(g, tor(0.4, t, 20, Math.PI), n, 0.75, -0.75, 0, 0, 0, -1.2);
    add(g, box(1.9, 1.9, 0.06), mat(0x15171d, { roughness: 0.9 }), 0.1, 0, -0.1);
  },
  cones(g) {
    for (let i = 0; i < 5; i++) {
      const y = -0.9 + i * 0.36;
      add(g, cone(0.3, 0.8, 14), mat(0xff6a1a, { roughness: 0.7 }), 0, y + 0.4, 0);
      add(g, cyl(0.2, 0.235, 0.12, 14), mat(0xf4f4f4), 0, y + 0.36, 0);
      add(g, box(0.7, 0.05, 0.7), mat(0xff6a1a, { roughness: 0.7 }), 0, y, 0, 0, i * 0.5, 0);
    }
    add(g, tor(0.2, 0.04, 16), gold(), 0, 1.35, 0, Math.PI / 2);
  },
  disco(g) {
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 2), new THREE.MeshStandardMaterial({ color: 0xe8eef8, metalness: 1, roughness: 0.08, flatShading: true }));
    g.add(ball);
    add(g, cyl(0.02, 0.02, 0.9, 5), mat(0x30343c), 0, 1.3, 0);
    for (let i = 0; i < 6; i++) add(g, sph(0.05, 6, 4), glow([0xff4d6d, 0x4db8ff, 0xffc94d][i % 3], 3), Math.cos(i * 1.047) * 0.87, Math.sin(i * 2.3) * 0.3, Math.sin(i * 1.047) * 0.87);
    g.userData.spin = 0.8; g.userData.spinAxis = 'y';
  },
  snowman(g) {
    const snow = mat(0xf7fbff, { roughness: 0.95 });
    add(g, sph(0.62), snow, 0, -0.75, 0);
    add(g, sph(0.46), snow, 0, 0.05, 0);
    add(g, sph(0.33), snow, 0, 0.66, 0);
    add(g, cone(0.06, 0.34, 8), mat(0xff8a2a), 0, 0.66, 0.44, Math.PI / 2);
    add(g, tor(0.36, 0.08, 16), mat(0xd9342b), 0, 0.38, 0, Math.PI / 2);
    add(g, box(0.14, 0.5, 0.06), mat(0xd9342b), 0.22, 0.1, 0.36);
    const lens = mat(0x20242c, { metalness: 0.8, roughness: 0.15 });
    for (const s of [-1, 1]) add(g, cyl(0.1, 0.1, 0.06, 12), lens, s * 0.13, 0.76, 0.29, Math.PI / 2);
    add(g, tor(0.33, 0.03, 16), mat(0x5a3a22), 0, 0.76, 0, Math.PI / 2);
    for (const s of [-1, 1]) add(g, box(0.9, 0.04, 0.3), mat(0x8b93a0, { metalness: 0.6 }), s * 0.8, 0.05, 0, 0, 0, s * 0.15);
  },
  bell(g) {
    add(g, cyl(0.3, 0.7, 0.95, 4), gold(), 0, 0, 0, 0, Math.PI / 4);
    add(g, box(1.0, 0.1, 1.0), gold(), 0, -0.5, 0, 0, Math.PI / 4);
    add(g, sph(0.13), mat(0x3a3d44, { metalness: 0.9 }), 0, -0.55, 0);
    add(g, box(0.7, 0.16, 0.06), mat(0x7a3f22), 0, 0.62, 0);
    add(g, tor(0.36, 0.05, 16, Math.PI), mat(0x7a3f22), 0, 0.62, 0);
    g.userData.sway = 0.4;
  },
  ski(g) {
    const m = mat(0x2b6fd6, { roughness: 0.35 });
    add(g, box(0.2, 0.04, 2.4), m, 0, 0, 0);
    add(g, box(0.2, 0.04, 0.4), m, 0, 0.09, 1.36, -0.5);
    add(g, box(0.21, 0.045, 0.3), mat(0xffc94d), 0, 0, 0.5);
    add(g, box(0.16, 0.12, 0.34), mat(0x20242c), 0, 0.08, -0.1);
    g.rotation.set(0.5, 0, 0.3);
    g.userData.spin = 0.6; g.userData.spinAxis = 'y';
  },
  oillamp(g) {
    const iron = mat(0x2b2d33, { metalness: 0.8, roughness: 0.4 });
    add(g, cyl(0.36, 0.42, 0.24, 12), iron, 0, -0.55, 0);
    add(g, cyl(0.3, 0.3, 0.75, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide }), 0, -0.05, 0);
    add(g, sph(0.13), glow(0xffa53c, 4), 0, -0.2, 0, 0, 0, 0, 1, 1.5, 1);
    add(g, cone(0.4, 0.3, 12), iron, 0, 0.48, 0);
    add(g, tor(0.42, 0.025, 20, Math.PI), iron, 0, 0.5, 0);
    for (let i = 0; i < 4; i++) add(g, cyl(0.015, 0.015, 0.78, 4), iron, Math.cos(i * 1.57) * 0.31, -0.05, Math.sin(i * 1.57) * 0.31);
    g.userData.sway = 0.25;
  },
  pickaxe(g) {
    add(g, cyl(0.05, 0.06, 2.0, 8), mat(0x8a5a2e), 0, 0, 0);
    const head = gold();
    for (const s of [-1, 1]) add(g, cone(0.11, 0.95, 6), head, s * 0.47, 0.92 - 0.08, 0, 0, 0, -s * (Math.PI / 2 - 0.25));
    add(g, box(0.24, 0.2, 0.16), head, 0, 0.95, 0);
    g.rotation.z = 0.6;
    g.userData.spin = 0.7; g.userData.spinAxis = 'y';
  },
  tumbleweed(g) {
    const twig = mat(0xb08a4e, { roughness: 1 });
    for (let i = 0; i < 9; i++) add(g, tor(0.75 - (i % 3) * 0.08, 0.022, 22), twig, 0, 0, 0, i * 0.7, i * 1.1, i * 0.4);
    for (let i = 0; i < 5; i++) add(g, cone(0.09, 0.3, 4), gold(), Math.cos(i * 1.2566) * 0.3, 0.95, Math.sin(i * 1.2566) * 0.3);
    add(g, tor(0.3, 0.05, 14), gold(), 0, 0.8, 0, Math.PI / 2);
    g.userData.spin = 0.9; g.userData.spinAxis = 'x';
  },
  satellite(g) {
    add(g, box(0.6, 0.6, 0.8), mat(0xd8c070, { metalness: 0.8, roughness: 0.35 }), 0, 0, 0);
    const panel = mat(0x1d3f8f, { metalness: 0.5, roughness: 0.25 });
    for (const s of [-1, 1]) { add(g, box(1.3, 0.03, 0.6), panel, s * 1.05, 0, 0); add(g, cyl(0.02, 0.02, 0.3, 5), chrome(), s * 0.4, 0, 0, 0, 0, Math.PI / 2); }
    add(g, cone(0.36, 0.22, 16, 1, true), mat(0xf2f2f2, { side: THREE.DoubleSide }), 0, 0.48, 0.1, Math.PI);
    add(g, cyl(0.012, 0.012, 0.7, 4), chrome(), 0.2, 0.5, -0.3);
    add(g, sph(0.05), glow(0xff3344, 4), 0.2, 0.86, -0.3);
    g.userData.spin = 0.4; g.userData.spinAxis = 'y';
  },
  duck(g) {
    const y = mat(0xffd21f, { roughness: 0.35 });
    add(g, sph(0.6), y, 0, -0.2, 0, 0, 0, 0, 1, 0.8, 1.25);
    add(g, sph(0.38), y, 0, 0.45, 0.4);
    add(g, cone(0.2, 0.3, 4), y, 0, 0.0, -0.75, -1.9);
    add(g, box(0.3, 0.07, 0.3), mat(0xff7a1a), 0, 0.4, 0.82);
    for (const s of [-1, 1]) add(g, sph(0.05), mat(0x111111), s * 0.17, 0.56, 0.7);
    add(g, sph(0.52), new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.28, roughness: 0.02, metalness: 0.2 }), 0, 0.47, 0.42);
    add(g, tor(0.4, 0.05, 20), chrome(), 0, 0.14, 0.34, Math.PI / 2 - 0.25);
    g.userData.bob = 0.4;
  },
  nosecone(g) {
    add(g, cone(0.6, 1.5, 24), mat(0xf4f4f4, { roughness: 0.3 }), 0, 0.2, 0);
    add(g, cyl(0.6, 0.6, 0.3, 24), mat(0xd9342b, { roughness: 0.35 }), 0, -0.7, 0);
    add(g, cyl(0.61, 0.61, 0.06, 24), mat(0x20242c), 0, -0.52, 0);
    add(g, sph(0.06), glow(0x4db8ff, 3), 0, 0.97, 0);
    g.rotation.z = 0.35;
    g.userData.spin = 0.5; g.userData.spinAxis = 'y';
  },
  rover(g) {
    add(g, box(1.1, 0.25, 0.75), mat(0xe8e2d4, { roughness: 0.6 }), 0, 0, 0);
    add(g, box(1.0, 0.03, 0.9), mat(0x1d3f8f, { metalness: 0.5, roughness: 0.25 }), 0, 0.16, 0);
    const tyre = mat(0x2a2c31, { roughness: 0.9 });
    for (const x of [-0.5, 0, 0.5]) for (const s of [-1, 1]) add(g, cyl(0.2, 0.2, 0.14, 12), tyre, x, -0.3, s * 0.5, Math.PI / 2);
    add(g, cyl(0.03, 0.03, 0.7, 6), chrome(), 0.4, 0.5, 0);
    add(g, box(0.34, 0.16, 0.14), mat(0xe8e2d4), 0.4, 0.9, 0);
    for (const s of [-1, 1]) add(g, cyl(0.05, 0.05, 0.04, 10), glow(0x7dfff0, 2), 0.58, 0.9, s * 0.08, 0, 0, Math.PI / 2);
    add(g, cone(0.16, 0.1, 12, 1, true), mat(0xf2f2f2, { side: THREE.DoubleSide }), -0.35, 0.45, 0.2, Math.PI);
  },
  jar(g) {
    add(g, cyl(0.5, 0.5, 1.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide }), 0, 0, 0);
    add(g, cyl(0.5, 0.5, 0.04, 16), mat(0xbfd8e6, { transparent: true, opacity: 0.5 }), 0, -0.6, 0);
    add(g, cyl(0.54, 0.54, 0.16, 16), mat(0xb8643a, { metalness: 0.6 }), 0, 0.66, 0);
    const twister = new THREE.Group();
    for (let i = 0; i < 7; i++) add(twister, tor(0.08 + i * 0.045, 0.03, 14), mat(0xd9824a, { roughness: 1 }), Math.sin(i) * 0.04, -0.5 + i * 0.15, 0, Math.PI / 2);
    twister.userData.spin = 6; twister.userData.spinAxis = 'y';
    g.add(twister); g.userData.parts = [twister];
  },
  flag(g, s) { flag(g, s.world === 'moon' ? 0x4db8ff : 0xff5a3c, 0xffffff); g.userData.sway = 0.15; },
  teapot(g) {
    const c = mat(0xf2f6ff, { roughness: 0.2 });
    add(g, sph(0.62, 18, 12), c, 0, 0, 0, 0, 0, 0, 1, 0.82, 1);
    add(g, cyl(0.3, 0.34, 0.08, 16), mat(0x3a6fd6), 0, 0.5, 0);
    add(g, sph(0.09), gold(), 0, 0.6, 0);
    add(g, tor(0.3, 0.06, 16), c, -0.68, 0.02, 0);
    add(g, cyl(0.07, 0.12, 0.6, 10), c, 0.72, 0.1, 0, 0, 0, -0.9);
    add(g, tor(0.5, 0.03, 24), mat(0x3a6fd6), 0, 0.15, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++) add(g, sph(0.1 + i * 0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 - i * 0.1 }), 1.05 + i * 0.12, 0.5 + i * 0.26, 0);
    g.userData.bob = 0.4;
  },
  whale(g) {
    const b = mat(0x5a8fd6, { roughness: 0.45 });
    add(g, sph(0.6, 18, 12), b, 0, 0, 0.1, 0, 0, 0, 1, 0.85, 1.7);
    add(g, sph(0.5, 14, 8), mat(0xdfeaf6), 0, -0.14, 0.2, 0, 0, 0, 0.95, 0.7, 1.5);
    add(g, cone(0.25, 0.9, 10), b, 0, 0.05, -1.2, -Math.PI / 2);
    for (const s of [-1, 1]) { add(g, box(0.55, 0.05, 0.3), b, s * 0.3, 0.1, -1.65, 0, s * 0.5); add(g, box(0.6, 0.05, 0.3), b, s * 0.65, -0.2, 0.3, 0, 0, -s * 0.5); add(g, sph(0.05), mat(0x111111), s * 0.47, 0.1, 0.8); }
    add(g, cyl(0.02, 0.06, 0.3, 6), glow(0xcfeaff, 2), 0, 0.62, 0.3);
    g.userData.bob = 0.7; g.userData.sway = 0.12;
  },
  shard(g) {
    const cols = [0xff4d6d, 0xffc94d, 0x4dff9a, 0x4db8ff, 0xb44dff];
    cols.forEach((c, i) => add(g, new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.85, flatShading: true }), (i - 2) * 0.3, Math.sin(i * 1.4) * 0.3, 0, 0, i, 0, 1, 2.3 - Math.abs(i - 2) * 0.5, 1));
    g.userData.spin = 1.2; g.userData.spinAxis = 'y';
  },
  golf(g) {
    add(g, new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, flatShading: true }), 0, 0.2, 0);
    add(g, cyl(0.02, 0.05, 0.6, 6), mat(0xf2c14e), 0, -0.6, 0);
    add(g, cyl(0.16, 0.05, 0.08, 10), mat(0xf2c14e), 0, -0.3, 0);
    g.userData.spin = 1.5; g.userData.spinAxis = 'x';
  },
  cheese(g) {
    const wedge = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.7, 10, 1, false, 0, 0.9), mat(0xffcf3f, { roughness: 0.6, side: THREE.DoubleSide }));
    wedge.position.set(-0.4, 0, -0.5); g.add(wedge);
    for (const [x, y, z, r] of [[0.1, 0.36, 0.2, 0.13], [-0.1, 0.36, -0.1, 0.09], [0.3, 0.36, 0.36, 0.07]]) add(g, cyl(r, r, 0.02, 10), mat(0xd99a1c), x, y, z);
    g.userData.spin = 0.7; g.userData.spinAxis = 'y';
  },
};

/** Build the model for a secret. Returns { object, update(t) }. */
export function buildProp(secret) {
  const g = new THREE.Group();
  (BUILD[secret.prop] || BUILD.shard)(g, secret);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const base = g.rotation.clone();
  const u = g.userData, parts = u.parts || [];
  return {
    object: g,
    update(t) {
      if (u.spin) g.rotation[u.spinAxis || 'z'] = base[u.spinAxis || 'z'] + t * u.spin;
      if (u.sway) g.rotation.z = base.z + Math.sin(t * 1.7) * u.sway;
      g.position.y = Math.sin(t * 1.3) * (u.bob || 0.18);
      for (const p of parts) p.rotation[p.userData.spinAxis] = t * p.userData.spin;
    },
    dispose() { g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => m.dispose()); } }); },
  };
}

export const PROP_KINDS = Object.keys(BUILD);
