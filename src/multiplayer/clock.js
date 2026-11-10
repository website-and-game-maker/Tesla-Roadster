/**
 * Estimates the offset between our clock and the host's clock.
 *
 * Every ping gives one sample: we sent at t0, the host stamped th, we got
 * the reply at t1. Assuming the trip is symmetric, the host's clock read th
 * at our local time (t0 + t1) / 2, so offset = th - (t0 + t1) / 2.
 *
 * Samples with a big round trip are the least trustworthy (asymmetric
 * queuing), so we keep a window and average only the fastest third.
 */
export class ClockSync {
  constructor(windowSize = 16) {
    this.windowSize = windowSize;
    this.samples = [];
    this.offset = 0;
    this.rtt = 0;
  }

  addSample(t0, hostTime, t1) {
    const rtt = t1 - t0;
    if (rtt < 0) return;
    this.samples.push({ rtt, offset: hostTime - (t0 + t1) / 2 });
    if (this.samples.length > this.windowSize) this.samples.shift();

    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
    this.offset = best.reduce((s, x) => s + x.offset, 0) / best.length;
    // Display RTT: median of the window, so one spike doesn't swing the ping meter.
    this.rtt = sorted[Math.floor(sorted.length / 2)].rtt;
  }

  get synced() {
    return this.samples.length >= 3;
  }

  /** Convert local time to host time. */
  toHost(localMs) {
    return localMs + this.offset;
  }

  toLocal(hostMs) {
    return hostMs - this.offset;
  }
}
