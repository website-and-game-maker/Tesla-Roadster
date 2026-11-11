/** Tiny event emitter so the module has zero dependencies. */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(event, fn) {
    this._handlers.get(event)?.delete(fn);
  }

  emit(event, ...args) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[multiplayer] handler for "${event}" threw`, err);
      }
    }
  }
}
