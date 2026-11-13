# Roadster Rush

A 3D game about a flying electric roadster. It runs in the browser on desktop and mobile and is hosted on GitHub Pages. It uses plain ES modules and three.js, with no build step.

- **Fly (the main game):** ring races against AI pilots, ring trials, free flight, a flight career across 10 sky worlds, and a tutorial.
- **Drive:** the original ground racing (races, time attack, drift, elimination). Switch with the Flight/Ground toggle at the top of the menu.
- **Online:** private rooms and quick match. Optional free accounts sync your save (see `supabase/` and `src/multiplayer/config.js`).

How to run and where things live:
- Play locally: `npx serve .` (or any static server) and open http://localhost:3000
- Apple apps (iPhone, iPad, Mac, Vision Pro, plus Apple TV and Apple Watch mini-games): [apple/README.md](apple/README.md)
- Team layout and module contracts: [ARCHITECTURE.md](ARCHITECTURE.md)

All models, worlds, sounds and icons are made in code for this project. three.js r160 is vendored in `vendor/` (MIT, see `vendor/THREE-LICENSE`), and so is PeerJS (MIT, see `vendor/PEERJS-LICENSE`).
