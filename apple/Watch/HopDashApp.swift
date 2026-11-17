// Roadster Hop Dash for Apple Watch: a one-thumb mini-game.
// Tap to fire a short jet hop over gaps and barriers; turn the Digital Crown to ease off or speed up.
// Rings are an optional bonus. Same short-burst jet hops as the main game.
import SwiftUI
import SpriteKit
import WatchKit

@main
struct HopDashApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

final class DashModel: ObservableObject {
    @Published var score = 0
    @Published var lives = 3
    @Published var rings = 0
    @Published var best = UserDefaults.standard.integer(forKey: "hopdash.best")
    @Published var state: HopDashScene.State = .title
    let scene: HopDashScene

    init() {
        scene = HopDashScene(size: WKInterfaceDevice.current().screenBounds.size)
        scene.scaleMode = .resizeFill
        scene.onChange = { [weak self] score, lives, rings, state in
            DispatchQueue.main.async {
                guard let self else { return }
                self.score = score
                self.lives = lives
                self.rings = rings
                self.state = state
                if state == .over && score > self.best {
                    self.best = score
                    UserDefaults.standard.set(score, forKey: "hopdash.best")
                }
            }
        }
    }

    func tap() { scene.tap() }
}

struct ContentView: View {
    @StateObject private var model = DashModel()
    @State private var crown = 0.5

    var body: some View {
        ZStack {
            SpriteView(scene: model.scene, preferredFramesPerSecond: 30)
                .ignoresSafeArea()
            VStack {
                HStack {
                    Text("\(model.score)").font(.system(.title3, design: .rounded).weight(.heavy)).monospacedDigit()
                    Spacer()
                    HStack(spacing: 3) {
                        ForEach(0..<3, id: \.self) { i in
                            Circle().fill(i < model.lives ? Color.red : Color.white.opacity(0.25)).frame(width: 7, height: 7)
                        }
                    }
                }
                .padding(.horizontal, 10)
                Spacer()
            }
            .opacity(model.state == .playing ? 1 : 0)
            if model.state != .playing {
                VStack(spacing: 4) {
                    Text(model.state == .over ? "GAME OVER" : "HOP DASH").font(.system(.headline, design: .rounded).weight(.heavy))
                    if model.state == .over { Text("Score \(model.score) · \(model.rings) rings").font(.footnote) }
                    Text("Best \(model.best)").font(.footnote).foregroundColor(.cyan)
                    Text("Tap: jet hop\nCrown: speed").font(.caption2).multilineTextAlignment(.center).foregroundColor(.white.opacity(0.8))
                    Text(model.state == .over ? "Tap to drive again" : "Tap to start").font(.caption.weight(.bold)).padding(.top, 2)
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.6)))
            }
        }
        .focusable(true)
        .digitalCrownRotation($crown, from: 0, through: 1, by: 0.01, sensitivity: .medium, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: crown) { value in model.scene.throttle = (value - 0.5) * 2 }
        .onTapGesture { model.tap() }
    }
}
