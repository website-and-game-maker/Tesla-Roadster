// Roadster Rush for iPhone, iPad, Mac and Apple Vision Pro.
// The full game is the same web build as the browser version, bundled inside the app and
// served from a private URL scheme, so it runs offline and starts instantly.
import SwiftUI

@main
struct RoadsterApp: App {
    var body: some Scene {
        WindowGroup {
            GameView()
                .ignoresSafeArea()
                .background(Color.black)
                #if os(iOS)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 720)
        .commands { CommandGroup(replacing: .newItem) {} }
        #endif
        #if os(visionOS)
        .defaultSize(width: 1600, height: 900)
        #endif
    }
}
