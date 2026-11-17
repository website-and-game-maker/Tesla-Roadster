import SceneKit
import GameController
import UIKit

/// Apple TV renderer and input for the shared hop rules (Shared/HopCore.swift).
/// The SceneKit renderer delegate steps the run every frame on the render thread and
/// publishes HUD values to SwiftUI on the main thread.
final class JetHopGame: NSObject, ObservableObject, SCNSceneRendererDelegate {
    enum Phase { case title, playing, over }

    // HUD state (main thread)
    @Published var phase: Phase = .title
    @Published var score = 0
    @Published var lives = 3
    @Published var combo = 0
    @Published var rings = 0
    @Published var speedKmh = 0
    @Published var tank: Double = 1
    @Published var callout = ""
    @Published var best = UserDefaults.standard.integer(forKey: "jethop.best")

    let scene = SCNScene()
    let cameraNode = SCNNode()

    // render thread state
    private var run: HopRun
    private var simPhase: Phase = .title
    private let car = SCNNode()
    private var flames: [SCNNode] = []
    private var nodes: [Int: SCNNode] = [:]
    private var roadLength: [Int: Double] = [:]
    private var props: [SCNNode] = []
    private var nextPropS = 0.0
    private let ocean = SCNNode()
    private var lastTime: TimeInterval = 0
    private var clickWasDown = false
    private var stickLane = 0          // -1/0/1 zone of the thumb or stick, for edge-triggered lane changes
    private var shake: Float = 0
    private var hudClock = 0.0
    private var calloutClock = 0.0
    private var rng = SystemRandomNumberGenerator()

    private let paint = JetHopGame.pbr(UIColor(red: 0.86, green: 0.06, blue: 0.14, alpha: 1), metal: 0.55, rough: 0.28)

    override init() {
        run = HopRun(config: .tv)
        super.init()
        buildWorld()
        buildCar()
        run.start()   // the title screen shows the autopilot driving
    }

    // MARK: world

    private static func pbr(_ color: UIColor, metal: CGFloat, rough: CGFloat) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = color
        m.metalness.contents = metal
        m.roughness.contents = rough
        return m
    }

    private static func glow(_ color: UIColor) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = color
        m.emission.contents = color
        return m
    }

    private func buildWorld() {
        let horizon = UIColor(red: 0.98, green: 0.55, blue: 0.42, alpha: 1)
        scene.background.contents = Self.skyImage()
        scene.fogStartDistance = 140
        scene.fogEndDistance = 520
        scene.fogColor = horizon

        let sun = SCNNode()
        sun.light = SCNLight()
        sun.light!.type = .directional
        sun.light!.intensity = 1100
        sun.light!.color = UIColor(red: 1, green: 0.92, blue: 0.82, alpha: 1)
        sun.eulerAngles = SCNVector3(-0.7, 0.5, 0)
        scene.rootNode.addChildNode(sun)
        let amb = SCNNode()
        amb.light = SCNLight()
        amb.light!.type = .ambient
        amb.light!.intensity = 450
        amb.light!.color = UIColor(red: 0.55, green: 0.65, blue: 1, alpha: 1)
        scene.rootNode.addChildNode(amb)

        // far below the sky road: a sea, so gaps look like real drops
        let sea = SCNPlane(width: 1600, height: 1600)
        let m = SCNMaterial()
        m.diffuse.contents = UIColor(red: 0.08, green: 0.22, blue: 0.42, alpha: 1)
        m.specular.contents = UIColor(white: 0.9, alpha: 1)
        m.shininess = 0.8
        sea.materials = [m]
        ocean.geometry = sea
        ocean.eulerAngles.x = -.pi / 2
        scene.rootNode.addChildNode(ocean)

        cameraNode.camera = SCNCamera()
        cameraNode.camera!.fieldOfView = 70
        cameraNode.camera!.zFar = 900
        cameraNode.camera!.wantsHDR = true
        cameraNode.camera!.bloomIntensity = 0.8
        cameraNode.camera!.bloomThreshold = 0.75
        scene.rootNode.addChildNode(cameraNode)
    }

    private static func skyImage() -> UIImage {
        let size = CGSize(width: 16, height: 512)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            let colors = [UIColor(red: 0.05, green: 0.09, blue: 0.24, alpha: 1).cgColor,
                          UIColor(red: 0.36, green: 0.27, blue: 0.55, alpha: 1).cgColor,
                          UIColor(red: 0.98, green: 0.55, blue: 0.42, alpha: 1).cgColor]
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 0.6, 1])!
            ctx.cgContext.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
        }
    }

    /// An original, stylised roadster with two jet pods behind the cabin. Origin: on the road.
    private func buildCar() {
        let dark = Self.pbr(UIColor(white: 0.08, alpha: 1), metal: 0.3, rough: 0.5)
        let glass = Self.pbr(UIColor(red: 0.05, green: 0.08, blue: 0.12, alpha: 1), metal: 0.9, rough: 0.05)
        let tyre = Self.pbr(UIColor(white: 0.05, alpha: 1), metal: 0, rough: 0.9)

        let body = SCNNode(geometry: SCNBox(width: 2.0, height: 0.5, length: 4.4, chamferRadius: 0.25))
        body.geometry!.materials = [paint]
        body.position = SCNVector3(0, 0.55, 0)
        car.addChildNode(body)
        let nose = SCNNode(geometry: SCNCapsule(capRadius: 0.32, height: 2.0))
        nose.geometry!.materials = [paint]
        nose.eulerAngles.z = .pi / 2
        nose.position = SCNVector3(0, 0.53, -2.15)
        car.addChildNode(nose)
        let cabin = SCNNode(geometry: SCNSphere(radius: 0.8))
        cabin.geometry!.materials = [glass]
        cabin.scale = SCNVector3(0.95, 0.42, 1.35)
        cabin.position = SCNVector3(0, 0.85, 0.1)
        car.addChildNode(cabin)
        for sx: Float in [-1, 1] {
            for sz: Float in [-1.4, 1.4] {
                let wheel = SCNNode(geometry: SCNCylinder(radius: 0.36, height: 0.3))
                wheel.geometry!.materials = [tyre]
                wheel.eulerAngles.z = .pi / 2
                wheel.position = SCNVector3(sx * 0.95, 0.36, sz)
                car.addChildNode(wheel)
            }
            let pod = SCNNode(geometry: SCNCylinder(radius: 0.3, height: 0.7))
            pod.geometry!.materials = [dark]
            pod.eulerAngles.x = .pi / 2
            pod.position = SCNVector3(sx * 0.6, 0.6, 2.15)
            car.addChildNode(pod)
            let flame = SCNNode(geometry: SCNCone(topRadius: 0.0, bottomRadius: 0.26, height: 1.8))
            let fm = Self.glow(UIColor(red: 0.45, green: 0.9, blue: 1, alpha: 1))
            fm.transparency = 0.85
            fm.blendMode = .add
            flame.geometry!.materials = [fm]
            flame.pivot = SCNMatrix4MakeTranslation(0, 0.9, 0)  // scale from the nozzle
            flame.eulerAngles.x = .pi / 2 + 0.5                   // points back and down: it lifts the car
            flame.position = SCNVector3(sx * 0.6, 0.5, 2.5)
            car.addChildNode(flame)
            flames.append(flame)
        }
        let tail = SCNNode(geometry: SCNBox(width: 1.7, height: 0.08, length: 0.05, chamferRadius: 0))
        tail.geometry!.materials = [Self.glow(UIColor(red: 1, green: 0.15, blue: 0.2, alpha: 1))]
        tail.position = SCNVector3(0, 0.65, 2.22)
        car.addChildNode(tail)
        scene.rootNode.addChildNode(car)
    }

    // MARK: course nodes

    private func roadNode(length: Double) -> SCNNode {
        let c = run.config
        let width = CGFloat(Double(c.lanes) * c.laneWidth + 1.6)
        let deck = SCNNode(geometry: SCNBox(width: width, height: 1.2, length: CGFloat(length), chamferRadius: 0.1))
        deck.geometry!.materials = [Self.pbr(UIColor(white: 0.16, alpha: 1), metal: 0.1, rough: 0.8)]
        deck.position = SCNVector3(0, -0.6, 0)
        let holder = SCNNode()
        holder.addChildNode(deck)
        // glowing edges and lane lines
        for i in 0...c.lanes {
            let x = (Double(i) - Double(c.lanes) / 2) * c.laneWidth
            let edge = i == 0 || i == c.lanes
            let line = SCNNode(geometry: SCNBox(width: edge ? 0.3 : 0.12, height: 0.04, length: CGFloat(length), chamferRadius: 0))
            line.geometry!.materials = [Self.glow(edge ? UIColor(red: 0.2, green: 0.9, blue: 1, alpha: 1) : UIColor(white: 0.85, alpha: 1))]
            line.position = SCNVector3(Float(x), 0.02, 0)
            holder.addChildNode(line)
        }
        // a support column so each road piece hangs in the sky
        let pillar = SCNNode(geometry: SCNCylinder(radius: 1.2, height: 60))
        pillar.geometry!.materials = [Self.pbr(UIColor(white: 0.3, alpha: 1), metal: 0.2, rough: 0.7)]
        pillar.position = SCNVector3(0, -31, 0)
        holder.addChildNode(pillar)
        return holder
    }

    private func barrierNode() -> SCNNode {
        let c = run.config
        let n = SCNNode(geometry: SCNBox(width: CGFloat(c.laneWidth * 0.8), height: CGFloat(c.barrierHeight),
                                         length: CGFloat(c.barrierLength), chamferRadius: 0.08))
        n.geometry!.materials = [Self.pbr(UIColor(red: 0.95, green: 0.35, blue: 0.1, alpha: 1), metal: 0.2, rough: 0.4)]
        let stripe = SCNNode(geometry: SCNBox(width: CGFloat(c.laneWidth * 0.82), height: 0.14, length: CGFloat(c.barrierLength) + 0.02, chamferRadius: 0))
        stripe.geometry!.materials = [Self.glow(UIColor(red: 1, green: 0.9, blue: 0.3, alpha: 1))]
        stripe.position = SCNVector3(0, Float(c.barrierHeight) * 0.3, 0)
        n.addChildNode(stripe)
        return n
    }

    private func ringNode() -> SCNNode {
        let torus = SCNTorus(ringRadius: CGFloat(run.config.ringRadius), pipeRadius: 0.16)
        torus.materials = [Self.glow(UIColor(red: 0.2, green: 0.9, blue: 1, alpha: 1))]
        let n = SCNNode(geometry: torus)
        n.eulerAngles.x = .pi / 2   // hole faces the driving direction
        return n
    }

    /// Adds, resizes and removes nodes so the scene matches the run's course.
    private func syncCourse() {
        var alive = Set<Int>()
        for f in run.features {
            alive.insert(f.id)
            switch f.kind {
            case .road:
                let length = f.end - f.start
                guard length > 0.5 else { continue }
                if roadLength[f.id] != length {
                    nodes[f.id]?.removeFromParentNode()
                    let n = roadNode(length: length)
                    n.simdPosition = SIMD3(0, 0, -Float((f.start + f.end) / 2))
                    scene.rootNode.addChildNode(n)
                    nodes[f.id] = n
                    roadLength[f.id] = length
                }
            case .barrier:
                if nodes[f.id] == nil {
                    let n = barrierNode()
                    n.simdPosition = SIMD3(Float(run.laneX(f.lane)), Float(run.config.barrierHeight / 2), -Float((f.start + f.end) / 2))
                    scene.rootNode.addChildNode(n)
                    nodes[f.id] = n
                }
            case .ring:
                if nodes[f.id] == nil {
                    let n = ringNode()
                    n.simdPosition = SIMD3(Float(run.laneX(f.lane)), Float(f.height), -Float(f.start))
                    scene.rootNode.addChildNode(n)
                    nodes[f.id] = n
                }
                if f.taken, let n = nodes[f.id], n.name != "taken" {
                    n.name = "taken"
                    n.runAction(.group([.scale(to: 1.8, duration: 0.3), .fadeOut(duration: 0.3)]))
                }
            }
        }
        for (id, n) in nodes where !alive.contains(id) {
            n.removeFromParentNode()
            nodes[id] = nil
            roadLength[id] = nil
        }
        // drifting islands and clouds beside the road for a sense of speed
        while nextPropS < run.s + 600 {
            makeProp(at: nextPropS)
            nextPropS += Double.random(in: 25...60, using: &rng)
        }
        props.removeAll { n in
            if n.simdPosition.z > -Float(run.s) + 60 { n.removeFromParentNode(); return true }
            return false
        }
    }

    private func clearCourse() {
        nodes.values.forEach { $0.removeFromParentNode() }
        nodes.removeAll()
        roadLength.removeAll()
        props.forEach { $0.removeFromParentNode() }
        props.removeAll()
        nextPropS = 0
    }

    private func makeProp(at s: Double) {
        let side: Float = Bool.random(using: &rng) ? 1 : -1
        let x = side * Float.random(in: 30...170, using: &rng)
        let node: SCNNode
        if Bool.random(using: &rng) {
            let rock = SCNMaterial()
            rock.diffuse.contents = UIColor(red: 0.45, green: 0.32, blue: 0.26, alpha: 1)
            let top = SCNMaterial()
            top.diffuse.contents = UIColor(red: 0.28, green: 0.55, blue: 0.3, alpha: 1)
            let r = CGFloat(Float.random(in: 8...22, using: &rng))
            let cone = SCNCone(topRadius: r, bottomRadius: r * 0.15, height: r * 1.6)
            cone.materials = [rock]
            node = SCNNode(geometry: cone)
            let cap = SCNNode(geometry: SCNCylinder(radius: r * 1.02, height: 1.5))
            cap.geometry!.materials = [top]
            cap.position = SCNVector3(0, Float(r) * 0.8, 0)
            node.addChildNode(cap)
            node.position = SCNVector3(x, Float.random(in: -40...10, using: &rng), -Float(s))
        } else {
            let white = SCNMaterial()
            white.diffuse.contents = UIColor(white: 1, alpha: 0.9)
            white.lightingModel = .lambert
            node = SCNNode()
            for _ in 0..<4 {
                let puff = SCNNode(geometry: SCNSphere(radius: CGFloat(Float.random(in: 6...12, using: &rng))))
                puff.geometry!.materials = [white]
                puff.position = SCNVector3(Float.random(in: -14...14, using: &rng), 0, Float.random(in: -8...8, using: &rng))
                puff.scale = SCNVector3(1.4, 0.55, 1)
                node.addChildNode(puff)
            }
            node.position = SCNVector3(x, Float.random(in: 15...60, using: &rng), -Float(s))
        }
        scene.rootNode.addChildNode(node)
        props.append(node)
    }

    // MARK: input

    private struct Pad { var x: Float = 0; var throttle: Float = 0; var jet = false }

    private func readPad() -> Pad {
        var p = Pad()
        for c in GCController.controllers() {
            if let g = c.extendedGamepad {
                p.x += g.leftThumbstick.xAxis.value + g.dpad.xAxis.value
                p.throttle += g.rightTrigger.value - g.leftTrigger.value + g.leftThumbstick.yAxis.value * 0.5
                p.jet = p.jet || g.buttonA.isPressed || g.rightShoulder.isPressed
            } else if let m = c.microGamepad {
                m.reportsAbsoluteDpadValues = true  // thumb position on the touch surface
                p.x += m.dpad.xAxis.value
                p.jet = p.jet || m.buttonA.isPressed
            }
        }
        p.x = max(-1, min(1, p.x))
        p.throttle = max(-1, min(1, p.throttle))
        return p
    }

    // MARK: loop

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        let dt = lastTime == 0 ? 1.0 / 60 : min(0.05, time - lastTime)
        lastTime = time
        let pad = readPad()
        let clicked = pad.jet && !clickWasDown
        clickWasDown = pad.jet

        var events: [HopEvent] = []
        switch simPhase {
        case .title, .over:
            if clicked {
                newRun()
                simPhase = .playing
                DispatchQueue.main.async { self.phase = .playing }
            } else if simPhase == .title {
                events = run.step(dt, run.autopilot())
                if run.state == .over { newRun(); run.start() }
            }
        case .playing:
            // thumb or stick past half-way moves one lane; it must come back to the centre to move again
            let zone = pad.x > 0.5 ? 1 : (pad.x < -0.5 ? -1 : 0)
            var input = HopInput(jet: pad.jet, laneDelta: zone != stickLane ? zone : 0, throttle: Double(pad.throttle))
            if clicked { input.tap = true }   // even a quick click gives a full short hop
            stickLane = zone
            events = run.step(dt, input)
            if run.state == .over { gameOver() }
        }
        handle(events)
        syncCourse()
        placeScene(dt: Float(dt), time: Float(time))
        publish(dt: dt)
    }

    private func newRun() {
        clearCourse()
        run = HopRun(config: .tv)
        run.start()
        stickLane = 0
    }

    private func handle(_ events: [HopEvent]) {
        for e in events {
            switch e {
            case .ring(let combo): say(combo >= 2 ? "RING ×\(combo)" : "RING")
            case .crashed: shake = 1; say("CRASH")
            case .fell: shake = 0.6; say("FELL")
            default: break
            }
        }
    }

    private func say(_ text: String) {
        guard simPhase == .playing else { return }
        calloutClock = 1.1
        DispatchQueue.main.async { self.callout = text }
    }

    private func gameOver() {
        simPhase = .over
        let s = run.score
        DispatchQueue.main.async {
            self.phase = .over
            if s > self.best { self.best = s; UserDefaults.standard.set(s, forKey: "jethop.best") }
        }
    }

    private func publish(dt: Double) {
        if calloutClock > 0 {
            calloutClock -= dt
            if calloutClock <= 0 { DispatchQueue.main.async { self.callout = "" } }
        }
        hudClock += dt
        guard hudClock > 0.1 else { return }
        hudClock = 0
        let sc = run.score, l = run.lives, c = run.combo, r = run.rings, v = Int(run.speed * 3.6), t = run.tank
        DispatchQueue.main.async {
            self.score = sc; self.lives = l; self.combo = c; self.rings = r; self.speedKmh = v; self.tank = t
        }
    }

    private func placeScene(dt: Float, time: Float) {
        let p = SIMD3(Float(run.x), Float(run.y), -Float(run.s))
        car.simdPosition = p
        let pitch = Float(max(-0.35, min(0.35, run.vy * 0.03)))
        let roll = Float((run.laneX(run.lane) - run.x) * -0.08)
        car.eulerAngles = SCNVector3(pitch, 0, roll)
        car.opacity = run.safe > 0 ? CGFloat(0.55 + 0.45 * abs(sin(time * 14))) : 1
        let flameLen: Float = run.burning ? 1.6 + 0.2 * sin(time * 40) : 0.001
        for f in flames { f.scale = SCNVector3(1, flameLen, 1) }

        var cam = SIMD3(p.x * 0.6, 4.6 + max(0, p.y) * 0.55, p.z + 11 + Float(run.speed) * 0.04)
        if shake > 0 {
            cam += SIMD3(Float.random(in: -1...1, using: &rng), Float.random(in: -1...1, using: &rng), 0) * shake * 0.5
            shake = max(0, shake - dt * 2.5)
        }
        let old = cameraNode.simdPosition
        cameraNode.simdPosition = old == .zero || simd_length(old - cam) > 40 ? cam : simd_mix(old, cam, SIMD3(repeating: min(1, dt * 7)))
        cameraNode.look(at: SCNVector3(p.x * 0.8, max(0, p.y) * 0.5 + 1.2, p.z - 22))
        cameraNode.camera!.fieldOfView = CGFloat(66 + (Float(run.speed) - 24) * 0.35)
        ocean.simdPosition = SIMD3(p.x, -60, p.z - 400)
    }
}
