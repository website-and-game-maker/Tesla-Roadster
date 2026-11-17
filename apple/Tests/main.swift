// Autopilot tests for the shared mini-game rules (apple/Shared/HopCore.swift).
// Run: sh apple/scripts/test-logic.sh
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print((ok ? "ok   " : "FAIL ") + what)
    if !ok { failures += 1 }
}

func drive(_ cfg: HopConfig, seed: UInt64, seconds: Double, tapOnly: Bool, idle: Bool = false) -> (HopRun, [HopEvent]) {
    let run = HopRun(config: cfg, seed: seed)
    run.start()
    var all: [HopEvent] = []
    var t = 0.0
    while t < seconds && run.state == .playing {
        let input = idle ? HopInput() : run.autopilot(tapOnly: tapOnly)
        all += run.step(1.0 / 60, input)
        t += 1.0 / 60
    }
    return (run, all)
}

// 1. Courses are winnable: the careful driver survives long runs on many seeds.
for (name, cfg, tap) in [("TV", HopConfig.tv, false), ("TV taps", HopConfig.tv, true), ("Watch", HopConfig.watch, true)] {
    var deaths = 0, rings = 0, hops = 0, dist = 0.0
    for seed in 1...20 as ClosedRange<UInt64> {
        let (run, _) = drive(cfg, seed: seed, seconds: 180, tapOnly: tap)
        deaths += cfg.lives - run.lives
        rings += run.rings; hops += run.hops; dist += run.s
    }
    print("  \(name): \(deaths) lives lost over 20 runs, \(rings) rings, \(hops) hops, \(Int(dist / 20)) m per run")
    check(deaths <= 2, "\(name): autopilot survives 3-minute runs (lost \(deaths) lives in 20 runs)")
    check(rings > 20 * 5, "\(name): rings are collectable")
    check(hops > 20 * 20, "\(name): runs need lots of hops")
}

// 2. Doing nothing loses: gaps and barriers really end the run.
let (idle, idleEvents) = drive(.tv, seed: 7, seconds: 120, tapOnly: false, idle: true)
check(idle.state == .over, "Idle driver crashes or falls out of the game")
check(idleEvents.contains(.fell), "Gaps make you fall")

// 3. A hop is a short burst, not flight: holding the jet can't keep the car up.
let held = HopRun(config: .tv, seed: 3)
held.start()
var air = 0.0, peak = 0.0
for _ in 0..<600 {
    held.step(1.0 / 60, HopInput(jet: true))
    if !held.onGround { air += 1.0 / 60 }
    peak = max(peak, held.y)
    if held.onGround && air > 0 { break }
}
check(air < 2.2, "Holding the jet gives one short hop (\(String(format: "%.2f", air)) s in the air)")
check(peak > 3 && peak < 7, "Hop height is a few metres (\(String(format: "%.1f", peak)) m)")

// 4. Same seed, same course.
let a = HopRun(config: .tv, seed: 42), b = HopRun(config: .tv, seed: 42)
check(a.features.map(\.start) == b.features.map(\.start), "Courses are reproducible from a seed")

// 5. Every gap fits inside the slowest hop.
var worst = 0.0
for seed in 1...30 as ClosedRange<UInt64> {
    let r = HopRun(config: .watch, seed: seed)
    var at = 0.0
    while let g = r.nextGap(after: at) { worst = max(worst, g.end - g.start); at = g.end + 1 }
}
check(worst < 20, "Watch gaps stay short (longest \(String(format: "%.1f", worst)) m)")

print(failures == 0 ? "All mini-game tests passed." : "\(failures) test(s) failed.")
exit(failures == 0 ? 0 : 1)
