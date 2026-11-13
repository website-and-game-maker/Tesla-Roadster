// Terrain: a heightfield shaped by each world's noise recipe, then pressed
// flat under the track so the road sits on embankments and cuttings.
import * as THREE from 'three';
import { smoothstep } from './noise.js';

// Returns a function (x, z) -> ground height that blends the world's natural
// terrain into the track corridor.
export function makeHeightFn(def, track, noise) {
  if (def.noRoad) {
    // Sky worlds: no road to flatten. Terrain may still be shaped around the
    // flight path (e.g. a canyon carved along it).
    const tmp = {};
    let hint = -1;
    return (x, z) => {
      if (!def.terrainUsesTrack) return def.terrain(noise, x, z, null);
      const p = track.project(x, z, hint, tmp);
      hint = p.index;
      return def.terrain(noise, x, z, p);
    };
  }
  const natural = (x, z) => def.terrain(noise, x, z);
  const corridor = track.wallHalfWidth + 3;
  const blend = def.terrainBlend ?? 45;
  const tmp = {};
  let hint = -1;
  return function height(x, z) {
    const n = natural(x, z);
    const p = track.project(x, z, hint, tmp);
    hint = p.index;
    const d = Math.abs(p.lateral);
    if (d > corridor + blend + 20) return n;
    // Slightly below the road so the terrain never pokes through it.
    const target = p.height - 0.6;
    const k = smoothstep(corridor, corridor + blend, d);
    return target + (n - target) * k;
  };
}

export function buildTerrain(def, track, heightFn, quality, detailMap) {
  const margin = quality.terrainMargin;
  const box = track.box;
  const minX = box.min.x - margin;
  const maxX = box.max.x + margin;
  const minZ = box.min.z - margin;
  const maxZ = box.max.z + margin;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const segX = Math.min(420, Math.max(32, Math.round(w / quality.terrainCell)));
  const segZ = Math.min(420, Math.max(32, Math.round(d / quality.terrainCell)));

  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(minX + w / 2, 0, minZ + d / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = heightFn(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    def.terrainColor(c, pos.getX(i), pos.getZ(i), heights[i], slope);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // World-space UVs: one detail tile every 8 m.
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 8, pos.getZ(i) / 8);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailMap,
    roughness: def.terrainRoughness ?? 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.userData.bounds = { minX, maxX, minZ, maxZ };
  return mesh;
}

// Animated water plane with a scrolling procedural normal map.
export function buildWater(def, track, quality) {
  const size = 9000;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const normalMap = quality.waterDetail ? waterNormals(256) : null;
  if (normalMap) normalMap.repeat.set(size / 40, size / 40);
  const mat = new THREE.MeshStandardMaterial({
    color: def.water.color ?? 0x1d4a63,
    roughness: 0.08,
    metalness: 0.1,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    transparent: true,
    opacity: 0.94,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const cx = (track.box.min.x + track.box.max.x) / 2;
  const cz = (track.box.min.z + track.box.max.z) / 2;
  mesh.position.set(cx, def.water.level, cz);
  mesh.receiveShadow = true;
  mesh.name = 'water';
  mesh.userData.update = (dt) => {
    if (normalMap) {
      normalMap.offset.x += dt * 0.012;
      normalMap.offset.y += dt * 0.007;
    }
  };
  return mesh;
}

function waterNormals(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  // Sum of a few tiling sine waves -> analytic slope -> normal.
  const waves = [
    [3, 1, 0.5], [1, 4, 0.35], [5, -2, 0.25], [-7, 3, 0.15], [9, 8, 0.1],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, a] of waves) {
        const ph = ((kx * x + ky * y) / size) * Math.PI * 2;
        const cs = Math.cos(ph) * a;
        dx += cs * kx;
        dy += cs * ky;
      }
      const nx = -dx * 0.06;
      const ny = -dy * 0.06;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
