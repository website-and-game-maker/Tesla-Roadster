/**
 * Glue between a Multiplayer session and one Race (src/game/race.js).
 *
 * The Race keeps simulating the local car exactly as in single player. This
 * controller:
 *   - puts the local car on its grid slot (same order on every screen),
 *   - drives the countdown / green light from the shared host clock,
 *   - streams the local car to the room and draws everyone else,
 *   - reports laps and the finish, and ends the race when the host
 *     publishes results.
 * Remote cars are non-colliding (no physics contact over the network).
 */
import { RemoteCars } from './remote-cars.js';
import { FX } from './protocol.js';

/** carId on the wire is "paint:wheels" so others see your exact car. */
export const encodeCarId = (paint, wheels) => `${paint || ''}:${wheels || ''}`.slice(0, 24);
export const decodeCarId = (carId) => {
  const [paint, wheels] = String(carId || '').split(':');
  return { paint: paint || undefined, wheels: wheels || undefined };
};

export class OnlineRace {
  /**
   * @param {object} o
   * @param {object} o.mp          Multiplayer instance (already in a room)
   * @param {object} o.THREE
   * @param {Function} o.createRoadster  car team factory
   */
  constructor({ mp, THREE, createRoadster }) {
    this.mp = mp;
    this.THREE = THREE;
    this.createRoadster = createRoadster;
    this.remote = null;
    this.cars = [];
    this.results = null;
    this.lastCount = null;
    this._offs = [mp.on('results', (r) => (this.results = r))];
  }

  /** Called at the end of Race.build(). */
  onBuild(race) {
    const s = this.mp.session;
    const racers = (s?.room?.players || []).filter((p) => !p.spectator);
    const slot = Math.max(0, racers.findIndex((p) => p.id === s?.selfId));
    const row = Math.floor(slot / 2);
    const side = slot % 2 ? 1 : -1;
    const tr = race.track;
    const p = tr.pointAt(tr.length - 10 - row * 9, side * 3.2);
    const c = race.player;
    c.v.place(p.x, p.y, p.z, p.yaw);
    tr.locate(p.x, p.z, -1, c.info);
    c.prevDist = c.info.dist;
    this.racers = racers.length;

    this.remote = new RemoteCars({
      THREE: this.THREE,
      scene: race.scene,
      tagHeight: 1.7,
      createCarMesh: (color, carId) => {
        const { paint, wheels } = decodeCarId(carId);
        const model = this.createRoadster({ paint, wheels, quality: 'low' });
        return model.object;
      },
    });
  }

  /**
   * Called at the start of Race.update(). Replaces the local intro/countdown
   * with the shared clock. Returns true when the race state was handled.
   */
  preUpdate(race) {
    const t = this.mp.raceTime();
    if (t == null) return true;
    if (t < 0) {
      race.state = 'countdown';
      const n = Math.ceil(-t / 1000);
      race.message = n <= 3 ? String(n) : 'GET READY';
      if (n !== this.lastCount && n <= 3) race.game.audio.ui('countdown');
      this.lastCount = n;
      race.raceTime = 0;
    } else {
      if (race.state === 'countdown' || race.state === 'intro') {
        race.state = 'race';
        race.stateT = 0;
        race.message = 'GO!';
        race.game.audio.ui('go');
      }
      // Keep the race clock on the shared timeline so everyone's times compare.
      race.raceTime = t / 1000;
    }
    return true;
  }

  /** Called at the end of Race.postUpdate(), after the car meshes moved. */
  postUpdate(race) {
    const c = race.player;
    const v = c.v;
    const o = c.model.object;
    const fx =
      (v.brake > 0.1 ? FX.BRAKE : 0) | (v.drifting ? FX.DRIFT : 0) | (v.boosting ? FX.BOOST : 0) | (race.night ? FX.HEADLIGHTS : 0);
    this.mp.sendState({
      pos: [v.x, v.y, v.z],
      quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
      vel: [v.vx, v.vy || 0, v.vz],
      speed: v.vF,
      steer: v.steer,
      lap: Math.max(0, c.crossings - 1),
      progress: race.track.length ? c.info.dist / race.track.length : 0,
      fx,
    });
    this.cars = this.mp.getRemoteCars();
    this.remote?.update(this.cars, race.camera);

    if (this.results && !race.ended) race.endRace();
  }

  onLap(lapSeconds, lapNumber) {
    this.mp.reportLap(lapNumber, lapSeconds * 1000);
  }

  onFinish(race) {
    const c = race.player;
    this.mp.reportFinish(c.finishTime * 1000, (c.bestLap || 0) * 1000);
  }

  /** Overrides for Race.hudData(). */
  hud(race) {
    const s = this.mp.session;
    const order = s?.order || [];
    const pos = order.indexOf(s?.selfId) + 1;
    return {
      position: pos || 0,
      racers: Math.max(this.racers || 1, order.length),
      others: this.cars.map((rc) => ({ x: rc.p[0], z: rc.p[2], color: rc.color })),
      extra: s && !s.isHost ? `${s.ping} ms` : '',
    };
  }

  /** Result object for Game.onRaceEnd(), built from the host's results. */
  result(race) {
    const s = this.mp.session;
    const c = race.player;
    const rows = this.results || [];
    const me = rows.find((r) => r.id === s?.selfId);
    const fmt = (ms) => {
      if (ms == null) return '--';
      const t = ms / 1000;
      const m = Math.floor(t / 60);
      return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
    };
    return {
      type: 'race',
      online: true,
      position: me?.place || rows.length || 1,
      racers: rows.length || this.racers || 1,
      bestLap: c.bestLap,
      totalTime: me?.totalMs != null ? me.totalMs / 1000 : c.finishTime,
      driftScore: Math.round(race.drift.score),
      dnf: !!me?.dnf,
      table: rows.map((r) => ({ pos: r.place, name: r.name, me: r.id === s?.selfId, time: r.dnf ? 'DNF' : fmt(r.totalMs) })),
    };
  }

  dispose() {
    this._offs.forEach((off) => off());
    this.remote?.dispose();
  }
}
