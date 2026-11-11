/**
 * Drop-in online lobby overlay: quick match, private rooms, room lobby with
 * chat, in-race HUD (position, ping, lap feed), results and leaderboards.
 *
 *   const ui = new LobbyUI(mp, { tracks, onRaceStart: (settings) => game.loadOnlineRace(settings), onExit });
 *   ui.open();
 *
 * Theme it with CSS variables on .trr-mp (--mp-accent, --mp-bg, ...).
 * Player-provided text (names, chat) is only ever set via textContent.
 */
import { normalizeRoomCode, isValidRoomCode } from './protocol.js';

const STYLE_ID = 'trr-mp-style';
const CSS = `
.trr-mp{--mp-bg:rgba(8,10,14,.72);--mp-panel:rgba(22,25,32,.82);--mp-fg:#f4f5f7;--mp-muted:#9aa1ad;--mp-accent:#e31937;--mp-ok:#2ecc71;
  position:fixed;inset:0;z-index:1000;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--mp-fg);pointer-events:none}
.trr-mp *{box-sizing:border-box}
.trr-mp .ov{position:absolute;inset:0;display:flex;padding:16px;background:var(--mp-bg);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto;overflow:auto}
.trr-mp .ov[hidden]{display:none}
.trr-mp .panel{width:100%;max-width:560px;margin:auto;background:var(--mp-panel);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;
  box-shadow:0 20px 60px rgba(0,0,0,.45);animation:trrIn .25s ease-out}
@keyframes trrIn{from{opacity:0;transform:translateY(8px) scale(.98)}}
.trr-mp h2{margin:0 0 14px;font-size:22px;letter-spacing:.02em}
.trr-mp h3{margin:16px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--mp-muted)}
.trr-mp button{min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);
  color:inherit;font:inherit;font-weight:600;cursor:pointer;transition:background .15s,transform .1s}
.trr-mp button:hover:not(:disabled){background:rgba(255,255,255,.12)}
.trr-mp button:active:not(:disabled){transform:scale(.97)}
.trr-mp button:disabled{opacity:.45;cursor:default}
.trr-mp button.primary{background:var(--mp-accent);border-color:transparent}
.trr-mp button.primary:hover:not(:disabled){filter:brightness(1.12);background:var(--mp-accent)}
.trr-mp button.small{min-height:36px;padding:6px 10px;font-size:13px}
.trr-mp .big{display:block;width:100%;font-size:17px;min-height:54px;margin-bottom:10px}
.trr-mp .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.trr-mp .row>*{flex:1 1 auto}
.trr-mp input,.trr-mp select{min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);
  color:inherit;font:inherit;min-width:0}
.trr-mp .code-in{text-transform:uppercase;letter-spacing:.3em;font-weight:700;text-align:center;font-size:20px}
.trr-mp .muted{color:var(--mp-muted);font-size:13px}
.trr-mp .err{color:#ff6b6b;min-height:20px;margin-top:6px;font-size:14px}
.trr-mp .status{display:flex;align-items:center;gap:10px;min-height:24px;color:var(--mp-muted)}
.trr-mp .spin{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:var(--mp-accent);animation:trrSpin .8s linear infinite}
@keyframes trrSpin{to{transform:rotate(360deg)}}
.trr-mp .code{font:800 34px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em}
.trr-mp ul.players{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.trr-mp ul.players li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);min-height:44px}
.trr-mp .sw{width:14px;height:14px;border-radius:4px;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.3) inset}
.trr-mp .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trr-mp .tag{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:var(--mp-muted)}
.trr-mp .tag.ok{background:rgba(46,204,113,.18);color:var(--mp-ok)}
.trr-mp .chat{height:120px;overflow-y:auto;padding:8px;border-radius:10px;background:rgba(0,0,0,.3);font-size:14px}
.trr-mp .chat div{word-break:break-word}
.trr-mp .chat b{font-weight:700;margin-right:6px}
.trr-mp table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.trr-mp td,.trr-mp th{padding:8px 6px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06)}
.trr-mp th{font-size:12px;color:var(--mp-muted);text-transform:uppercase;letter-spacing:.08em}
.trr-mp td.num,.trr-mp th.num{text-align:right}
.trr-mp tr.p1 td:first-child{color:#ffd54a}.trr-mp tr.p2 td:first-child{color:#cfd8dc}.trr-mp tr.p3 td:first-child{color:#e0a46b}
.trr-mp tr.me{background:rgba(227,25,55,.12)}
.trr-mp .tabs{display:flex;gap:6px;margin-bottom:10px}
.trr-mp .tabs button[aria-selected=true]{background:var(--mp-accent);border-color:transparent}
.trr-mp .hud{position:absolute;top:12px;right:12px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none}
.trr-mp .hud .pos{font:800 34px/1 system-ui;text-shadow:0 2px 8px rgba(0,0,0,.6)}
.trr-mp .hud .pos small{font-size:18px;opacity:.7}
.trr-mp .hud .ping{font-size:12px;color:var(--mp-muted);background:rgba(0,0,0,.4);padding:2px 8px;border-radius:999px}
.trr-mp .toasts{position:absolute;left:12px;bottom:90px;display:flex;flex-direction:column;gap:6px;max-width:min(80vw,360px);pointer-events:none}
.trr-mp .toast{background:rgba(10,12,16,.75);padding:6px 12px;border-radius:10px;font-size:14px;animation:trrIn .2s ease-out;border-left:3px solid var(--mp-accent)}
@media (max-width:420px){.trr-mp .panel{padding:14px}.trr-mp .code{font-size:28px}.trr-mp h2{font-size:19px}}
@media (prefers-reduced-motion:reduce){.trr-mp *{animation:none!important;transition:none!important}}
`;

export function defaultFormatTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

/** Room code from ?room=CODE (for invite links), or null. */
export function readRoomFromUrl(loc = globalThis.location) {
  try {
    const code = normalizeRoomCode(new URLSearchParams(loc.search).get('room'));
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

/** Tiny DOM builder. Strings become text nodes, never HTML. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export class LobbyUI {
  constructor(mp, { container = document.body, tracks = [{ id: 'default', name: 'Circuit' }], onRaceStart, onExit, formatTime } = {}) {
    this.mp = mp;
    this.tracks = tracks;
    this.onRaceStart = onRaceStart || (() => {});
    this.onExit = onExit || (() => {});
    this.fmt = formatTime || defaultFormatTime;
    this.chatLog = [];
    this.screen = null;

    if (!document.getElementById(STYLE_ID)) document.head.append(h('style', { id: STYLE_ID }, CSS));
    this.root = h('div', { class: 'trr-mp' });
    this.ov = h('div', { class: 'ov', hidden: true, role: 'dialog', 'aria-modal': 'true' });
    this.hud = h('div', { class: 'hud', hidden: true });
    this.toasts = h('div', { class: 'toasts' });
    this.root.append(this.ov, this.hud, this.toasts);
    container.append(this.root);

    this._offs = [
      mp.on('status', (t) => this._setStatus(t)),
      mp.on('error', (e) => this._setError(e?.message || String(e))),
      mp.on('lobby', () => this._onLobby()),
      mp.on('countdown', (c) => this._onCountdown(c)),
      mp.on('positions', () => this._renderHud()),
      mp.on('ping', () => this._renderHud()),
      mp.on('lap', (e) => this._toast(`${e.name} · lap ${e.lap} · ${this.fmt(e.ms)}`)),
      mp.on('grace', (g) => this._toast(`First car finished! ${Math.round((g.until - this.mp.session.hostNow()) / 1000)}s left`)),
      mp.on('results', (r) => this.showResults(r)),
      mp.on('chat', (m) => this._onChat(m)),
      mp.on('player-joined', (p) => this._toast(`${p.name} joined`)),
      mp.on('player-left', (p) => this._toast(`${p.name} left`)),
      mp.on('disconnected', ({ reason }) => {
        this.hud.hidden = true;
        this.openMenu();
        this._setError(reason);
      }),
    ];
    this._onKey = (e) => {
      if (e.key === 'Escape' && !this.ov.hidden) this._back();
    };
    window.addEventListener('keydown', this._onKey);
    this._hudTimer = setInterval(() => this._tick(), 250);
  }

  open() {
    if (this.mp.online) this._onLobby(true);
    else this.openMenu();
  }

  close() {
    this.ov.hidden = true;
  }

  destroy() {
    this._offs.forEach((off) => off());
    clearInterval(this._hudTimer);
    window.removeEventListener('keydown', this._onKey);
    this.root.remove();
  }

  /* ---------------------------------------------------------- screens */

  _show(name, panel) {
    this.screen = name;
    this.ov.replaceChildren(panel);
    this.ov.hidden = false;
    panel.querySelector('[autofocus]')?.focus();
  }

  _back() {
    if (this.screen === 'menu') {
      this.close();
      this.onExit();
    } else if (this.screen === 'leaderboard' || this.screen === 'create') {
      this.mp.online ? this._onLobby(true) : this.openMenu();
    } else if (this.screen === 'lobby') {
      this._leave();
    }
  }

  openMenu() {
    const code = h('input', { class: 'code-in', maxLength: 5, placeholder: 'CODE', autocomplete: 'off', 'aria-label': 'Room code' });
    code.addEventListener('input', () => (code.value = normalizeRoomCode(code.value).slice(0, 5)));
    const join = () => this._run(() => this.mp.joinRoom(code.value));
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    this.statusEl = h('div', { class: 'status' });
    this.errEl = h('div', { class: 'err', role: 'alert' });
    this._show(
      'menu',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Online Racing'),
        h('button', { class: 'primary big', autofocus: true, onclick: () => this._run(() => this.mp.quickMatch()) }, 'Quick Match'),
        h('button', { class: 'big', onclick: () => this._createScreen() }, 'Create Private Room'),
        h('h3', {}, 'Join a friend'),
        h('div', { class: 'row' }, code, h('button', { onclick: join, style: { flex: '0 0 auto' } }, 'Join')),
        this.statusEl,
        this.errEl,
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { onclick: () => this.openLeaderboard() }, 'Leaderboards'), h('button', { onclick: () => this._back() }, 'Back')),
      ),
    );
  }

  _createScreen() {
    const track = this._trackSelect();
    const laps = h('select', { 'aria-label': 'Laps' }, [1, 2, 3, 5, 7, 10].map((n) => h('option', { value: n, selected: n === 3 }, `${n} lap${n > 1 ? 's' : ''}`)));
    this.statusEl = h('div', { class: 'status' });
    this.errEl = h('div', { class: 'err', role: 'alert' });
    this._show(
      'create',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Create Room'),
        h('h3', {}, 'Track'),
        track,
        h('h3', {}, 'Laps'),
        laps,
        this.statusEl,
        this.errEl,
        h(
          'div',
          { class: 'row', style: { marginTop: '12px' } },
          h('button', { onclick: () => this.openMenu() }, 'Back'),
          h('button', { class: 'primary', onclick: () => this._run(() => this.mp.hostRoom({ trackId: track.value, laps: +laps.value })) }, 'Create'),
        ),
      ),
    );
  }

  _onLobby(force = false) {
    const s = this.mp.session;
    if (!s?.room) return;
    const phase = s.room.phase;
    if (phase === 'countdown' || phase === 'racing') {
      this.close();
      this._renderHud();
      return;
    }
    if (phase === 'results') {
      if (this.screen !== 'results') this.showResults(s.results || []);
      return;
    }
    this.hud.hidden = true;
    if (!force && this.screen !== 'lobby' && this.screen !== 'menu' && this.screen !== 'create' && this.screen !== 'results') return;
    this._renderLobby();
  }

  _renderLobby() {
    const s = this.mp.session;
    const room = s.room;
    const me = room.players.find((p) => p.id === s.selfId);
    const others = room.players.filter((p) => p.id !== s.selfId);
    const trackName = this.tracks.find((t) => t.id === room.settings.trackId)?.name || room.settings.trackId;

    const header = room.quick
      ? h('div', {}, h('h2', {}, 'Quick Match'), (this.autoEl = h('div', { class: 'muted' })))
      : h(
          'div',
          {},
          h('div', { class: 'muted' }, 'Room code'),
          h(
            'div',
            { class: 'row', style: { alignItems: 'center' } },
            h('span', { class: 'code' }, room.code),
            h('button', { class: 'small', style: { flex: '0 0 auto' }, onclick: () => this._copy(room.code, 'Code copied') }, 'Copy'),
            h('button', { class: 'small', style: { flex: '0 0 auto' }, onclick: () => this._copy(`${location.origin}${location.pathname}?room=${room.code}`, 'Invite link copied') }, 'Invite link'),
          ),
        );

    const list = h(
      'ul',
      { class: 'players' },
      room.players.map((p) =>
        h(
          'li',
          {},
          h('span', { class: 'sw', style: { background: p.color } }),
          h('span', { class: 'name' }, p.isHost ? `👑 ${p.name}` : p.name, p.id === s.selfId ? ' (you)' : ''),
          p.id === s.selfId && !s.isHost ? h('span', { class: 'tag' }, `${s.ping} ms`) : null,
          h('span', { class: `tag ${p.ready || p.isHost ? 'ok' : ''}` }, p.isHost ? 'host' : p.ready ? 'ready' : 'not ready'),
          s.isHost && p.id !== s.selfId && !room.quick ? h('button', { class: 'small', style: { flex: '0 0 auto' }, onclick: () => s.kick(p.id), 'aria-label': `Remove ${p.name}` }, '✕') : null,
        ),
      ),
    );

    let settings;
    if (s.isHost && !room.quick) {
      const track = this._trackSelect(room.settings.trackId);
      track.addEventListener('change', () => s.updateSettings({ trackId: track.value }));
      const laps = h('select', { 'aria-label': 'Laps' }, [1, 2, 3, 5, 7, 10].map((n) => h('option', { value: n, selected: n === room.settings.laps }, `${n} lap${n > 1 ? 's' : ''}`)));
      laps.addEventListener('change', () => s.updateSettings({ laps: +laps.value }));
      settings = h('div', { class: 'row' }, track, laps);
    } else {
      settings = h('div', { class: 'muted' }, `${trackName} · ${room.settings.laps} lap${room.settings.laps > 1 ? 's' : ''}`);
    }

    const everyoneReady = others.length > 0 && others.every((p) => p.ready);
    const actions = h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { onclick: () => this._leave() }, 'Leave'));
    if (s.isHost && !room.quick) {
      actions.append(
        h(
          'button',
          {
            class: 'primary',
            disabled: others.length === 0,
            title: others.length === 0 ? 'Waiting for players' : '',
            onclick: () => (everyoneReady || confirm('Not everyone is ready. Start anyway?')) && s.startRace(),
          },
          others.length === 0 ? 'Waiting for players…' : everyoneReady ? 'Start Race' : 'Start Anyway',
        ),
      );
    } else {
      actions.append(h('button', { class: me?.ready ? '' : 'primary', onclick: () => s.setReady(!me?.ready) }, me?.ready ? 'Not Ready' : 'Ready'));
    }

    this.chatEl = h('div', { class: 'chat', 'aria-live': 'polite' });
    this._renderChat();
    const prevDraft = this.ov.querySelector('input[aria-label="Chat message"]')?.value || '';
    const chatIn = h('input', { placeholder: 'Say something…', maxLength: 80, 'aria-label': 'Chat message', value: prevDraft });
    chatIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatIn.value.trim()) {
        s.chat(chatIn.value);
        chatIn.value = '';
      }
      e.stopPropagation(); // don't let typing drive the car
    });

    const focusedChat = this.ov.contains(document.activeElement) && document.activeElement?.getAttribute('aria-label') === 'Chat message';
    this._show('lobby', h('div', { class: 'panel' }, header, h('h3', {}, `Drivers ${room.players.length}/${this.mp.cfg.maxPlayers}`), list, h('h3', {}, 'Race'), settings, h('h3', {}, 'Chat'), this.chatEl, h('div', { class: 'row', style: { marginTop: '6px' } }, chatIn), actions));
    if (focusedChat) chatIn.focus();
    this._tick();
  }

  showResults(results) {
    const s = this.mp.session;
    this.hud.hidden = true;
    const rows = results.map((r) =>
      h(
        'tr',
        { class: `p${r.place} ${r.id === s?.selfId ? 'me' : ''}` },
        h('td', {}, r.dnf ? '–' : `${r.place}`),
        h('td', {}, h('span', { class: 'sw', style: { background: r.color, display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' } }), r.name),
        h('td', { class: 'num' }, r.dnf ? 'DNF' : this.fmt(r.totalMs)),
        h('td', { class: 'num' }, this.fmt(r.bestLapMs)),
      ),
    );
    const actions = h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { onclick: () => this._leave() }, 'Leave'));
    if (s?.isHost && !s.room.quick) actions.append(h('button', { class: 'primary', onclick: () => s.returnToLobby() }, 'Back to Lobby'));
    else actions.append(h('div', { class: 'muted' }, s?.room?.quick ? 'Next race starts soon…' : 'Waiting for host…'));
    this._show(
      'results',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Results'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Driver'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Best lap'))), h('tbody', {}, rows)),
        actions,
      ),
    );
  }

  async openLeaderboard(trackId = this.tracks[0]?.id, period = 'all') {
    const lb = this.mp.leaderboard;
    const track = this._trackSelect(trackId);
    track.addEventListener('change', () => this.openLeaderboard(track.value, period));
    const tab = (p, label) => h('button', { class: 'small', role: 'tab', 'aria-selected': String(p === period), onclick: () => this.openLeaderboard(track.value, p) }, label);
    const body = h('tbody', {}, h('tr', {}, h('td', { colSpan: 3, class: 'muted' }, 'Loading…')));
    this._show(
      'leaderboard',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Fastest Laps'),
        h('div', { class: 'tabs', role: 'tablist' }, tab('all', 'All time'), tab('week', 'This week')),
        track,
        lb.isGlobal ? null : h('div', { class: 'muted', style: { marginTop: '8px' } }, 'Local records only (global board not configured).'),
        h('table', { style: { marginTop: '10px' } }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Driver'), h('th', { class: 'num' }, 'Lap'))), body),
        h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { onclick: () => this._back() }, 'Back')),
      ),
    );
    const rows = await lb.top(trackId, { limit: 20, period });
    if (this.screen !== 'leaderboard') return;
    body.replaceChildren(
      ...(rows.length
        ? rows.map((r, i) =>
            h(
              'tr',
              { class: `p${i + 1} ${r.playerId === lb.playerId ? 'me' : ''}` },
              h('td', {}, String(i + 1)),
              h('td', {}, h('span', { class: 'sw', style: { background: r.color, display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' } }), r.name),
              h('td', { class: 'num' }, this.fmt(r.lapMs)),
            ),
          )
        : [h('tr', {}, h('td', { colSpan: 3, class: 'muted' }, 'No laps yet. Be the first!'))]),
    );
  }

  /* ---------------------------------------------------------- race HUD */

  _onCountdown(c) {
    this.close();
    this._renderHud();
    this.onRaceStart(c.settings || this.mp.room?.settings, c);
  }

  _renderHud() {
    const s = this.mp.session;
    if (!s?.room || (s.room.phase !== 'countdown' && s.room.phase !== 'racing')) {
      this.hud.hidden = true;
      return;
    }
    const racers = s.room.players.filter((p) => !p.spectator).length;
    const pos = s.order.indexOf(s.selfId) + 1;
    this.hud.replaceChildren(
      h('div', { class: 'pos' }, pos ? `P${pos}` : 'P–', h('small', {}, `/${racers}`)),
      s.isHost ? null : h('div', { class: 'ping' }, `${s.ping} ms`),
    );
    this.hud.hidden = false;
  }

  _tick() {
    const room = this.mp.session?.room;
    if (this.autoEl && room?.quick && this.screen === 'lobby') {
      if (room.autoStartAt) {
        const secs = Math.max(0, Math.ceil((room.autoStartAt - this.mp.session.hostNow()) / 1000));
        this.autoEl.textContent = `Race starts in ${secs}s (or when everyone is ready)`;
      } else {
        this.autoEl.textContent = 'Waiting for another driver to join…';
      }
    }
  }

  _toast(text) {
    const el = h('div', { class: 'toast' }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 4000);
  }

  /* ---------------------------------------------------------- chat */

  _onChat(m) {
    this.chatLog.push(m);
    if (this.chatLog.length > 30) this.chatLog.shift();
    if (this.screen === 'lobby') this._renderChat();
    else if (this.mp.session?.room?.phase === 'racing') this._toast(`${m.name}: ${m.text}`);
  }

  _renderChat() {
    if (!this.chatEl) return;
    const colors = new Map((this.mp.session?.room?.players || []).map((p) => [p.id, p.color]));
    this.chatEl.replaceChildren(...this.chatLog.map((m) => h('div', {}, h('b', { style: { color: colors.get(m.id) || 'inherit' } }, m.name), m.text)));
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  /* ---------------------------------------------------------- helpers */

  _trackSelect(selected) {
    return h('select', { 'aria-label': 'Track' }, this.tracks.map((t) => h('option', { value: t.id, selected: t.id === selected }, t.name)));
  }

  async _run(fn) {
    this._setError('');
    try {
      await fn();
      this.chatLog = [];
      this._renderLobby();
    } catch {
      /* error already shown via the 'error' event */
    }
  }

  _leave() {
    this.mp.leave();
    this.chatLog = [];
    this.openMenu();
  }

  async _copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      this._toast(done);
    } catch {
      prompt('Copy this:', text);
    }
  }

  _setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.replaceChildren(...(text ? [h('span', { class: 'spin' }), h('span', {}, text)] : []));
    this.ov.querySelectorAll('button').forEach((b) => (b.disabled = !!text && b.textContent !== 'Back'));
  }

  _setError(text) {
    if (this.errEl) this.errEl.textContent = text || '';
  }
}
