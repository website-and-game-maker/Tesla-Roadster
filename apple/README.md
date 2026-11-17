# Roadster Rush on Apple platforms

| Device | App | What it is |
|---|---|---|
| iPhone, iPad | **Roadster Rush** | The full game: jet-hop career, ring races, online races, garage, secrets, accounts. Touch, tilt-to-steer, and game controllers. |
| Mac | **Roadster Rush** | The same full game in a resizable window; keyboard, mouse, and controllers. |
| Apple Vision Pro | **Roadster Rush** | The full game in a floating window; play it with a game controller. |
| Apple TV | **Jet Hop** | Native mini-game for the Siri Remote: race a sky road, click to fire a short jet hop over gaps and barriers, swipe to change lanes, thread rings for a bonus. Xbox, PlayStation and MFi controllers work too (A to hop, triggers for speed). |
| Apple Watch | **Hop Dash** | Native one-thumb mini-game: tap to jet-hop over gaps and barriers, turn the Digital Crown to speed up or ease off, with haptics on every hop and ring. |

The iPhone, iPad, Mac and Vision Pro app bundles the exact same web build as the browser game (`scripts/sync-web.sh` copies it into `Web/` before every build). It serves the build from a private `roadster://` scheme, so it runs fully offline and saves progress on the device. Online play and accounts use the network as on the web. Apple TV and Apple Watch can't run a web view, so they get their own native mini-games, written in SwiftUI with SceneKit (TV) and SpriteKit (Watch). All the art is generated in code.

Both mini-games use the same rules file, `Shared/HopCore.swift`: the Roadster flies only in short jet bursts, exactly like the main game. A full tank burns for half a second, refills only on the road, and every gap is generated short enough to clear at the slowest speed. `sh scripts/test-logic.sh` compiles those rules with an autopilot and checks that courses are winnable, that doing nothing loses, and that holding the jet can't turn a hop into sustained flight. It runs on a Mac or on Linux with a swift.org toolchain.

## Build

You need a Mac with Xcode 15.2 or newer (for visionOS) and [XcodeGen](https://github.com/yonaskolb/XcodeGen) 2.38 or newer.

```sh
brew install xcodegen
cd apple
xcodegen generate
open Roadster.xcodeproj
```

1. In Xcode, select each target (Roadster, JetHop, HopDash), open **Signing & Capabilities**, and pick your team. You can also put your team id in `DEVELOPMENT_TEAM` in `project.yml`.
2. Pick a scheme and a destination (an iPhone, My Mac, Apple Vision Pro, Apple TV or Apple Watch simulator) and press Run.
3. To ship: Product → Archive, then upload from the Organizer to App Store Connect. The app icons, the tvOS layered icons and the top-shelf images are already in the asset catalogs.

The bundle ids are `app.roadsterrush.game`, `app.roadsterrush.jethop` and `app.roadsterrush.hopdash`. Change them in `project.yml` if you register different ones.

## Notes

- Every pull request that touches `apple/` builds all five destinations (iPhone/iPad, Mac, Vision Pro, Apple TV, Apple Watch) on a GitHub-hosted Mac and runs the mini-game tests (`.github/workflows/apple.yml`). Nothing is signed or uploaded there. The run attaches an unsigned Mac build (`RoadsterRush-mac`) you can download and open (right-click → Open the first time).
- Signing, devices and App Store upload still need your Apple Developer account in Xcode.
- The App Store needs a privacy policy URL and screenshots for each platform. The game itself collects nothing; accounts, if switched on, store only an email and the save file.
- Use original names and art in store listings. "Tesla" and "Roadster" are trademarks; App Review rejects apps that use another company's brand without permission. The title "Roadster Rush" and the icons here are original. Inside the apps the home screen says "Rocket Roadster" instead of the brand name (the browser version keeps it, with a fan-project note on the About page).
