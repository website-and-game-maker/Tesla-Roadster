import SpriteKit
import WatchKit

/// Side-on flight: the Roadster stays at the left, rings stream in from the right.
final class RingDashScene: SKScene {
    enum State { case title, playing, over }

    var onChange: ((Int, Int, State) -> Void)?
    var targetHeight: CGFloat = 0.5   // 0...1 from the Digital Crown

    private(set) var state: State = .title
    private var score = 0, lives = 3, combo = 0
    private var last: TimeInterval = 0
    private let car = SKNode()
    private let flame = SKShapeNode()
    private var rings: [(back: SKShapeNode, front: SKShapeNode, gap: CGFloat, done: Bool)] = []
    private var stars: [SKShapeNode] = []
    private var speedX: CGFloat = 60
    private var boostT: TimeInterval = 0
    private var charge: CGFloat = 1
    private var spawnIn: CGFloat = 0
    private var ringCount = 0

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.06, green: 0.08, blue: 0.2, alpha: 1)
        if car.parent == nil { build() }
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        car.position.x = size.width * 0.25
    }

    private func build() {
        // horizon glow
        let glow = SKShapeNode(rectOf: CGSize(width: 2000, height: 60))
        glow.fillColor = UIColor(red: 0.95, green: 0.45, blue: 0.4, alpha: 0.35)
        glow.strokeColor = .clear
        glow.position = CGPoint(x: 0, y: 10)
        glow.zPosition = -5
        addChild(glow)
        for _ in 0..<24 {
            let s = SKShapeNode(circleOfRadius: CGFloat.random(in: 0.5...1.3))
            s.fillColor = UIColor(white: 1, alpha: CGFloat.random(in: 0.3...0.9))
            s.strokeColor = .clear
            s.position = CGPoint(x: CGFloat.random(in: 0...max(size.width, 1)), y: CGFloat.random(in: size.height * 0.3...max(size.height, 1)))
            s.zPosition = -4
            addChild(s)
            stars.append(s)
        }
        // the flying Roadster, side view
        let body = SKShapeNode(path: Self.carPath())
        body.fillColor = UIColor(red: 0.9, green: 0.08, blue: 0.16, alpha: 1)
        body.strokeColor = UIColor(red: 1, green: 0.5, blue: 0.55, alpha: 1)
        body.lineWidth = 0.8
        let canopy = SKShapeNode(ellipseOf: CGSize(width: 12, height: 5))
        canopy.fillColor = UIColor(white: 0.08, alpha: 1)
        canopy.strokeColor = .clear
        canopy.position = CGPoint(x: 1, y: 4)
        flame.path = CGPath(ellipseIn: CGRect(x: -26, y: -3, width: 14, height: 5), transform: nil)
        flame.fillColor = UIColor(red: 0.5, green: 0.9, blue: 1, alpha: 0.9)
        flame.strokeColor = .clear
        flame.blendMode = .add
        car.addChild(flame)
        car.addChild(body)
        car.addChild(canopy)
        car.zPosition = 1
        car.position = CGPoint(x: size.width * 0.25, y: size.height * 0.5)
        addChild(car)
    }

    private static func carPath() -> CGPath {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: -14, y: -3))
        p.addQuadCurve(to: CGPoint(x: -12, y: 4), control: CGPoint(x: -16, y: 2))
        p.addQuadCurve(to: CGPoint(x: 6, y: 6), control: CGPoint(x: -2, y: 9))
        p.addQuadCurve(to: CGPoint(x: 18, y: -1), control: CGPoint(x: 15, y: 4))
        p.addQuadCurve(to: CGPoint(x: -14, y: -3), control: CGPoint(x: 2, y: -6))
        p.closeSubpath()
        return p
    }

    func tap() {
        switch state {
        case .title, .over:
            start()
        case .playing:
            if charge > 0.3 && boostT <= 0 {
                boostT = 1.2
                charge -= 0.3
                WKInterfaceDevice.current().play(.start)
            }
        }
    }

    private func start() {
        rings.forEach { $0.back.removeFromParent(); $0.front.removeFromParent() }
        rings.removeAll()
        score = 0; lives = 3; combo = 0; charge = 1; boostT = 0; speedX = 60; spawnIn = 20; ringCount = 0
        state = .playing
        onChange?(score, lives, state)
    }

    private func spawnRing() {
        let h = size.height
        let gap = max(14, 24 - CGFloat(score) * 0.15)
        // the next ring is reachable from the last one: keep the height change moderate
        let lastY = rings.last?.back.position.y ?? h * 0.5
        let y = min(h * 0.82, max(h * 0.2, lastY + CGFloat.random(in: -h * 0.3...h * 0.3)))
        let back = SKShapeNode(path: CGPath(ellipseIn: CGRect(x: -5, y: -gap, width: 10, height: gap * 2), transform: nil))
        back.strokeColor = UIColor(red: 0.2, green: 0.9, blue: 1, alpha: 0.55)
        back.lineWidth = 2.5
        back.zPosition = 0
        // the front half of the ring is drawn over the car so it looks like you fly through it
        let fp = CGMutablePath()
        fp.addArc(center: .zero, radius: 1, startAngle: -.pi / 2, endAngle: .pi / 2, clockwise: false,
                  transform: CGAffineTransform(scaleX: 5, y: gap))
        let front = SKShapeNode(path: fp)
        front.strokeColor = UIColor(red: 0.3, green: 0.95, blue: 1, alpha: 1)
        front.lineWidth = 3
        front.zPosition = 2
        let x = size.width + 12
        back.position = CGPoint(x: x, y: y)
        front.position = CGPoint(x: x, y: y)
        addChild(back)
        addChild(front)
        rings.append((back, front, gap, false))
        ringCount += 1
    }

    override func update(_ currentTime: TimeInterval) {
        let dt = CGFloat(last == 0 ? 1.0 / 30 : min(0.1, currentTime - last))
        last = currentTime
        let h = size.height
        let playing = state == .playing

        // car follows the crown, nose pitching with the climb
        let wantY = h * (0.15 + 0.7 * targetHeight)
        let dy = (wantY - car.position.y) * min(1, dt * 5)
        car.position.y += dy
        car.zRotation = max(-0.5, min(0.5, dy * 0.25))
        if boostT > 0 { boostT -= Double(dt) }
        flame.xScale = boostT > 0 ? 1.8 : 1 + 0.1 * sin(CGFloat(currentTime) * 30)

        let base = min(120, 60 + CGFloat(score) * 0.8)
        speedX += ((playing ? base : 30) * (boostT > 0 ? 1.6 : 1) - speedX) * min(1, dt * 3)
        for s in stars {
            s.position.x -= speedX * dt * 0.15
            if s.position.x < -2 { s.position.x = size.width + 2 }
        }
        guard playing else { return }

        spawnIn -= speedX * dt
        if spawnIn <= 0 { spawnRing(); spawnIn = max(60, 95 - CGFloat(score) * 0.4) }
        charge = min(1, charge + dt * 0.02)

        let cx = car.position.x
        for i in rings.indices {
            rings[i].back.position.x -= speedX * dt
            rings[i].front.position.x = rings[i].back.position.x
            if !rings[i].done && rings[i].back.position.x <= cx {
                rings[i].done = true
                let off = abs(rings[i].back.position.y - car.position.y)
                if off <= rings[i].gap * 0.85 {
                    combo += 1
                    score += 1 + min(combo - 1, 4) + (boostT > 0 ? 1 : 0)
                    charge = min(1, charge + 0.1)
                    rings[i].front.run(.fadeOut(withDuration: 0.25))
                    WKInterfaceDevice.current().play(.click)
                } else {
                    combo = 0
                    lives -= 1
                    rings[i].back.strokeColor = .red
                    rings[i].front.strokeColor = .red
                    WKInterfaceDevice.current().play(.failure)
                    if lives <= 0 {
                        state = .over
                        WKInterfaceDevice.current().play(.notification)
                    }
                }
                onChange?(score, lives, state)
            }
        }
        rings.removeAll { r in
            if r.back.position.x < -20 { r.back.removeFromParent(); r.front.removeFromParent(); return true }
            return false
        }
    }
}
