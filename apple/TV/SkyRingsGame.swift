import SceneKit
import GameController
import UIKit

/// Game state + SceneKit world. The renderer delegate runs the simulation every frame.
final class SkyRingsGame: NSObject, ObservableObject, SCNSceneRendererDelegate {
    enum Phase { case title, playing, over }

    // HUD state (published on the main thread)
    @Published var phase: Phase = .title
    @Published var score = 0
    @Published var lives = 3
    @Published var combo = 0
    @Published var speedKmh = 0
    @Published var boost: Double = 1
    @Published var best = UserDefaults.standard.integer(forKey: "skyrings.best")

    let scene = SCNScene()
    let cameraNode = SCNNode()

    private let car = SCNNode()
    private var flames: [SCNNode] = []
    private var rings: [SCNNode] = []
    private var props: [SCNNode] = []
    private let ocean = SCNNode()

    // simulation (render thread)
    private var lastTime: TimeInterval = 0
    private var pos = SIMD3<Float>(0, 30, 0)   // forward is -z
    private var side: Float = 0, climb: Float = 0
    private var bank: Float = 0
    private var speed: Float = 55
    private var fuel: Float = 1                // overdrive charge 0...1
    private var boosting = false
    private var nextRingZ: Float = -140
    private var ringIndex: Float = 0
    private var nextPropZ: Float = -60
    private var simScore = 0, simLives = 3, simCombo = 0
    private var simPhase: Phase = .title
    private var clickWasDown = false
    private var shake: Float = 0
    private var hudClock: Float = 0
    private var rng = SystemRandomNumberGenerator()

    private let ringRadius: Float = 7.5

    override init() {
        super.init()
        buildWorld()
        buildCar()
        resetRun()
    }

    // MARK: world

    private func buildWorld() {
        let horizon = UIColor(red: 0.98, green: 0.55, blue: 0.42, alpha: 1)
        scene.background.contents = Self.skyImage()
        scene.fogStartDistance = 160
        scene.fogEndDistance = 620
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
        amb.light!.intensity = 420
        amb.light!.color = UIColor(red: 0.55, green: 0.65, blue: 1, alpha: 1)
        scene.rootNode.addChildNode(amb)

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

    private func buildCar() {
        func pbr(_ color: UIColor, metal: CGFloat, rough: CGFloat) -> SCNMaterial {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = color
            m.metalness.contents = metal
            m.roughness.contents = rough
            return m
        }
        let paint = pbr(UIColor(red: 0.86, green: 0.06, blue: 0.14, alpha: 1), metal: 0.55, rough: 0.28)
        let dark = pbr(UIColor(white: 0.08, alpha: 1), metal: 0.3, rough: 0.5)
        let glass = pbr(UIColor(red: 0.05, green: 0.08, blue: 0.12, alpha: 1), metal: 0.9, rough: 0.05)

        let body = SCNNode(geometry: SCNBox(width: 2.0, height: 0.5, length: 4.4, chamferRadius: 0.25))
        body.geometry!.materials = [paint]
        car.addChildNode(body)
        let nose = SCNNode(geometry: SCNCapsule(capRadius: 0.32, height: 2.0))
        nose.geometry!.materials = [paint]
        nose.eulerAngles.z = .pi / 2
        nose.position = SCNVector3(0, -0.02, -2.15)
        car.addChildNode(nose)
        let cabin = SCNNode(geometry: SCNSphere(radius: 0.8))
        cabin.geometry!.materials = [glass]
        cabin.scale = SCNVector3(0.95, 0.42, 1.35)
        cabin.position = SCNVector3(0, 0.3, 0.1)
        car.addChildNode(cabin)
        for s: Float in [-1, 1] {
            let wing = SCNNode(geometry: SCNBox(width: 1.3, height: 0.08, length: 1.1, chamferRadius: 0.04))
            wing.geometry!.materials = [paint]
            wing.position = SCNVector3(s * 1.55, 0, 1.0)
            wing.eulerAngles.z = s * 0.12
            car.addChildNode(wing)
            let pod = SCNNode(geometry: SCNCylinder(radius: 0.32, height: 0.7))
            pod.geometry!.materials = [dark]
            pod.eulerAngles.x = .pi / 2
            pod.position = SCNVector3(s * 0.7, -0.1, 2.15)
            car.addChildNode(pod)
            let flame = SCNNode(geometry: SCNCone(topRadius: 0.0, bottomRadius: 0.27, height: 1.8))
            let fm = SCNMaterial()
            fm.lightingModel = .constant
            fm.diffuse.contents = UIColor(red: 0.55, green: 0.92, blue: 1, alpha: 1)
            fm.emission.contents = UIColor(red: 0.45, green: 0.9, blue: 1, alpha: 1)
            fm.transparency = 0.85
            fm.blendMode = .add
            flame.geometry!.materials = [fm]
            flame.eulerAngles.x = .pi / 2 // cone tip points backwards (+z)
            flame.position = SCNVector3(s * 0.7, -0.1, 3.35)
            car.addChildNode(flame)
            flames.append(flame)
        }
        let tail = SCNNode(geometry: SCNBox(width: 1.7, height: 0.08, length: 0.05, chamferRadius: 0))
        let tm = SCNMaterial()
        tm.lightingModel = .constant
        tm.emission.contents = UIColor(red: 1, green: 0.15, blue: 0.2, alpha: 1)
        tail.geometry!.materials = [tm]
        tail.position = SCNVector3(0, 0.1, 2.22)
        car.addChildNode(tail)
        scene.rootNode.addChildNode(car)
    }

    private func makeRing(at p: SIMD3<Float>) -> SCNNode {
        let torus = SCNTorus(ringRadius: CGFloat(ringRadius), pipeRadius: 0.45)
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = UIColor.cyan
        m.emission.contents = UIColor(red: 0.2, green: 0.9, blue: 1, alpha: 1)
        torus.materials = [m]
        let n = SCNNode(geometry: torus)
        n.eulerAngles.x = .pi / 2 // hole faces the flight direction
        n.simdPosition = p
        n.name = "ring"
        scene.rootNode.addChildNode(n)
        return n
    }

    private func makeProp(z: Float) {
        // floating islands and clouds to give a sense of speed
        let x = Float.random(in: -160...160, using: &rng)
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
            node.position = SCNVector3(x, Float.random(in: 5...60, using: &rng), z)
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
            node.position = SCNVector3(x, Float.random(in: 50...110, using: &rng), z)
        }
        scene.rootNode.addChildNode(node)
        props.append(node)
    }

    /// The ring path: smooth weaving that gets livelier as the score climbs.
    private func ringPoint(_ t: Float) -> SIMD2<Float> {
        let wild = min(1, Float(simScore) / 60)
        let x = 26 * sin(t * 0.55) + (10 + 14 * wild) * sin(t * 1.37 + 1)
        let y = 34 + 14 * sin(t * 0.8 + 2) + 6 * wild * sin(t * 2.1)
        return SIMD2(x, max(10, y))
    }

    private func resetRun() {
        rings.forEach { $0.removeFromParentNode() }
        rings.removeAll()
        props.forEach { $0.removeFromParentNode() }
        props.removeAll()
        pos = SIMD3(0, 34, 0)
        side = 0; climb = 0; bank = 0; speed = 55; fuel = 1
        nextRingZ = -140; ringIndex = 0; nextPropZ = -60
        simScore = 0; simLives = 3; simCombo = 0
        let first = ringPoint(0)
        pos.x = first.x; pos.y = first.y
        spawnAhead()
        publish(force: true)
    }

    private func spawnAhead() {
        while nextRingZ > pos.z - 650 {
            let p = ringPoint(ringIndex)
            rings.append(makeRing(at: SIMD3(p.x, p.y, nextRingZ)))
            ringIndex += 1
            nextRingZ -= max(85, 120 - Float(simScore) * 0.4)
        }
        while nextPropZ > pos.z - 700 {
            makeProp(z: nextPropZ)
            nextPropZ -= Float.random(in: 25...60, using: &rng)
        }
    }

    // MARK: input

    private struct Input { var x: Float = 0; var y: Float = 0; var click = false; var boost = false }

    private func readInput() -> Input {
        var i = Input()
        for c in GCController.controllers() {
            if let g = c.extendedGamepad {
                i.x += g.leftThumbstick.xAxis.value + g.dpad.xAxis.value
                i.y += g.leftThumbstick.yAxis.value + g.dpad.yAxis.value
                i.click = i.click || g.buttonA.isPressed
                i.boost = i.boost || g.buttonA.isPressed || g.rightTrigger.isPressed
            } else if let m = c.microGamepad {
                m.reportsAbsoluteDpadValues = true // thumb position on the touch surface = stick
                i.x += m.dpad.xAxis.value
                i.y += m.dpad.yAxis.value
                i.click = i.click || m.buttonA.isPressed
                i.boost = i.boost || m.buttonA.isPressed
            }
        }
        i.x = max(-1, min(1, i.x))
        i.y = max(-1, min(1, i.y))
        return i
    }

    // MARK: loop

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        let dt = Float(lastTime == 0 ? 1.0 / 60 : min(0.05, time - lastTime))
        lastTime = time
        let inp = readInput()
        let clicked = inp.click && !clickWasDown
        clickWasDown = inp.click

        switch simPhase {
        case .title, .over:
            // idle: cruise slowly through the scenery
            pos.z -= 25 * dt
            bank += (sin(Float(time) * 0.6) * 0.25 - bank) * min(1, dt * 2)
            if clicked {
                if simPhase == .over { resetRun() }
                simPhase = .playing
                DispatchQueue.main.async { self.phase = .playing }
            }
        case .playing:
            fly(dt: dt, inp: inp)
        }
        spawnAhead()
        placeScene(dt: dt, time: Float(time))
    }

    private func fly(dt: Float, inp: Input) {
        boosting = inp.boost && fuel > 0.02
        if boosting { fuel = max(0, fuel - dt * 0.45) } else { fuel = min(1, fuel + dt * 0.04) }
        let base = min(95, 55 + Float(simScore) * 0.6)
        let target = base * (boosting ? 1.55 : 1)
        speed += (target - speed) * min(1, dt * (boosting ? 3 : 1.5))

        // steer: thumb position sets bank and climb rates; the car carries some momentum
        side += (inp.x * 30 - side) * min(1, dt * 4)
        climb += (inp.y * 24 - climb) * min(1, dt * 4)
        bank += (-inp.x * 0.85 - bank) * min(1, dt * 6)
        let prevZ = pos.z
        pos.x += side * dt
        pos.y = max(6, min(95, pos.y + climb * dt))
        pos.z -= speed * dt

        // rings crossed this frame
        for ring in rings where ring.name == "ring" {
            let rz = ring.simdPosition.z
            guard rz <= prevZ && rz > pos.z else { continue }
            let d = simd_length(SIMD2(pos.x - ring.simdPosition.x, pos.y - ring.simdPosition.y))
            ring.name = "done"
            if d <= ringRadius {
                simCombo += 1
                simScore += 1 + min(simCombo - 1, 9)
                fuel = min(1, fuel + 0.12)
                ring.runAction(.group([.scale(to: 1.6, duration: 0.3), .fadeOut(duration: 0.3)]))
            } else {
                simCombo = 0
                simLives -= 1
                shake = 1
                ring.geometry?.firstMaterial?.emission.contents = UIColor.red
                ring.runAction(.fadeOpacity(to: 0.25, duration: 0.2))
                if simLives <= 0 { gameOver() }
            }
        }
        publish(force: false, dt: dt)
    }

    private func gameOver() {
        simPhase = .over
        let s = simScore
        DispatchQueue.main.async {
            self.phase = .over
            if s > self.best { self.best = s; UserDefaults.standard.set(s, forKey: "skyrings.best") }
        }
    }

    private func publish(force: Bool, dt: Float = 0) {
        hudClock += dt
        guard force || hudClock > 0.1 else { return }
        hudClock = 0
        let s = simScore, l = simLives, c = simCombo, v = Int(speed * 3.6), f = Double(fuel)
        DispatchQueue.main.async {
            self.score = s; self.lives = l; self.combo = c; self.speedKmh = v; self.boost = f
        }
    }

    private func placeScene(dt: Float, time: Float) {
        car.simdPosition = pos
        car.eulerAngles = SCNVector3(climb / 70, 0, bank)
        let flameLen: Float = boosting ? 1.7 : 0.9 + 0.1 * sin(time * 30)
        for f in flames { f.scale = SCNVector3(1, flameLen, 1) }

        // chase camera, a little behind and above, leaning with the bank
        var cam = pos + SIMD3(0, 3.2, 12 + speed * 0.03)
        if shake > 0 {
            cam += SIMD3(Float.random(in: -1...1, using: &rng), Float.random(in: -1...1, using: &rng), 0) * shake * 0.6
            shake = max(0, shake - dt * 2.5)
        }
        cameraNode.simdPosition = simd_mix(cameraNode.simdPosition == .zero ? cam : cameraNode.simdPosition, cam, SIMD3(repeating: min(1, dt * 8)))
        cameraNode.look(at: SCNVector3(pos.x, pos.y + 1, pos.z - 24))
        cameraNode.eulerAngles.z = bank * 0.3
        cameraNode.camera!.fieldOfView = CGFloat(68 + (speed - 55) * 0.25)
        ocean.simdPosition = SIMD3(pos.x, 0, pos.z - 400)

        // clean up behind the camera
        rings.removeAll { n in
            if n.simdPosition.z > pos.z + 40 { n.removeFromParentNode(); return true }
            return false
        }
        props.removeAll { n in
            if n.simdPosition.z > pos.z + 60 { n.removeFromParentNode(); return true }
            return false
        }
    }
}
