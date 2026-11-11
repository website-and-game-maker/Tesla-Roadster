# Online multiplayer

Everything lives in `src/multiplayer/`. It's plain ES modules with no build step and doesn't depend on the engine.

## How it works (and why)

GitHub Pages can only serve static files, so there's no game server. Instead:

1. **Matchmaking** goes through the free public [PeerJS](https://peerjs.com) broker. It only introduces two browsers (it swaps WebRTC connection offers). It needs no account and no key.
2. **Race traffic** then flows directly between browsers over WebRTC data channels. The room's host relays car states to everyone (star topology: 7 connections for 8 players, not 28).
3. **Physics stay local.** Each player simulates their own car. Remote cars are drawn 100 ms in the past and blended with a Hermite curve that matches both position and velocity, so they stay smooth at 200+ km/h. They extrapolate for at most 250 ms when packets drop, then fade to a translucent ghost.
4. **One shared clock.** Guests estimate the host's clock from pings (using the fastest third of 16 samples), so everyone's lights go green at the same instant and race times compare fairly.
5. **Leaderboards** are always kept locally. Fill in two config values to make them global with a free [Supabase](https://supabase.com) project, which uses its REST API and needs no SDK.

Strong opinion: this beats Firebase or a paid realtime service for a racing game. Free realtime tiers cap messages per month, and 8 cars × 20 updates/s burns through that in days. Peer-to-peer costs nothing per message. Supabase is used only for the low-volume part (one row per lap), where a real database with SQL checks is the right tool.

## Modes

| Mode | How |
|---|---|
| Quick Match | `mp.quickMatch()`. Joins an open public lobby or creates one. It auto-starts 20 s after a 2nd driver joins, or immediately when everyone readies up, and then loops back to the lobby after results. |
| Private room | `mp.hostRoom({ trackId, laps })` returns a 5-character code (e.g. `K7QXM`). Friends call `mp.joinRoom(code)` or open an invite link `…/?room=K7QXM`. The host picks the track and laps, can kick players, and starts the race. |
| Single player | Unchanged. The local leaderboard still records personal bests offline. |

Up to 8 drivers per room. You get chat in the lobby, a live position HUD, a lap feed, a 30 s finish window after the winner crosses the line (then DNF), and a results screen.

## Integration (for the game loop)

```js
import { Multiplayer, LobbyUI, RemoteCars, readRoomFromUrl } from './src/multiplayer/index.js';
import * as THREE from 'three';

const mp = new Multiplayer({ name: profile.name, color: profile.paint, carId: 'roadster' });
const ui = new LobbyUI(mp, {
  tracks: TRACKS.map((t) => ({ id: t.id, name: t.name })),
  onRaceStart: (settings) => game.loadOnlineRace(settings), // countdown begins
  onExit: () => mainMenu.show(),
});
const remote = new RemoteCars({ THREE, scene, createCarMesh: (color) => createRoadster({ color }) });

// Hold the car at the line until the shared clock says go:
const t = mp.raceTime();            // ms since green, negative in countdown, null if not online
const canDrive = t === null || t >= 0;

// Each frame (it throttles itself to 20 Hz):
mp.sendState({ pos: [x, y, z], quat: [qx, qy, qz, qw], vel: [vx, vy, vz], speed, steer, lap, progress, fx });
remote.update(mp.getRemoteCars(), camera);

// Race events from the game:
mp.reportLap(lapNumber, lapMs);      // also submits to the leaderboard
mp.reportFinish(totalMs, bestLapMs);
```

`progress` is 0..1 along the current lap. `lap` counts completed crossings of the start line. `fx` is a bitmask (`FX.BRAKE | FX.DRIFT | FX.BOOST | FX.HEADLIGHTS | FX.HORN`) for remote brake lights, smoke and so on. Read it from `remoteObject.userData.remote.fx`.

Events: `lobby`, `countdown`, `race-start`, `positions`, `lap`, `grace`, `results`, `chat`, `player-joined`, `player-left`, `disconnected`, `ping`, `status`, `error`.

`multiplayer-demo.html` is a top-down test bench that runs the full stack without the 3D game. Open it in two tabs.

## Turning on global leaderboards (optional, free, about 5 minutes)

1. Sign up at https://supabase.com and create a project (the free tier is fine).
2. Go to **SQL Editor**, then **New query**, paste `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings**, then **API**, and copy the **Project URL** and the **anon public** key into `src/multiplayer/config.js` under `supabase`.

The anon key is meant to be public. The SQL only allows inserting valid lap times (5 s to 1 h, names of 1–16 characters, max 30 per player per 10 minutes) and reading them. Nobody can edit or delete rows.

Note: lap times are reported by the player's browser, so a determined cheater could fake one. If the game becomes popular, the next step is a Supabase Edge Function that checks a recorded ghost replay before accepting a time.

## Known limits

- **Strict NATs.** Roughly 5–10% of players (some mobile carriers, school/corporate Wi-Fi) can't connect peer to peer with only STUN. Fix: add a TURN server to `MP_CONFIG.peer.config.iceServers`. Metered.ca and Cloudflare Calls both have free TURN tiers.
- **Host leaves.** The room closes and guests return to the menu with a message. Host migration is possible later.
- **Public broker.** The free PeerJS cloud has no uptime promise. If it's ever flaky, `npx peerjs --port 9000` on any free host (Fly.io, Render) is a drop-in replacement through `MP_CONFIG.peer`.

## Tests

```
node --test tests/multiplayer/*.test.js
```

The tests run full rooms (host, guests, quick match, max players, host leaving, results) over an in-memory network, plus the clock sync, interpolation, race ordering and leaderboard REST calls.
