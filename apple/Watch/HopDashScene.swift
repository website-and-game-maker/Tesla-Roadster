import SpriteKit
import WatchKit

/// Side-on view of the shared hop rules (Shared/HopCore.swift) for the watch screen.
/// The Roadster sits at the left; the sky road, its gaps, barriers and rings stream in from the right.
final class HopDashScene: SKScene {
    enum State { case title, playing, over }

    var onChange: ((_ score: Int, _ lives: Int, _ rings: Int, _ state: State) -> Void)?
    var throttle = 0.0   // -1...1 from the Digital Crown

    private(set) var state: State = .title
    private var run = HopRun(config: .watch)
    private var tapQueued = false
    private var last: TimeInterval = 0
    private let world = SKNode()
    private let car = SKNode()
    private let flame = SKShapeNode()
    private var nodes: [Int: SKNode] = [:]
    private var roadLength: [Int: Double] = [:]
    private var stars: [SKShapeNode] = []

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.06, green: 0.08, blue: 0.2, alpha: 1)
        if car.parent == nil { build() }
        run.start()   // attract mode until the first tap
    }

    // metres to points: about 40 m of road ahead of the car fits on screen
    private var ppm: CGFloat { max(1, size.width / 52) }
    private var carX: CGFloat { size.width * 0.22 }
    private var roadY: CGFloat { size.height * 0.3 }

    private func build() {
        let glow = SKShapeNode(rectOf: CGSize(width: 2000, height: 50))
        glow.fillColor = UIColor(red: 0.95, green: 0.45, blue: 0.4, alpha: 0.3)
        glow.strokeColor = .clear
        glow.position = CGPoint(x: 0, y: 4)
        glow.zPosition = -5
        addChild(glow)
        for _ in 0..<24 {
            let s = SKShapeNode(circleOfRadius: CGFloat.random(in: 0.5...1.3))
            s.fillColor = UIColor(white: 1, alpha: CGFloat.random(in: 0.3...0.9))
            s.strokeColor = .clear
            s.position = CGPoint(x: CGFloat.random(in: 0...max(size.width, 1)),
                                 y: CGFloat.random(in: size.height * 0.45...max(size.height, 1)))
            s.zPosition = -4
            addChild(s)
            stars.append(s)
        }
        addChild(world)

        // the Roadster, side view, wheels on the road at y = 0
        let body = SKShapeNode(path: Self.carPath())
        body.fillColor = UIColor(red: 0.9, green: 0.08, blue: 0.16, alpha: 1)
        body.strokeColor = UIColor(red: 1, green: 0.5, blue: 0.55, alpha: 1)
        body.lineWidth = 0.8
        let canopy = SKShapeNode(ellipseOf: CGSize(width: 10, height: 4))
        canopy.fillColor = UIColor(white: 0.08, alpha: 1)
        canopy.strokeColor = .clear
        canopy.position = CGPoint(x: 1, y: 8)
        for wx: CGFloat in [-8, 9] {
            let wheel = SKShapeNode(circleOfRadius: 2.6)
            wheel.fillColor = UIColor(white: 0.05, alpha: 1)
            wheel.strokeColor = UIColor(white: 0.5, alpha: 1)
            wheel.lineWidth = 0.6
            wheel.position = CGPoint(x: wx, y: 2.6)
            car.addChild(wheel)
        }
        // jet flame under the tail, pointing down and back
        flame.path = CGPath(ellipseIn: CGRect(x: -4, y: -12, width: 6, height: 12), transform: nil)
        flame.fillColor = UIColor(red: 0.5, green: 0.9, blue: 1, alpha: 0.9)
        flame.strokeColor = .clear
        flame.blendMode = .add
        flame.position = CGPoint(x: -11, y: 4)
        flame.zRotation = -0.5
        car.addChild(flame)
        car.addChild(body)
        car.addChild(canopy)
        car.zPosition = 1
        addChild(car)
    }

    private static func carPath() -> CGPath {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: -14, y: 2))
        p.addQuadCurve(to: CGPoint(x: -12, y: 8), control: CGPoint(x: -16, y: 6))
        p.addQuadCurve(to: CGPoint(x: 6, y: 10), control: CGPoint(x: -2, y: 13))
        p.addQuadCurve(to: CGPoint(x: 18, y: 4), control: CGPoint(x: 15, y: 8))
        p.addQuadCurve(to: CGPoint(x: -14, y: 2), control: CGPoint(x: 2, y: 0))
        p.closeSubpath()
        return p
    }

    func tap() {
        switch state {
        case .title, .over:
            nodes.values.forEach { $0.removeFromParent() }
            nodes.removeAll()
            roadLength.removeAll()
            run = HopRun(config: .watch)
            run.start()
            state = .playing
            onChange?(run.score, run.lives, run.rings, state)
        case .playing:
            tapQueued = true
        }
    }

    override func update(_ currentTime: TimeInterval) {
        let dt = last == 0 ? 1.0 / 30 : min(0.1, currentTime - last)
        last = currentTime

        if state == .playing {
            let events = run.step(dt, HopInput(tap: tapQueued, throttle: throttle))
            tapQueued = false
            for e in events {
                switch e {
                case .takeoff: WKInterfaceDevice.current().play(.click)
                case .ring: WKInterfaceDevice.current().play(.success)
                case .crashed, .fell: WKInterfaceDevice.current().play(.failure)
                case .gameOver: WKInterfaceDevice.current().play(.notification)
                case .landed: break
                }
                if e != .landed && e != .takeoff { onChange?(run.score, run.lives, run.rings, run.state == .over ? .over : .playing) }
            }
            if run.state == .over { state = .over }
        } else if state == .title {
            run.step(dt, run.autopilot(tapOnly: true))
            if run.state == .over { run = HopRun(config: .watch); run.start() }
        }
        draw(time: currentTime)
    }

    private func screenX(_ s: Double) -> CGFloat { carX + CGFloat(s - run.s) * ppm }

    private func draw(time: TimeInterval) {
        let k = ppm
        car.position = CGPoint(x: carX, y: roadY + CGFloat(run.y) * k)
        car.zRotation = CGFloat(max(-0.4, min(0.4, run.vy * 0.04)))
        car.alpha = run.safe > 0 ? 0.5 + 0.5 * abs(sin(time * 14)) : 1
        flame.isHidden = !run.burning
        flame.yScale = 1 + 0.15 * sin(time * 40)

        var alive = Set<Int>()
        for f in run.features {
            alive.insert(f.id)
            switch f.kind {
            case .road:
                let len = f.end - f.start
                guard len > 0.5 else { continue }
                if roadLength[f.id] != len {
                    nodes[f.id]?.removeFromParent()
                    let w = CGFloat(len) * k
                    let deck = SKShapeNode(rect: CGRect(x: 0, y: -8, width: w, height: 8), cornerRadius: 1.5)
                    deck.fillColor = UIColor(white: 0.22, alpha: 1)
                    deck.strokeColor = UIColor(red: 0.2, green: 0.9, blue: 1, alpha: 1)
                    deck.lineWidth = 1
                    world.addChild(deck)
                    nodes[f.id] = deck
                    roadLength[f.id] = len
                }
                nodes[f.id]?.position = CGPoint(x: screenX(f.start), y: roadY)
            case .barrier:
                if nodes[f.id] == nil {
                    let b = SKShapeNode(rect: CGRect(x: 0, y: 0, width: CGFloat(run.config.barrierLength) * k,
                                                     height: CGFloat(run.config.barrierHeight) * k), cornerRadius: 1)
                    b.fillColor = UIColor(red: 0.95, green: 0.4, blue: 0.1, alpha: 1)
                    b.strokeColor = UIColor(red: 1, green: 0.9, blue: 0.3, alpha: 1)
                    b.lineWidth = 1
                    world.addChild(b)
                    nodes[f.id] = b
                }
                nodes[f.id]?.position = CGPoint(x: screenX(f.start), y: roadY)
            case .ring:
                if nodes[f.id] == nil {
                    let r = CGFloat(run.config.ringRadius) * k
                    let ring = SKShapeNode(ellipseOf: CGSize(width: r * 0.7, height: r * 2))
                    ring.strokeColor = UIColor(red: 0.3, green: 0.95, blue: 1, alpha: 1)
                    ring.lineWidth = 2
                    ring.zPosition = 2
                    world.addChild(ring)
                    nodes[f.id] = ring
                }
                if let n = nodes[f.id] {
                    n.position = CGPoint(x: screenX(f.start), y: roadY + CGFloat(f.height) * k)
                    if f.taken && n.alpha == 1 { n.run(.group([.scale(to: 1.6, duration: 0.25), .fadeOut(withDuration: 0.25)])) }
                }
            }
        }
        for (id, n) in nodes where !alive.contains(id) {
            n.removeFromParent()
            nodes[id] = nil
            roadLength[id] = nil
        }
        for s in stars {
            s.position.x -= CGFloat(run.speed) * 0.01
            if s.position.x < -2 { s.position.x = size.width + 2 }
        }
    }
}
