// Run: python3 -m http.server 8123 (repo root), then node tests/ai/bench.cjs <worlds> <skill> <laps>
// GROUND=1 runs drive-mode races instead of jet ring races. Prints per-world rival stats.
// Headless AI benchmark: run ring races with the player on autopilot, collect per-AI stats.
const { chromium } = require('playwright');
const worlds = (process.argv[2] || 'coast,canyon,isles,spires,mars').split(',');
const skill = +(process.argv[3] || 0.86), laps = +(process.argv[4] || 2), runs = +(process.argv[5] || 1);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 400 } });
  pg.on('console', (m) => { if (m.text().startsWith('FALL')) console.log(m.text()); else if (m.text().startsWith('[[')) console.log('miss', m.text()); });
  pg.on('pageerror', (e) => console.log('ERR', e.message));
  await pg.goto('http://localhost:8123/index.html');
  await pg.waitForFunction(() => window.game && window.game.worlds && window.game.worlds.length, null, { timeout: 60000 });
  await pg.evaluate(() => { const g = window.game; g.loop = () => {}; if (g.renderer) g.renderer.setAnimationLoop && g.renderer.setAnimationLoop(null); });
  const all = [];
  for (const w of worlds) for (let run = 0; run < runs; run++) {
    const res = await pg.evaluate(async ({ w, skill, laps, ground, nr, x1, x2 }) => {
      const g = window.game;
      g.profile.coached = true; g.profile.settings.coach = false; window.__nr = !!nr; window.__x1 = x1 == '1'; window.__x2 = x2 == '1';
      g.launch({ mode: 'quick', flight: !ground, type: ground ? 'race' : 'ringrace', worldId: w, laps, opponents: 7, skill, aiUpgrade: 1 });
      for (let i = 0; i < 200 && !g.race; i++) await new Promise((r) => setTimeout(r, 50));
      const r = g.race; r.coach = null;
      r.autopilot = true; r.state = 'race'; r.stateT = 0;
      const st = new Map(r.cars.map((c) => [c, { name: c.name, player: c.isPlayer, falls: 0, outs: 0, stuck: 0, rings: 0, ringTries: 0, overtakes: 0, contacts: 0 }]));
      const resp = r.respawn ? r.respawn.bind(r) : () => {};
      r.respawn = (c, msg, d) => { const s = st.get(c); if (msg) { s.falls++; console.log("FALL " + JSON.stringify([c.isPlayer, Math.round(c.info.dist), +c.jet.fuel.toFixed(2), Math.round(c.v.speed), c.ai && c.ai.persona.id, r.aiGapAhead ? JSON.stringify(r.gapList) : ""])); } else s.outs++; return resp(c, msg, d); };
      const rc = r.resetCar.bind(r);
      r.resetCar = (c, d) => { if (c.ai && c.ai.stuck > 3) st.get(c).stuck++; return rc(c, d); };

      r.onRing = (c, i, hit) => { const s = st.get(c); s.ringTries++; if (hit) s.rings++; else if (!c.isPlayer) { const R = r.rings[i]; const info = r.track.locate(R.position.x, R.position.z, -1, {}); const ci = r.track.locate(c.v.x, c.v.z, -1, {}); (window.__miss = window.__miss || []).push([+(c.v.y + 0.6 - R.position.y).toFixed(1), +(ci.lat - info.lat).toFixed(1), c.ai.persona && c.ai.persona.id, c.ai.ringPlan && c.ai.ringPlan.skip ? 'skip' : '', +c.jet.fuel.toFixed(2), i, Math.round(R.dist), Math.round(c.v.speed), c.jet.air ? "air" : "gnd"]); } };
      const IDLE = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
      let prevOrder = r.order().slice(), t = 0;
      const dt = 1 / 60;
      while (t < 60 * 12 && !r.cars.every((c) => c.finished)) {
        r.fixed(dt, true, IDLE); t += dt;
        if (Math.round(t * 60) % 30 === 0) {
          const o = r.order();
          o.forEach((c, k) => { const was = prevOrder.indexOf(c); if (k < was) st.get(c).overtakes += was - k; });
          prevOrder = o.slice();
        }
      }
      console.log(JSON.stringify((window.__miss||[]).slice(0,25))); window.__miss = [];
      return r.cars.map((c) => ({ ...st.get(c), time: c.finishTime ?? null, pos: r.position(c), skill: c.ai && c.ai.skill, persona: c.ai && c.ai.persona && c.ai.persona.id }));
    }, { w, skill, laps, ground: !!process.env.GROUND, nr: process.env.NR, x1: process.env.X1, x2: process.env.X2 });
    all.push({ w, res });
    const ai = res.filter((x) => !x.player);
    const sum = (k) => ai.reduce((a, x) => a + x[k], 0);
    const times = ai.map((x) => x.time).filter((x) => x != null);
    const pl = res.find((x) => x.player);
    console.log(`${w.padEnd(9)} fin ${times.length}/${ai.length} best ${Math.min(...times).toFixed(1)} worst ${Math.max(...times).toFixed(1)} spread ${(Math.max(...times) - Math.min(...times)).toFixed(1)} | falls ${sum('falls')} outs ${sum('outs')} stuck ${sum('stuck')} rings ${sum('rings')}/${sum('ringTries')} overtakes ${sum('overtakes')} | autopilot ${pl.time && pl.time.toFixed(1)} P${pl.pos}`);
  }
  require('fs').writeFileSync('bench-out.json', JSON.stringify(all, null, 1));
  await b.close();
})();
