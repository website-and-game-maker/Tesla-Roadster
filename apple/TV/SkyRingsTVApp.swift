// Roadster Sky Rings for Apple TV: a native mini-game built for the Siri Remote.
// Glide your thumb on the remote's touch surface to steer the flying Roadster through rings;
// click to fire the overdrive. All visuals are made in code: no outside art.
import SwiftUI
import SceneKit

@main
struct SkyRingsTVApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var game = SkyRingsGame()

    var body: some View {
        ZStack {
            SceneView(scene: game.scene, pointOfView: game.cameraNode, options: [],
                      preferredFramesPerSecond: 60, antialiasingMode: .multisampling4X, delegate: game)
                .ignoresSafeArea()
            HUD(game: game)
        }
        .background(Color.black)
    }
}

struct HUD: View {
    @ObservedObject var game: SkyRingsGame

    var body: some View {
        ZStack {
            VStack {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(game.score)").font(.system(size: 76, weight: .heavy, design: .rounded)).italic()
                        if game.combo >= 2 { Text("RING COMBO ×\(game.combo)").font(.headline).foregroundColor(.cyan) }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 10) {
                        HStack(spacing: 10) {
                            ForEach(0..<3, id: \.self) { i in
                                Circle().fill(i < game.lives ? Color.red : Color.white.opacity(0.2)).frame(width: 22, height: 22)
                            }
                        }
                        Text("\(game.speedKmh) km/h").font(.system(size: 34, weight: .bold, design: .rounded)).monospacedDigit()
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.15)).frame(width: 260, height: 12)
                            Capsule().fill(LinearGradient(colors: [.cyan, .purple], startPoint: .leading, endPoint: .trailing))
                                .frame(width: 260 * CGFloat(game.boost), height: 12)
                        }
                        Text("OVERDRIVE").font(.caption).foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(60)
                Spacer()
            }
            .foregroundColor(.white)
            .opacity(game.phase == .playing ? 1 : 0)

            if game.phase != .playing {
                VStack(spacing: 24) {
                    Text(game.phase == .over ? "GAME OVER" : "SKY RINGS")
                        .font(.system(size: 96, weight: .heavy, design: .rounded)).italic()
                    if game.phase == .over {
                        Text("Score \(game.score)   ·   Best \(game.best)").font(.title2)
                    } else {
                        Text("Glide your thumb on the remote to steer.\nClick to fire the overdrive.").multilineTextAlignment(.center).font(.title3)
                        if game.best > 0 { Text("Best \(game.best)").font(.title3).foregroundColor(.cyan) }
                    }
                    Text("Click to \(game.phase == .over ? "fly again" : "take off")")
                        .font(.headline).padding(.horizontal, 30).padding(.vertical, 14)
                        .background(Capsule().fill(Color.cyan.opacity(0.35)))
                }
                .foregroundColor(.white)
                .padding(70)
                .background(RoundedRectangle(cornerRadius: 40).fill(Color.black.opacity(0.55)))
            }
        }
        .animation(.easeOut(duration: 0.25), value: game.phase)
    }
}
