/**
 * Connects the Multiplayer module to the Game shell (src/game/game.js) and
 * whichever menu UI is loaded:
 *   - team UI (src/ui): drives its Multiplayer + Lobby screens through the
 *     'multiplayer' / 'lobby' events and ui.showLobby(),
 *   - fallback UI: opens our own LobbyUI overlay.
 * When the host starts a race every player's game loads the same track and
 * hands the Race an OnlineRace controller.
 */
import { Multiplayer } from './index.js';
import { LobbyUI, readRoomFromUrl } from './lobby-ui.js';
import { OnlineRace, encodeCarId } from './online-race.js';

const hex = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#e31937');

export function attachMultiplayer(game, THREE) {
  const ui = game.ui;
  const carMod = game.mods.car;
  const worlds = game.worlds;
  const teamLobby = typeof ui.showLobby === 'function';

  const profileFor = (name) => {
    const P = game.profile;
    const paint = carMod.PAINTS.find((p) => p.id === P.car.paint) || {};
    return {
      name: name || (P.name && P.name !== 'Driver' ? P.name : '') || readName() || 'Driver' + Math.floor(Math.random() * 900 + 100),
      color: hex(paint.color ?? paint.hex),
      carId: encodeCarId(P.car.paint, P.car.wheels),
    };
  };

  const mp = new Multiplayer(profileFor(readName()));
  // Kid-safe rooms have no typed names: take the name box off the Multiplayer screen.
  if (mp.cfg.kidSafe) {
    const field = document.querySelector('.mp-name')?.closest('label');
    if (field) field.outerHTML = '<p class="mp-safe">Online drivers get a made-up name like "Teal Otter", and there is no chat.</p>';
  }
  const randomWorld = () => worlds[Math.floor(Math.random() * worlds.length)].id;
  mp.setQuickMatchSettings({ trackId: randomWorld(), laps: 3 });

  function readName() {
    try {
      return JSON.parse(localStorage.getItem('roadster.settings.v1') || '{}').playerName || '';
    } catch {
      return '';
    }
  }

  /* ---------------------------------------------------------- lobby view */

  const lobbyData = () => {
    const s = mp.session;
    if (!s?.room) return null;
    const room = s.room;
    const me = room.players.find((p) => p.id === s.selfId);
    return {
      code: room.quick ? 'QUICK' : room.code,
      host: s.isHost,
      ready: !!me?.ready,
      track: room.settings.trackId,
      players: room.players.map((p) => ({
        name: p.name,
        color: p.color,
        ready: p.ready || p.isHost,
        host: p.isHost,
        me: p.id === s.selfId,
        ping: p.id === s.selfId && !s.isHost ? s.ping : null,
      })),
    };
  };

  const showLobby = () => {
    if (!teamLobby || !mp.online) return;
    if (game.state !== 'menu') return;
    const d = lobbyData();
    if (d) ui.showLobby(d);
  };

  let overlay = null;
  const openOverlay = () => {
    if (!overlay) {
      overlay = new LobbyUI(mp, {
        tracks: worlds.map((w) => ({ id: w.id, name: w.name })),
        handleResults: false,
        onExit: () => ui.showMenu(),
      });
    }
    overlay.open();
  };

  const status = (t) => (ui.setMultiplayerStatus ? ui.setMultiplayerStatus(t) : t && ui.toast?.(t));

  /* ---------------------------------------------------------- UI events */

  if (teamLobby) {
    ui.on('multiplayer', async ({ action, code, name }) => {
      mp.setProfile(profileFor(name));
      try {
        if (action === 'quick') {
          mp.setQuickMatchSettings({ trackId: randomWorld(), laps: 3 });
          await mp.quickMatch();
        } else if (action === 'create') {
          await mp.hostRoom({ trackId: game.lastCfg?.worldId || worlds[0].id, laps: 3 });
        } else if (action === 'join') {
          await mp.joinRoom(code);
        }
        status('');
        showLobby();
      } catch (err) {
        status(err?.message || 'Could not connect.');
      }
    });
    ui.on('lobby', ({ action, ready }) => {
      const s = mp.session;
      if (action === 'leave') mp.leave();
      else if (action === 'ready') s?.setReady(!!ready);
      else if (action === 'start' && s?.isHost) {
        if (s.room.players.length < 2) ui.toast?.('Waiting for another driver to join');
        else s.startRace();
      }
    });
  } else {
    ui.on('multiplayer-screen', () => openOverlay());
  }

  /* ---------------------------------------------------------- room events */

  mp.on('status', (t) => t && status(t));
  mp.on('lobby', showLobby);
  mp.on('player-joined', (p) => game.state === 'menu' && ui.toast?.(`${p.name} joined`));
  mp.on('player-left', (p) => ui.toast?.(`${p.name} left`));
  mp.on('chat', (m) => ui.toast?.(`${m.name}: ${m.text}`));
  mp.on('disconnected', ({ reason }) => {
    ui.toast?.(reason);
    if (game.race && game.lastCfg?.mode === 'multiplayer') game.quitToMenu();
  });

  mp.on('countdown', ({ settings }) => {
    const worldId = worlds.some((w) => w.id === settings.trackId) ? settings.trackId : worlds[0].id;
    const cfg = {
      mode: 'multiplayer',
      type: 'race',
      worldId,
      laps: settings.laps || 3,
      opponents: 0,
      skill: 1,
      aiUpgrade: 0,
      weather: worlds.find((w) => w.id === worldId)?.defaultWeather || 'clear',
      online: new OnlineRace({ mp, THREE, createRoadster: carMod.createRoadster }),
    };
    overlay?.close();
    game.lastCfg = cfg;
    game.launch(cfg);
    if (ui.enterRace && game.teamUI) ui.enterRace();
  });

  // Invite links: ?room=CODE joins straight away.
  const invite = readRoomFromUrl();
  if (invite) {
    mp.joinRoom(invite)
      .then(() => (teamLobby ? showLobby() : openOverlay()))
      .catch((err) => ui.toast?.(err?.message || 'Could not join that room.'));
  }

  return {
    mp,
    /** Retry from the results screen: back to the room's lobby. */
    backToLobby() {
      const s = mp.session;
      if (!s) {
        game.quitToMenu();
        return;
      }
      if (s.isHost && s.room.phase === 'results' && !s.room.quick) s.returnToLobby();
      game.quitToMenu(false);
      // The team UI switches to its race HUD right after emitting 'restart'; show the lobby after that.
      setTimeout(() => (teamLobby ? showLobby() : openOverlay()), 0);
    },
    leave() {
      mp.leave();
    },
  };
}
