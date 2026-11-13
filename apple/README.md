# Roadster Rush on Apple platforms

| Device | App | What it is |
|---|---|---|
| iPhone, iPad | **Roadster Rush** | The full game: flying career, ring races, online races, garage, accounts. Touch, tilt-to-bank, and game controllers. |
| Mac | **Roadster Rush** | The same full game in a resizable window; keyboard, mouse, and controllers. |
| Apple Vision Pro | **Roadster Rush** | The full game in a floating window; play it with a game controller. |
| Apple TV | **Sky Rings** | Native mini-game for the Siri Remote: glide your thumb to steer through rings, click for overdrive. MFi and Xbox/PlayStation controllers work too. |
| Apple Watch | **Ring Dash** | Native one-thumb mini-game: the Digital Crown climbs and dives, a tap fires the overdrive, with haptics on every ring. |

The iPhone, iPad, Mac and Vision Pro app bundles the exact same web build as the browser game (`scripts/sync-web.sh` copies it into `Web/` before every build). It serves the build from a private `roadster://` scheme, so it runs fully offline and saves progress on the device. Online play and accounts use the network as on the web. Apple TV and Apple Watch can't run a web view, so they get their own native mini-games, written in SwiftUI with SceneKit (TV) and SpriteKit (Watch). All the art is generated in code.

## Build

You need a Mac with Xcode 15.2 or newer (for visionOS) and [XcodeGen](https://github.com/yonaskolb/XcodeGen) 2.38 or newer.

```sh
brew install xcodegen
cd apple
xcodegen generate
open Roadster.xcodeproj
```

1. In Xcode, select each target (Roadster, SkyRings, RingDash), open **Signing & Capabilities**, and pick your team. You can also put your team id in `DEVELOPMENT_TEAM` in `project.yml`.
2. Pick a scheme and a destination (an iPhone, My Mac, Apple Vision Pro, Apple TV or Apple Watch simulator) and press Run.
3. To ship: Product → Archive, then upload from the Organizer to App Store Connect. The app icons, the tvOS layered icons and the top-shelf images are already in the asset catalogs.

The bundle ids are `app.roadsterrush.game`, `app.roadsterrush.skyrings` and `app.roadsterrush.ringdash`. Change them in `project.yml` if you register different ones.

## Notes

- This is written and syntax-checked, but it has not been built here: Xcode only runs on a Mac. If the first build shows an error, it will be a small fix.
- The App Store needs a privacy policy URL and screenshots for each platform. The game itself collects nothing; accounts, if switched on, store only an email and the save file.
- Use original names and art in store listings. "Tesla" and "Roadster" are trademarks; App Review rejects apps that use another company's brand without permission. The title "Roadster Rush" and the icons here are original. Inside the apps the home screen says "Rocket Roadster" instead of the brand name (the browser version keeps it, with a fan-project note on the About page).
