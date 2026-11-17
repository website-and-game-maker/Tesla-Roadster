// Roadster Jet Hop for Apple TV: a native mini-game built for the Siri Remote.
// The Roadster races along a sky road full of gaps and barriers. Click to fire a short jet hop,
// swipe left or right to change lanes, and thread the optional rings for points.
// Same short-burst jet hops as the main game. All visuals are made in code: no outside art.
import SwiftUI
import SceneKit

@main
struct JetHopTVApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var game = JetHopGame()

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
    @ObservedObject var game: JetHopGame

    var body: some View {
        ZStack {
            VStack {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(game.score)").font(.system(size: 76, weight: .heavy, design: .rounded)).italic().monospacedDigit()
                        Text("\(game.rings) rings").font(.headline).foregroundColor(.cyan)
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
                                .frame(width: 260 * CGFloat(game.tank), height: 12)
                        }
                        Text("JET").font(.caption).foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(60)
                Spacer()
                if !game.callout.isEmpty {
                    Text(game.callout).font(.system(size: 54, weight: .heavy, design: .rounded)).italic()
                        .foregroundColor(game.callout.hasPrefix("RING") ? .cyan : .orange)
                        .padding(.bottom, 120)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .foregroundColor(.white)
            .opacity(game.phase == .playing ? 1 : 0)

            if game.phase != .playing {
                VStack(spacing: 24) {
                    Text(game.phase == .over ? "GAME OVER" : "JET HOP")
                        .font(.system(size: 96, weight: .heavy, design: .rounded)).italic()
                    if game.phase == .over {
                        Text("Score \(game.score)   ·   \(game.rings) rings   ·   Best \(game.best)").font(.title2)
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Click to fire a short jet hop over gaps and barriers", systemImage: "flame.fill")
                            Label("Swipe left or right to change lanes", systemImage: "arrow.left.and.right")
                            Label("Rings are a bonus: thread them for points", systemImage: "circle.circle")
                        }
                        .font(.title3)
                        if game.best > 0 { Text("Best \(game.best)").font(.title3).foregroundColor(.cyan) }
                    }
                    Text("Click to \(game.phase == .over ? "drive again" : "start")")
                        .font(.headline).padding(.horizontal, 30).padding(.vertical, 14)
                        .background(Capsule().fill(Color.cyan.opacity(0.35)))
                }
                .foregroundColor(.white)
                .padding(70)
                .background(RoundedRectangle(cornerRadius: 40).fill(Color.black.opacity(0.55)))
            }
        }
        .animation(.easeOut(duration: 0.25), value: game.phase)
        .animation(.spring(response: 0.25), value: game.callout)
    }
}
