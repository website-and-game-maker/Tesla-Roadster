// Shared rules for the Apple TV and Apple Watch mini-games.
// The Roadster drives a road full of gaps and barriers and clears them with short jet hops,
// the same way it flies in the main game: bursts of thrust, never sustained flight.
// Pure Swift (Foundation only) so the same file is unit-tested on any machine.
import Foundation

/// Tunables. `tv` has three lanes; `watch` is a single lane with tap-sized hops.
public struct HopConfig {
    public var lanes = 3
    public var laneWidth = 4.2
    public var gravity = 22.0          // m/s²
    public var jetAccel = 28.0         // upward push while the jet burns (net climb = jetAccel - gravity)
    public var tankBurn = 1.0 / 0.5    // a full tank burns for 0.5 s: a hop, not a flight
    public var popSpeed = 5.0          // the kick upward when the jet lights on the road
    public var tankRefill = 1.1        // per second, only while the wheels are on the road
    public var tapBurn = 0.34          // a tap burns this long (watch taps and quick remote clicks)
    public var startSpeed = 24.0       // m/s
    public var topSpeed = 48.0
    public var rampDistance = 4000.0   // metres to go from start to top speed
    public var throttleRange = 0.25    // throttle -1...1 changes speed by ±25%
    public var lives = 3
    public var ringRadius = 1.7
    public var barrierHeight = 1.2
    public var barrierLength = 1.6
    public var fallDepth = 7.0         // below the road this far = lost a life
    public var safeTime = 1.5          // seconds of grace after a respawn

    public init() {}
    public static let tv = HopConfig()
    public static var watch: HopConfig {
        var c = HopConfig()
        c.lanes = 1
        c.startSpeed = 20
        c.topSpeed = 38
        c.tapBurn = 0.45
        return c
    }
}

public struct HopInput {
    public var jet = false        // held: burn while held (tank permitting)
    public var tap = false        // one-shot: burn for `tapBurn` seconds
    public var laneDelta = 0      // one-shot: -1 left, +1 right
    public var throttle = 0.0     // -1...1
    public init(jet: Bool = false, tap: Bool = false, laneDelta: Int = 0, throttle: Double = 0) {
        self.jet = jet; self.tap = tap; self.laneDelta = laneDelta; self.throttle = throttle
    }
}

public enum HopEvent: Equatable {
    case takeoff, landed, ring(combo: Int), crashed, fell, gameOver
}

public struct Feature: Identifiable {
    public enum Kind: Equatable { case road, barrier, ring }
    public let id: Int
    public let kind: Kind
    public let start: Double      // metres along the course
    public let end: Double
    public let lane: Int          // 0..<lanes (road pieces span every lane: -1)
    public let height: Double     // ring centre height above the road
    public internal(set) var taken = false
}

/// Small seeded generator so a seed always builds the same course (tests rely on this).
public struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    public init(seed: UInt64) { state = seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

public final class HopRun {
    public enum State { case ready, playing, over }

    public let config: HopConfig
    public private(set) var state: State = .ready
    public private(set) var s = 0.0            // distance along the course
    public private(set) var y = 0.0            // height above the road
    public private(set) var vy = 0.0
    public private(set) var speed: Double
    public private(set) var lane: Int
    public private(set) var x = 0.0            // smoothed sideways position in metres
    public private(set) var tank = 1.0
    public private(set) var burning = false
    public private(set) var onGround = true
    public private(set) var lives: Int
    public private(set) var rings = 0
    public private(set) var combo = 0
    public private(set) var bestCombo = 0
    public private(set) var hops = 0
    public private(set) var safe = 0.0         // grace time left after a respawn
    public private(set) var features: [Feature] = []

    private var rng: SplitMix64
    private var nextId = 0
    private var builtTo = 0.0
    private var tapLeft = 0.0

    public init(config: HopConfig = .tv, seed: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) {
        self.config = config
        rng = SplitMix64(seed: seed)
        speed = config.startSpeed
        lives = config.lives
        lane = config.lanes / 2
        x = laneX(lane)
        addFeature(.road, start: -60, end: 90)   // a long, clean runway to start on
        builtTo = 90
        build(upTo: 400)
    }

    public var score: Int { Int(s / 10) + rings * 10 + bestCombo * 5 }
    public var difficulty: Double { min(1, max(0, s / config.rampDistance)) }
    public var baseSpeed: Double { config.startSpeed + (config.topSpeed - config.startSpeed) * difficulty }
    public func laneX(_ l: Int) -> Double { (Double(l) - Double(config.lanes - 1) / 2) * config.laneWidth }

    public func start() { if state == .ready { state = .playing } }

    // MARK: course

    private func addFeature(_ k: Feature.Kind, start: Double, end: Double, lane: Int = -1, height: Double = 0) {
        features.append(Feature(id: nextId, kind: k, start: start, end: end, lane: lane, height: height))
        nextId += 1
    }

    private func rand(_ r: ClosedRange<Double>) -> Double { Double.random(in: r, using: &rng) }
    private func randLane() -> Int { Int.random(in: 0..<config.lanes, using: &rng) }

    /// Appends road pieces with gaps, barriers and rings until `limit`.
    /// Every gap is short enough to clear at the slowest throttle, and every runway is long
    /// enough to refill the tank, so a course can always be finished by a careful driver.
    /// Seconds in the air for the longest hop (a full tank burnt from the road).
    public var hopAirTime: Double {
        let c = config, burn = 1 / c.tankBurn, a = c.jetAccel - c.gravity
        let v = c.popSpeed + a * burn, yb = c.popSpeed * burn + 0.5 * a * burn * burn
        let peak = yb + v * v / (2 * c.gravity)
        return burn + v / c.gravity + (2 * peak / c.gravity).squareRoot()
    }

    private func build(upTo limit: Double) {
        let air = hopAirTime
        let refill = 0.85 / config.tankRefill
        while builtTo < limit {
            let d = min(1, builtTo / config.rampDistance)
            let v = config.startSpeed + (config.topSpeed - config.startSpeed) * d
            let fast = v * (1 + config.throttleRange)
            let landing = fast * air * 0.8       // where the last hop comes down
            let settle = v * (refill + 0.35)     // refill the tank and react
            var cursor = builtTo + landing + settle * (1 - 0.3 * d)
            let roll = rand(0...1)
            if roll < 0.35 && config.lanes > 1 {
                // barriers block one or two lanes and leave one open, with a ring in the open lane
                let open = randLane()
                for l in 0..<config.lanes where l != open && rand(0...1) < 0.75 {
                    addFeature(.barrier, start: cursor, end: cursor + config.barrierLength, lane: l)
                }
                addFeature(.ring, start: cursor, end: cursor, lane: open, height: rand(1.6...2.6))
                cursor += config.barrierLength + v * 0.6
            } else if roll < 0.55 {
                // one barrier to hop, with a ring above it for a clean, high hop
                let l = randLane()
                addFeature(.barrier, start: cursor, end: cursor + config.barrierLength, lane: l)
                addFeature(.ring, start: cursor + config.barrierLength / 2, end: cursor + config.barrierLength / 2,
                           lane: l, height: rand(2.6...3.6))
                cursor += config.barrierLength + landing + settle
            } else if roll < 0.7 {
                // a ring trail low over the road
                let l = randLane()
                for i in 0..<3 { addFeature(.ring, start: cursor + Double(i) * 7, end: cursor + Double(i) * 7, lane: l, height: 1.4) }
                cursor += 14 + v * 0.5
            }
            let roadEnd = cursor + v * rand(0.3...0.9) * (1 - 0.5 * d)
            // the gap: always shorter than the slowest full hop
            let reach = v * (1 - config.throttleRange) * air
            let gap = min(reach * 0.6, 9 + 14 * d + rand(0...8))
            addFeature(.ring, start: roadEnd + gap / 2, end: roadEnd + gap / 2,
                       lane: randLane(), height: rand(3.0...4.2))
            closeRoad(at: roadEnd)
            builtTo = roadEnd + gap
            addFeature(.road, start: builtTo, end: builtTo)   // extended on the next pass
        }
    }

    private func closeRoad(at end: Double) {
        if let i = features.lastIndex(where: { $0.kind == .road }) {
            let f = features[i]
            features[i] = Feature(id: f.id, kind: .road, start: f.start, end: max(f.end, end), lane: -1, height: 0)
        }
    }

    public func roadUnder(_ at: Double) -> Bool {
        features.contains { $0.kind == .road && at >= $0.start && at <= $0.end }
    }

    /// The next stretch without road ahead of `at` (start, end), if any is built.
    public func nextGap(after at: Double) -> (start: Double, end: Double)? {
        let roads = features.filter { $0.kind == .road }.sorted { $0.start < $1.start }
        for (i, r) in roads.enumerated() where r.end >= at && i + 1 < roads.count {
            return (r.end, roads[i + 1].start)
        }
        return nil
    }

    // MARK: simulation

    @discardableResult
    public func step(_ dt: Double, _ input: HopInput) -> [HopEvent] {
        guard state == .playing, dt > 0 else { return [] }
        var events: [HopEvent] = []
        let dt = min(dt, 0.05)

        if input.laneDelta != 0 { lane = max(0, min(config.lanes - 1, lane + input.laneDelta)) }
        x += (laneX(lane) - x) * min(1, dt * 9)

        let throttle = max(-1, min(1, input.throttle))
        let want = baseSpeed * (1 + throttle * config.throttleRange)
        speed += (want - speed) * min(1, dt * 2.5)
        if safe > 0 { safe -= dt }

        // jet: hold, or a tap that burns for a fixed short time
        if input.tap { tapLeft = config.tapBurn }
        let wantsJet = input.jet || tapLeft > 0
        tapLeft = max(0, tapLeft - dt)
        burning = wantsJet && tank > 0 && y > -1
        if burning {
            if onGround { onGround = false; hops += 1; events.append(.takeoff); vy = max(vy, config.popSpeed) }
            tank = max(0, tank - config.tankBurn * dt)
            vy += (config.jetAccel - config.gravity) * dt
            if tank == 0 { tapLeft = 0 }
        } else if onGround {
            tank = min(1, tank + config.tankRefill * dt)
        }

        let prevS = s, prevY = y
        s += speed * dt
        let overRoad = roadUnder(s)
        if !onGround || !overRoad {
            if !burning { vy -= config.gravity * dt }
            y += vy * dt
            if onGround && !overRoad { onGround = false }   // drove off the edge
            if y <= 0 && prevY >= -0.05 && overRoad && vy <= 0 {
                y = 0; vy = 0; onGround = true; events.append(.landed)
            }
        }

        // barriers in this lane
        if safe <= 0 {
            for f in features where f.kind == .barrier && f.lane == lane && s >= f.start && prevS <= f.end {
                if y < config.barrierHeight && abs(x - laneX(lane)) < config.laneWidth * 0.6 {
                    events.append(.crashed)
                    loseLife(respawnAt: f.end + 2, &events)
                    break
                }
            }
        }

        // rings crossed this frame
        for i in features.indices where features[i].kind == .ring && !features[i].taken {
            let f = features[i]
            guard f.start > prevS && f.start <= s else { continue }
            let dx = x - laneX(f.lane), dy = y + 0.5 - f.height   // 0.5: the car's centre above its wheels
            if (dx * dx + dy * dy).squareRoot() <= config.ringRadius {
                features[i].taken = true
                rings += 1
                combo += 1
                bestCombo = max(bestCombo, combo)
                tank = min(1, tank + 0.25)                    // a ring tops the jet up a little
                events.append(.ring(combo: combo))
            } else if abs(dx) < config.laneWidth / 2 {
                combo = 0                                     // missed it: no penalty, just the combo
            }
        }

        if y < -config.fallDepth {
            events.append(.fell)
            let back = nextGap(after: s - 80).map { $0.start - speed * 0.9 } ?? s
            loseLife(respawnAt: back, &events)
        }

        build(upTo: s + 500)
        features.removeAll { $0.end < s - 120 }
        return events
    }

    private func loseLife(respawnAt at: Double, _ events: inout [HopEvent]) {
        lives -= 1
        combo = 0
        if lives <= 0 {
            state = .over
            events.append(.gameOver)
            return
        }
        s = at
        if !roadUnder(s), let r = features.first(where: { $0.kind == .road && $0.end > at }) { s = r.start + 1 }
        y = 0; vy = 0; onGround = true; tank = 1; tapLeft = 0
        speed = baseSpeed * 0.8
        safe = config.safeTime
    }

    // MARK: autopilot

    /// A careful driver used by the tests and by the title-screen attract mode.
    public func autopilot(tapOnly: Bool = false) -> HopInput {
        var input = HopInput()
        let reactAt = speed * 0.22
        let blocking = features.first {
            $0.kind == .barrier && $0.lane == lane && $0.end > s && $0.start - s < speed * 1.2
        }
        if blocking != nil, config.lanes > 1 {
            let open = (0..<config.lanes).filter { l in
                !features.contains { $0.kind == .barrier && $0.lane == l && $0.end > s - 2 && $0.start - s < speed * 1.2 }
            }
            if let best = open.min(by: { abs($0 - lane) < abs($1 - lane) }) {
                input.laneDelta = best > lane ? 1 : (best < lane ? -1 : 0)
            }
        } else if let ring = features.first(where: { $0.kind == .ring && !$0.taken && $0.start > s + 4 && $0.start - s < speed * 1.5 }),
                  ring.lane != lane, config.lanes > 1 {
            let step = ring.lane > lane ? 1 : -1
            let blocked = features.contains { $0.kind == .barrier && $0.lane == lane + step && $0.end > s - 2 && $0.start - s < speed * 1.2 }
            if !blocked { input.laneDelta = step }
        }
        if abs(x - laneX(lane)) > 0.3 { input.laneDelta = 0 }   // finish one lane change first

        var needHop = false
        let nearEdge = nextGap(after: s).map { $0.start - s < speed * 0.08 } ?? false
        if let gap = nextGap(after: s), gap.start - s < reactAt, gap.start - s > -2 { needHop = true }
        if let b = features.first(where: { $0.kind == .barrier && $0.lane == lane && $0.end > s }),
           b.start - s < speed * 0.3, b.start - s > 0 { needHop = true }
        if onGround && needHop && (tank > 0.85 || nearEdge) {
            if tapOnly { input.tap = true } else { input.jet = true }
        } else if !onGround && !tapOnly {
            input.jet = burning && vy < 9   // keep burning through the hop's short burst
        }
        return input
    }
}
