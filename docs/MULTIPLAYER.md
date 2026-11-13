# Online multiplayer

Everything lives in `src/multiplayer/`. It's plain ES modules with no build step and doesn't depend on the engine.

## How it works (and why)

GitHub Pages can only serve static files, so there's no game server. Instead:

1. **Matchmaking** goes through the free public [PeerJS](https://peerjs.com) broker. It only introduces two browsers (it swaps WebRTC connection offers). It needs no account and no key. The PeerJS library itself is bundled in `vendor/peerjs.module.js` (licenses in `vendor/PEERJS-LICENSE`), so the game loads no scripts from a CDN. The broker connection is the only outside request.
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

Up to 8 drivers per room. With `kidSafe: true` in `config.js` there is no chat and every driver gets a made-up name ("Teal Otter") from the host; the kids' game site builds it that way. Otherwise you get chat in the lobby, a live position HUD, a lap feed, a 30 s finish window after the winner crosses the line (then DNF), and a results screen.

## How it's wired into the game

- `src/multiplayer/game-bridge.js` is attached by `Game.boot()`. It drives the menu team's Multiplayer and Lobby screens (or our own `LobbyUI` overlay when the fallback UI is loaded). When the host starts, it launches the same track on every player's game with `mode: 'multiplayer'`.
- `src/multiplayer/online-race.js` is handed to `Race` as `cfg.online`. It places the car on its grid slot, runs the countdown from the shared clock, streams the car, draws the other players with name tags, reports laps and the finish, and ends the race when the host publishes results.
- In the results screen, **Retry** takes you back to the room's lobby and **Continue** leaves the room.
- Invite links (`?room=CODE`) join on load.

## Integration API (for other engines)

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

## Flight mode

Flight races use the same rooms. The Race hands its state to the network through an optional hook:

```js
race.onlineState = () => ({
  mode: 'flight', pos: [x, y, z], quat: [qx, qy, qz, qw], vel: [vx, vy, vz],
  speed, thrust /* 0..1 */, ringIndex, lap, progress /* 0..1 along the course */, fx,
});
```

`OnlineRace` sends this instead of the driving state when it exists. Remote cars get the full 3D rotation, position blended in 3D (climbs and dives stay smooth), and `model.setFlight(1)` / `model.setThrust(t)` on the car team's model, which is called only when the model has those methods. They switch back with `setFlight(0)` when the player lands. Race order still comes from `lap` + `progress`.

Flight time attack leaderboards are per course: `mp.leaderboard.submit({ courseId, lapMs, name, mode: 'flight' })` and `mp.leaderboard.top(courseId)`.

## Accounts & cloud saves

```js
import { auth, cloud } from './src/multiplayer/index.js';
auth.enabled                                   // false until Supabase keys are set
auth.onChange((user) => menu.setUser(user));   // { id, email, isAnonymous } | null, called now and on change
await auth.signUp(email, pw);                  // -> { user, needsConfirmation }
await auth.signIn(email, pw);
await auth.signInAsGuest();                    // no email; saves still sync
await auth.upgrade(email, pw);                 // guest -> full account, same saves
await auth.signOut();
const saved = await cloud.loadProfile();       // JSON | null
await cloud.saveProfile(profileJson);          // coalesced to at most one upload every 3 s
```

With no keys configured, everything stays local-only: sign-in calls reject with "Online accounts are not set up", `loadProfile()` returns null and `saveProfile()` resolves `{ saved: false }`. Errors come back as plain sentences, for example "Wrong email or password." Sessions persist across reloads and refresh themselves.

Suggested merge on sign-in: if the cloud save exists, use whichever save has more progress (or the newer one), then `saveProfile` the result.

## SETUP: accounts, cloud saves and global leaderboards (free, about 10 minutes)

You only need to do this once. Everything stays on Supabase's free plan.

1. Go to https://supabase.com, click **Start your project**, and sign in with GitHub.
2. Click **New project**. Pick any name (for example `roadster`), make up a database password (you won't need it in the game), choose the region closest to you, and click **Create new project**. Wait about a minute while it sets up.
3. In the left sidebar, open **SQL Editor** and click **New query**. Open `supabase/schema.sql` from this repo, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned". It's safe to run again later.
4. In the left sidebar, open **Authentication**, then **Sign In / Providers** (on older dashboards it's **Providers**):
   - **Email** should already be on. For instant sign-up with no confirmation email, turn **Confirm email** off and save.
   - Turn on **Allow anonymous sign-ins** and save. This enables guest accounts.
5. Still under **Authentication**, open **URL Configuration** and set **Site URL** to your game's address, for example `https://website-and-game-maker.github.io/Tesla-Roadster/`.
6. Open **Project Settings**, then **API** (or **Data API** and **API Keys**). Copy the **Project URL** and the **anon public** key.
7. Paste both into `src/multiplayer/config.js`:
   ```js
   supabase: {
     url: 'https://abcdefgh.supabase.co',
     anonKey: 'eyJhbGciOi...',
   },
   ```
   Commit and push. GitHub Pages picks it up within a minute.

Is it safe to put the anon key in a public repo? Yes. It is designed to be public, and the database rules in `schema.sql` do the protecting:
- Players can read and write only their own save row.
- Lap times can only be added (5 s to 1 h, names of 1–16 characters, max 30 per player per 10 minutes) and read. Nobody can edit or delete them.

Never paste the **service_role** key anywhere in the game.

Free plan limits that matter here: 50,000 monthly active users, a 500 MB database, and projects pause after a week with no activity. Opening the game wakes it, but the first request can take a few seconds.

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
