// Scenery props: trees, rocks, buildings, lamps... drawn with instancing so
// thousands of them cost only a few draw calls. Every prop sits outside the
// barriers, so props are visual only and need no collision.
import * as THREE from 'three';
import { mulberry32, createNoise2D } from './noise.js';
import { facadeTextures, softDot } from './textures.js';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
}

function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = createNoise2D(seed);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + n(x * 1.7 + y, z * 1.7 - y) * 0.28 + n(x * 4, z * 4 + y * 3) * 0.08;
    p.setXYZ(i, x * k, Math.max(-0.3, y * k * 0.7), z * k);
  }
  g.computeVertexNormals();
  return g;
}

function stack(parts) {
  // Merge simple geometries (each already positioned) into one.
  const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

// Each kind returns a list of parts: { geo, mat, colorJitter?, shadow? }.
// Geometry is authored at roughly real-world size with the base at y = 0.
const KINDS = {
  pine: (o) => {
    const cones = [];
    for (let k = 0; k < 4; k++) {
      const c = new THREE.ConeGeometry(2.6 - k * 0.55, 4.2 - k * 0.5, 8);
      c.translate(0, 3 + k * 2.4, 0);
      cones.push(c);
    }
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 3.4, 6);
    trunk.translate(0, 1.7, 0);
    return [
      { geo: trunk, mat: mat(0x4a3423) },
      { geo: stack(cones), mat: mat(o.snow ? 0x2f4a3a : 0x1f3d2a, { flatShading: true }), colorJitter: 0.18 },
      ...(o.snow ? [{ geo: snowCaps(), mat: mat(0xf4f7fb, { roughness: 0.7 }) }] : []),
    ];
  },
  cypress: () => {
    const body = new THREE.SphereGeometry(1.5, 8, 10);
    body.scale(1, 3.6, 1);
    body.translate(0, 6, 0);
    const trunk = new THREE.CylinderGeometry(0.2, 0.28, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    return [
      { geo: trunk, mat: mat(0x4b3626) },
      { geo: body, mat: mat(0x2b4a26, { flatShading: true }), colorJitter: 0.15 },
    ];
  },
  oak: () => {
    const blobs = [];
    const r = mulberry32(5);
    for (let k = 0; k < 5; k++) {
      const s = new THREE.IcosahedronGeometry(2 + r() * 1.2, 1);
      s.translate((r() - 0.5) * 3.2, 5.5 + r() * 2.2, (r() - 0.5) * 3.2);
      blobs.push(s);
    }
    const trunk = new THREE.CylinderGeometry(0.3, 0.45, 5, 7);
    trunk.translate(0, 2.5, 0);
    return [
      { geo: trunk, mat: mat(0x4b3626) },
      { geo: stack(blobs), mat: mat(0x3d5a2a, { flatShading: true }), colorJitter: 0.22 },
    ];
  },
  palm: () => {
    const trunkParts = [];
    for (let k = 0; k < 6; k++) {
      const c = new THREE.CylinderGeometry(0.22 - k * 0.012, 0.26 - k * 0.012, 1.7, 6);
      c.translate(k * 0.12, 0.85 + k * 1.6, 0);
      trunkParts.push(c);
    }
    const fronds = [];
    for (let k = 0; k < 8; k++) {
      const f = new THREE.PlaneGeometry(0.9, 4.2, 1, 3);
      const p = f.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + 2.1;
        p.setXYZ(i, p.getX(i), -0.08 * y * y, y);
      }
      f.rotateY((k / 8) * Math.PI * 2);
      f.translate(0.7, 9.8, 0);
      fronds.push(f);
    }
    return [
      { geo: stack(trunkParts), mat: mat(0x8a7356) },
      { geo: stack(fronds), mat: mat(0x3f6b2c, { side: THREE.DoubleSide }), colorJitter: 0.2 },
    ];
  },
  cactus: () => {
    const parts = [];
    const main = new THREE.CapsuleGeometry(0.42, 4.5, 4, 8);
    main.translate(0, 2.6, 0);
    parts.push(main);
    for (const s of [-1, 1]) {
      const arm = new THREE.CapsuleGeometry(0.28, 1.6, 4, 8);
      arm.translate(s * 0.95, 3 + s * 0.4, 0);
      const elbow = new THREE.CapsuleGeometry(0.28, 0.6, 4, 8);
      elbow.rotateZ(Math.PI / 2);
      elbow.translate(s * 0.6, 2.3 + s * 0.4, 0);
      parts.push(arm, elbow);
    }
    return [{ geo: stack(parts), mat: mat(0x4f6b3a), colorJitter: 0.12 }];
  },
  shrub: () => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(1, 0.6, 1);
    g.translate(0, 0.35, 0);
    return [{ geo: g, mat: mat(0x6b6a3e, { flatShading: true }), colorJitter: 0.25 }];
  },
  rock: (o) => [{ geo: rockGeometry(o.seed || 11), mat: mat(o.color ?? 0x7a7268, { flatShading: true }), colorJitter: 0.12 }],
  boulder: (o) => [{ geo: rockGeometry((o.seed || 11) + 4, 2), mat: mat(o.color ?? 0x6f675d, { flatShading: true }), colorJitter: 0.1 }],
  building: (o) => {
    const tex = facadeTextures(o.seed || 3);
    const w = o.w ?? 20;
    const h = o.h ?? 40;
    const d = o.d ?? 20;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    // Window grid texture covers 24 m x 48 m; repeat it to real size.
    const uv = g.attributes.uv;
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) { uv.setXY(i, 0.02, 0.02); continue; }
      const span = Math.abs(n.getX(i)) > 0.5 ? d : w;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(span / 24 * 2) / 2), uv.getY(i) * Math.max(1, Math.round(h / 48 * 4) / 4));
    }
    const m = new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.5,
      metalness: 0.35,
      color: o.tint ?? 0xffffff,
    });
    return [{ geo: g, mat: m, colorJitter: 0.25, nightGlow: 1.8 }];
  },
  lamp: (o) => {
    const pole = new THREE.CylinderGeometry(0.09, 0.13, 8, 6);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 2.4);
    arm.translate(0, 7.95, 1.1);
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    head.translate(0, 7.85, 2.2);
    return [
      { geo: stack([pole, arm]), mat: mat(0x3a3d42, { metalness: 0.7, roughness: 0.4 }) },
      { geo: head, mat: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: o.lightColor ?? 0xffc98a, emissiveIntensity: 0 }), nightGlow: 4, shadow: false },
      // Fake pool of light on the road: cheap, and it shines on wet asphalt.
      { geo: lightPool(), mat: new THREE.MeshBasicMaterial({ color: o.lightColor ?? 0xffc98a, map: softDot(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), nightOpacity: 0.9, shadow: false },
    ];
  },
  neon: (o) => {
    const g = new THREE.BoxGeometry(6, 1.4, 0.2);
    g.translate(0, 9, 0);
    const post = new THREE.CylinderGeometry(0.12, 0.12, 9, 6);
    post.translate(0, 4.5, 0);
    return [
      { geo: post, mat: mat(0x2a2c30, { metalness: 0.6 }) },
      { geo: g, mat: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 2.2 }), neon: o.palette || [0xff2f92, 0x2ff3ff, 0xb14bff, 0xffd23f], shadow: false },
    ];
  },
  dome: () => {
    const d = new THREE.SphereGeometry(6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const ring = new THREE.CylinderGeometry(6.2, 6.4, 0.8, 20);
    ring.translate(0, 0.4, 0);
    return [
      { geo: d, mat: new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.25, metalness: 0.4, emissive: 0x9fd2ff, emissiveIntensity: 0 }), nightGlow: 0.25 },
      { geo: ring, mat: mat(0x5c5f63, { metalness: 0.6 }) },
    ];
  },
  crater: (o) => {
    const g = new THREE.TorusGeometry(6, 1.6, 6, 18);
    g.rotateX(Math.PI / 2);
    g.scale(1, 0.35, 1);
    return [{ geo: g, mat: mat(o.color ?? 0x8a4a2e, { flatShading: true }), colorJitter: 0.08 }];
  },
  cone: () => {
    const c = new THREE.ConeGeometry(0.22, 0.7, 10);
    c.translate(0, 0.35, 0);
    return [{ geo: c, mat: mat(0xff6a13, { roughness: 0.6 }), shadow: false }];
  },
  windTurbine: () => {
    const tower = new THREE.CylinderGeometry(1, 1.8, 70, 10);
    tower.translate(0, 35, 0);
    const blades = [];
    for (let k = 0; k < 3; k++) {
      const b = new THREE.BoxGeometry(1.4, 32, 0.4);
      b.translate(0, 16, 0);
      b.rotateZ((k / 3) * Math.PI * 2 + 0.3);
      b.translate(0, 72, 2);
      blades.push(b);
    }
    const nacelle = new THREE.BoxGeometry(3, 3, 7);
    nacelle.translate(0, 71, 0);
    return [{ geo: stack([tower, nacelle, ...blades]), mat: mat(0xf2f4f5, { roughness: 0.5 }) }];
  },
  solarPanel: () => {
    const panel = new THREE.BoxGeometry(6, 0.12, 3);
    panel.rotateX(-0.45);
    panel.translate(0, 1.6, 0);
    const leg = new THREE.BoxGeometry(0.15, 1.6, 0.15);
    leg.translate(0, 0.8, 0);
    return [
      { geo: panel, mat: new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.2, metalness: 0.6 }) },
      { geo: leg, mat: mat(0x888888, { metalness: 0.6 }) },
    ];
  },
  ice: () => [{ geo: rockGeometry(77, 1), mat: new THREE.MeshStandardMaterial({ color: 0xcfe6f5, roughness: 0.15, metalness: 0.05, flatShading: true }), colorJitter: 0.06 }],
};

function lightPool() {
  const g = new THREE.PlaneGeometry(13, 13);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.08, 4.5);
  return g;
}

function snowCaps() {
  const caps = [];
  for (let k = 0; k < 4; k++) {
    const c = new THREE.ConeGeometry(1.4 - k * 0.3, 1.2, 8);
    c.translate(0, 4.6 + k * 2.4, 0);
    caps.push(c);
  }
  return stack(caps);
}

// Scatter props according to a world's rules.
// rule: { kind, count, near, far, scale:[min,max], minY, maxY, maxSlope, options,
//         along: spacing (place in rows along the track), offset, sides }
export function scatterProps(rules, ctx) {
  const { track, heightFn, quality, bounds, seed } = ctx;
  const group = new THREE.Group();
  group.name = 'props';
  const glow = [];
  const tmp = {};
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const occupied = []; // [x, z, r] footprints so buildings never overlap
  const free = (x, z, r) => {
    for (const o of occupied) if ((o[0] - x) ** 2 + (o[1] - z) ** 2 < (o[2] + r) ** 2) return false;
    return true;
  };

  const colliders = [];
  rules.forEach((rule, ruleIndex) => {
    // Each rule has its own random stream, so solid props land in exactly
    // the same spots on every quality tier (multiplayer and physics depend on it).
    const rand = mulberry32(seed * 31 + 7 + ruleIndex * 7919);
    const solid = rule.solid ?? SOLID.has(rule.kind);
    const placements = [];
    if (rule.along) {
      const step = Math.max(1, Math.round(rule.along / track.spacing));
      const sides = rule.sides || [-1, 1];
      for (let i = 0; i < track.count; i += step) {
        if (rule.skipNearStart && (i < 40 / track.spacing || i > track.count - 40 / track.spacing)) continue;
        if (rule.onlyCorners && !track.kerbs[i]) continue;
        if (track.gap && track.gap[i]) continue;
        for (const side of sides) {
          const off = track.wallHalfWidth + (rule.offset ?? 2);
          const x = track.pos[i * 3] + track.right[i * 3] * off * side;
          const z = track.pos[i * 3 + 2] + track.right[i * 3 + 2] * off * side;
          // Face the road.
          const yaw = Math.atan2(-track.right[i * 3] * side, -track.right[i * 3 + 2] * side);
          // Roadside rows stand at road level (terrain dips under the corridor).
          placements.push([x, track.pos[i * 3 + 1], z, yaw]);
        }
      }
    } else {
      // Solid props are never thinned out on low quality: you can crash into them.
      const want = Math.round(rule.count * (solid ? 1 : quality.propDensity));
      let tries = want * 8;
      const near = track.wallHalfWidth + (rule.near ?? 6);
      const far = rule.far ?? Infinity;
      // Solid props use fixed bounds so they match on every quality tier.
      const b = solid ? ctx.solidBounds || bounds : bounds;
      while (placements.length < want && tries-- > 0) {
        const x = b.minX + rand() * (b.maxX - b.minX);
        const z = b.minZ + rand() * (b.maxZ - b.minZ);
        const pr = track.project(x, z, -1, tmp);
        const d = Math.abs(pr.lateral);
        if (d < near || d > far) continue;
        const y = heightFn(x, z);
        if (rule.minY !== undefined && y < rule.minY) continue;
        if (rule.maxY !== undefined && y > rule.maxY) continue;
        if (rule.maxSlope !== undefined) {
          const sx = heightFn(x + 2, z) - y;
          const sz = heightFn(x, z + 2) - y;
          if (Math.hypot(sx, sz) / 2 > rule.maxSlope) continue;
        }
        if (rule.filter && !rule.filter(x, z, y)) continue;
        if (rule.footprint) {
          if (!free(x, z, rule.footprint)) continue;
          occupied.push([x, z, rule.footprint]);
          // Square buildings line up with the street grid.
          placements.push([x, y, z, Math.round(rand() * 4) * (Math.PI / 2)]);
          continue;
        }
        placements.push([x, y, z, rand() * Math.PI * 2]);
      }
    }
    if (!placements.length) return;

    const parts = KINDS[rule.kind]({ ...(rule.options || {}), seed: seed + placements.length });
    const [smin, smax] = rule.scale || [1, 1];
    const scales = placements.map(() => smin + rand() * (smax - smin));
    const jitter = placements.map(() => rand());
    const squash = placements.map(() => (rule.boxScale ? rule.boxScale(rand) : null));
    if (solid) {
      placements.forEach(([x, y, z, yaw], k) => {
        const c = colliderFor(rule, x, y - (rule.sink ? rule.sink * scales[k] : 0), z, yaw, scales[k]);
        if (c) colliders.push(...c);
      });
    }
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geo, part.mat, placements.length);
      inst.castShadow = quality.shadows && part.shadow !== false && rule.shadow !== false;
      inst.receiveShadow = true;
      placements.forEach(([x, y, z, yaw], k) => {
        e.set(rule.tilt ? (jitter[k] - 0.5) * rule.tilt : 0, yaw, rule.tilt ? (jitter[(k + 1) % jitter.length] - 0.5) * rule.tilt : 0);
        q.setFromEuler(e);
        const sc = scales[k];
        if (squash[k]) s.set(squash[k][0], squash[k][1], squash[k][2]);
        else s.set(sc, sc * (rule.stretchY ? 0.7 + jitter[k] * 0.6 : 1), sc);
        p.set(x, y + (rule.sink ? -rule.sink * sc : 0), z);
        m4.compose(p, q, s);
        inst.setMatrixAt(k, m4);
        if (part.colorJitter || part.neon) {
          if (part.neon) col.setHex(part.neon[Math.floor(jitter[k] * part.neon.length)]);
          else col.setRGB(1, 1, 1).multiplyScalar(1 - part.colorJitter + jitter[k] * part.colorJitter * 2);
          inst.setColorAt(k, col);
        }
      });
      if (part.neon) {
        // Tint emissive per instance by multiplying a white emissive with instance colour.
        part.mat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif',
          );
        };
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.name = rule.kind;
      group.add(inst);
      if (part.nightGlow) glow.push({ mat: part.mat, max: part.nightGlow });
      if (part.nightOpacity) glow.push({ mat: part.mat, max: part.nightOpacity, opacity: true });
    }
  });

  return {
    group,
    colliders,
    // Night factor 0..1: switch on window lights, street lamps, domes.
    setNight(n) {
      for (const g of glow) {
        if (g.opacity) { g.mat.opacity = g.max * n; g.mat.visible = n > 0.02; } else g.mat.emissiveIntensity = g.max * n;
      }
    },
  };
}

// Props you can crash into when flying. Trees are left out on purpose: flight
// paths stay over the road where there are none, and foliage is soft.
const SOLID = new Set(['building', 'boulder', 'windTurbine', 'dome', 'ice', 'solarPanel', 'island']);

function colliderFor(rule, x, y, z, yaw, sc) {
  const o = rule.options || {};
  switch (rule.kind) {
    case 'building': {
      const odd = Math.round(yaw / (Math.PI / 2)) % 2 !== 0;
      const hw = ((odd ? o.d : o.w) ?? 20) * sc * 0.5;
      const hd = ((odd ? o.w : o.d) ?? 20) * sc * 0.5;
      const h = (o.h ?? 40) * sc;
      return [box(x - hw, y - 2, z - hd, x + hw, y + h, z + hd)];
    }
    case 'boulder':
    case 'rock':
    case 'ice':
      return [sphere(x, y + 0.25 * sc, z, 0.95 * sc)];
    case 'windTurbine':
      return [box(x - 1.8 * sc, y, z - 1.8 * sc, x + 1.8 * sc, y + 70 * sc, z + 1.8 * sc), sphere(x, y + 72 * sc, z, 33 * sc)];
    case 'dome':
      return [sphere(x, y, z, 6.2 * sc)];
    case 'solarPanel':
      return [box(x - 3.4 * sc, y, z - 3.4 * sc, x + 3.4 * sc, y + 2.4 * sc, z + 3.4 * sc)];
    default:
      return null;
  }
}

export function box(x0, y0, z0, x1, y1, z1) {
  return { type: 'box', min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) };
}

export function sphere(x, y, z, r) {
  return { type: 'sphere', center: new THREE.Vector3(x, y, z), radius: r };
}

export { KINDS, rockGeometry };
