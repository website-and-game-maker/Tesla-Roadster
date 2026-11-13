/**
 * Drives three.js objects for remote players.
 *
 *   const remote = new RemoteCars({ THREE, scene, createCarMesh: (color, carId) => createRoadster({ paint }) });
 *   // each render frame:
 *   remote.update(mp.getRemoteCars(), camera, dt);
 *
 * createCarMesh may return a THREE.Object3D or a car-team model
 * ({ object, update, setFlight, setThrust, setBrake, setHeadlights }). With a
 * model, remotes also get spinning wheels, brake/head lights and, in flight,
 * the flight pose and thruster glow.
 *
 * Remote cars are rendered as solid cars with a floating name tag. Cars
 * whose data went stale (lag spike / disconnect) fade to a translucent ghost
 * instead of freezing solid in the middle of the road.
 */
export class RemoteCars {
  constructor({ THREE, scene, createCarMesh, nameTags = true, tagHeight = 1.9 }) {
    this.THREE = THREE;
    this.scene = scene;
    this.createCarMesh = createCarMesh;
    this.nameTags = nameTags;
    this.tagHeight = tagHeight;
    this.cars = new Map(); // id -> { root, mesh, tag, color, carId, opacity }
  }

  update(remoteCars, camera, dt = 1 / 60) {
    const seen = new Set();
    for (const rc of remoteCars) {
      seen.add(rc.id);
      let entry = this.cars.get(rc.id);
      if (!entry || entry.color !== rc.color || entry.carId !== rc.carId) {
        if (entry) this._dispose(rc.id);
        entry = this._create(rc);
      }
      entry.root.position.set(rc.p[0], rc.p[1], rc.p[2]);
      entry.root.quaternion.set(rc.q[0], rc.q[1], rc.q[2], rc.q[3]);
      entry.root.userData.remote = rc; // lets the game read speed/steer/fx for wheels, lights, smoke
      this._animate(entry, rc, dt);

      const target = rc.stale ? 0.35 : 1;
      entry.opacity += (target - entry.opacity) * 0.15;
      this._setOpacity(entry, entry.opacity);

      if (entry.tag) {
        if (entry.tagPos !== rc.position || entry.tagName !== rc.name) this._drawTag(entry, rc);
        if (camera) {
          const d = camera.position.distanceTo(entry.root.position);
          const s = Math.min(3, Math.max(0.6, d * 0.05));
          entry.tag.scale.set(s * 2, s * 0.5, 1);
          entry.tag.visible = d < 400;
        }
      }
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id)) this._dispose(id);
  }

  /** The three.js object for a player id (e.g. to point a spectator camera at). */
  get(id) {
    return this.cars.get(id)?.root || null;
  }

  dispose() {
    for (const id of [...this.cars.keys()]) this._dispose(id);
  }

  _create(rc) {
    const { THREE } = this;
    const root = new THREE.Group();
    root.name = `remote-${rc.id}`;
    const made = this.createCarMesh(rc.color, rc.carId);
    const model = made && !made.isObject3D && made.object ? made : null;
    const mesh = model ? model.object : made;
    root.add(mesh);
    const entry = { root, mesh, model, flight: null, tag: null, color: rc.color, carId: rc.carId, opacity: 1, materials: [] };
    mesh.traverse((o) => {
      if (!o.material) return;
      // Clone so fading this car doesn't fade the shared player material.
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) {
        m.userData.baseOpacity = m.opacity;
        m.userData.baseTransparent = m.transparent;
        entry.materials.push(m);
      }
    });
    if (this.nameTags) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.position.y = this.tagHeight;
      sprite.renderOrder = 999;
      root.add(sprite);
      entry.tag = sprite;
      entry.canvas = canvas;
    }
    this.scene.add(root);
    this.cars.set(rc.id, entry);
    return entry;
  }

  /** Drive the car model's own animation hooks from the network state. */
  _animate(entry, rc, dt) {
    const m = entry.model;
    if (!m) return;
    const flying = rc.mode === 'flight' ? 1 : 0;
    if (flying !== entry.flight) {
      entry.flight = flying;
      m.setFlight?.(flying);
    }
    if (flying) m.setThrust?.(rc.thrust || 0);
    const fx = rc.fx | 0;
    m.setBrake?.(!!(fx & 1));
    m.setHeadlights?.(!!(fx & 8));
    m.update?.(dt, rc.speed || 0, -(rc.steer || 0)); // car API: +rad steers left
  }

  _drawTag(entry, rc) {
    entry.tagPos = rc.position;
    entry.tagName = rc.name;
    const ctx = entry.canvas.getContext('2d');
    const { width: w, height: h } = entry.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,12,16,0.72)';
    const r = 18;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(4, 8, w - 8, h - 16, r) : ctx.rect(4, 8, w - 8, h - 16);
    ctx.fill();
    ctx.fillStyle = rc.color;
    ctx.fillRect(16, 20, 8, h - 40);
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const label = rc.position ? `P${rc.position}  ${rc.name}` : rc.name;
    ctx.fillText(label, 34, h / 2, w - 48);
    entry.tag.material.map.needsUpdate = true;
  }

  _setOpacity(entry, a) {
    const faded = a < 0.99;
    for (const m of entry.materials) {
      m.transparent = faded || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * a;
      m.depthWrite = !faded;
    }
  }

  _dispose(id) {
    const e = this.cars.get(id);
    if (!e) return;
    this.scene.remove(e.root);
    for (const m of e.materials) m.dispose();
    e.model?.dispose?.();
    if (e.tag) {
      e.tag.material.map.dispose();
      e.tag.material.dispose();
    }
    this.cars.delete(id);
  }
}
