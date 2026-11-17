// Secrets: three hidden easter eggs in every world, each with a challenge.
//
// A secret is placed relative to the track, never at fixed world coordinates, so it stays
// reachable whatever happens to the scenery or the barriers:
//   at    0..1  where along the lap (the placer nudges it forward off gaps, rings and rock)
//   side  -1/1  left or right of the driving direction
//   tier  'low'   just past the road edge, a tap of the jets up
//         'high'  over the road, most of a full burn up
//         'wall'  off the track: on open ground outside the fence (full burn over the 16 m
//                 fence, then drive to it), or on top of the fence where there is no ground
//   prop  which little model to build (src/secrets/props.js)
//   challenge  what Secret Hunt asks you to do there (src/secrets/hunt.js)
//
// All names, texts and models are original to this game.

export const FIND_REWARD = 250;
export const CHALLENGE_REWARD = 500;
export const WORLD_REWARD = 1500;
/** Career stars that turn secrets from "stumbled on" into a goal. Finding 3 does it too. */
export const HUNTER_STARS = 6;
export const HUNTER_FINDS = 3;

export const CHALLENGES = {
  sparks: { name: 'Spark Run', goal: (c) => `Collect ${c.need} of the ${c.count} sparks along the road ahead before the timer runs out. ${c.flat ? 'Stay on the racing line.' : 'Gold ones are high: jet hop for them.'}` },
  skyhigh: { name: 'Sky High', goal: (c) => `Climb to ${c.height} m above the road in one jet burn.` },
  glide: { name: 'Long Glide', goal: (c) => `Stay in the air for ${c.seconds.toFixed(1)} seconds in one hop. Burn the whole tank, then glide.` },
  bullseye: { name: 'Bullseye', goal: () => 'Jet hop and land inside the glowing circle on the road ahead.' },
};

const S = (id, name, tier, at, side, prop, challenge, flavor, hint) => ({ id, name, tier, at, side, prop, challenge, flavor, hint });

export const SECRETS = {
  coast: [
    S('coast-bottle', 'Message in a Bottle', 'low', 0.16, 1, 'bottle', 'sparks', 'The note inside says: "Send more jet fuel."', 'Bobbing just past the right edge of the road, early in the lap. A tap of the jets reaches it.'),
    S('coast-gull', 'The Brass Gull', 'high', 0.47, -1, 'gull', 'skyhigh', 'A weathervane that slipped its roof and never came down.', 'High above the road around the half-way point. Hold the jets for a long burn.'),
    S('coast-buoy', 'Runaway Buoy', 'wall', 0.78, -1, 'buoy', 'bullseye', 'It was supposed to be in the sea. It prefers dry land.', "Off the track, on the ground past the left guardrail in the last quarter of the lap. Full burn over the fence, then drive to it."),
  ],
  saltflats: [
    S('salt-hubcap', 'The Lost Hubcap', 'low', 0.12, -1, 'hubcap', 'sparks', 'Still spinning from a record run nobody wrote down.', 'Spinning beside the left edge of the road soon after the start.'),
    S('salt-cactus', 'Mirage Cactus', 'wall', 0.41, 1, 'cactus', 'glide', 'Wears sunglasses. Insists it is real.', "Out on the salt past the right-hand fence, before half-way. It only looks far away."),
    S('salt-marker', 'Mile Marker Zero', 'high', 0.71, 1, 'marker', 'skyhigh', 'Every record has to start somewhere. This one starts up here.', 'High over the long back stretch. Full burn.'),
  ],
  spires: [
    S('spires-kite', 'Paper Kite', 'high', 0.2, 1, 'kite', 'glide', 'No string. No owner. Excellent lift.', 'Riding the wind high above the skyway in the first quarter.'),
    S('spires-chime', 'Wind Chime', 'low', 0.52, -1, 'chime', 'sparks', 'It plays the first four notes of a song you almost remember.', 'Hanging just off the left edge of the deck near half-way.'),
    S('spires-lantern', 'Cloud Lantern', 'wall', 0.82, 1, 'lantern', 'bullseye', 'Someone lit it a long time ago. It has not gone out.', "Riding the top of the right fence late in the lap. It takes a full burn."),
  ],
  city: [
    S('city-cat', 'Neon Cat', 'wall', 0.14, -1, 'cat', 'bullseye', 'The sign shop closed years ago. The cat stayed on.', "Off the track behind the left fence, early in the lap. Full burn over the fence."),
    S('city-cones', 'Cone Crown', 'low', 0.44, 1, 'cones', 'sparks', 'Five traffic cones, stacked by someone with ambition.', 'Stacked above the right edge of the road before half-way.'),
    S('city-disco', 'Midnight Mirrorball', 'high', 0.75, -1, 'disco', 'skyhigh', 'The party is forty floors up. This fell off.', 'Turning slowly, high over the street in the last third.'),
  ],
  alpine: [
    S('alpine-snowman', 'Snowman Pilot', 'low', 0.18, 1, 'snowman', 'sparks', 'Goggles on. Scarf up. Cleared for take-off.', 'Hovering beside the right edge of the road in the first climb.'),
    S('alpine-bell', 'Golden Cowbell', 'high', 0.5, 1, 'bell', 'glide', 'You can hear it from the next valley.', 'Ringing high above the road at half-way.'),
    S('alpine-ski', 'The Lost Ski', 'wall', 0.8, -1, 'ski', 'bullseye', 'Its twin made it to the bottom in 1987.', "Lying off the track past the left fence, on the way back down."),
  ],
  canyon: [
    S('canyon-lantern', "Prospector's Lantern", 'low', 0.1, -1, 'oillamp', 'sparks', 'Still warm. The prospector cannot be far.', 'Swinging by the left edge of the viaduct soon after the start.'),
    S('canyon-pick', 'Golden Pickaxe', 'high', 0.42, -1, 'pickaxe', 'skyhigh', 'Struck gold once. Then somebody struck it.', 'High above the road before half-way. Full burn.'),
    S('canyon-weed', 'Tumbleweed King', 'wall', 0.73, 1, 'tumbleweed', 'glide', 'Rolled so far it grew a crown.', "Perched on top of the right fence in the last third. Full burn."),
  ],
  launch: [
    S('launch-sat', 'Pocket Satellite', 'high', 0.22, -1, 'satellite', 'skyhigh', 'Orbit was the plan. Fifteen metres up is also fine.', 'Hanging high above the road in the first quarter.'),
    S('launch-duck', 'Rubber Duck Astronaut', 'low', 0.5, -1, 'duck', 'sparks', 'Mission patch reads: "Bath 1".', 'Floating by the left edge of the road at half-way.'),
    S('launch-cone', 'Spare Nose Cone', 'wall', 0.8, 1, 'nosecone', 'bullseye', 'Somebody is going to need that.', "Parked off the track past the right fence, late in the lap."),
  ],
  mars: [
    S('mars-rover', 'Little Rover', 'low', 0.15, 1, 'rover', 'sparks', 'It has been waiting for a wave back since sol 1.', 'Hovering by the right edge of the road early in the lap. Low gravity makes the hop easy.'),
    S('mars-jar', 'Dust Devil in a Jar', 'wall', 0.46, -1, 'jar', 'glide', 'Do not open on a clean floor.', "Out in the dust beyond the left fence, around half-way."),
    S('mars-flag', 'First Flag', 'high', 0.77, 1, 'flag', 'skyhigh', 'Planted on nothing. Claims everything.', 'High over the road in the last quarter.'),
  ],
  isles: [
    S('isles-teapot', 'Floating Teapot', 'wall', 0.17, 1, 'teapot', 'bullseye', 'Always full. Never spills. Nobody asks why.', "Balanced on top of the right fence on the first island road. Full burn."),
    S('isles-whale', 'Sky Whale', 'high', 0.5, -1, 'whale', 'glide', 'A toy one. The real ones fly higher.', 'Swimming high above the road at half-way.'),
    S('isles-shard', 'Rainbow Shard', 'low', 0.83, -1, 'shard', 'sparks', 'A piece of this morning, snapped off.', 'Glittering beside the left edge of the road near the end of the lap.'),
  ],
  volcano: [
    S('volcano-mallow', 'Toasted Marshmallow', 'low', 0.13, 1, 'mallow', 'sparks', 'Perfectly golden. It took exactly one lap to toast.', 'Held out over the lava just past the right edge of the causeway, early in the lap. A tap of the jets.'),
    S('volcano-egg', 'Obsidian Egg', 'high', 0.4, -1, 'egg', 'skyhigh', 'Warm to the touch. Best not to wait around for it to hatch.', 'Glowing high above the causeway before half-way. Full burn.'),
    S('volcano-thermo', 'Melted Thermometer', 'wall', 0.68, -1, 'thermo', 'bullseye', 'It stopped counting at 1,200 degrees and gave up.', "Leaning on top of the left wall in the last third of the lap. Full burn."),
  ],
  fjord: [
    S('fjord-mitten', 'Odd Mitten', 'low', 0.24, -1, 'mitten', 'sparks', 'The other one is somewhere in the next valley, also looking.', 'Drifting just past the left guardrail in the first quarter, along the shore.'),
    S('fjord-globe', 'Snow Globe', 'high', 0.55, 1, 'globe', 'glide', 'Shake it and the whole fjord gets a fresh coat.', 'Hanging high over the road just after half-way, round the head of the fjord.'),
    S('fjord-sled', 'Runaway Sled', 'wall', 0.86, 1, 'sled', 'bullseye', 'It left the village without asking and has not looked back.', "Parked in the snow past the right guardrail near the end of the lap. Full burn over the fence, then drive to it."),
  ],
  jungle: [
    S('jungle-frog', 'Golden Frog', 'low', 0.1, -1, 'frog', 'sparks', 'Croaks once per lap, exactly on the beat.', 'Sitting just past the left edge of the bridge soon after the start.'),
    S('jungle-mask', 'Smiling Stone Mask', 'high', 0.36, 1, 'mask', 'skyhigh', 'It has been smiling at the river for a thousand years. Nobody knows the joke.', 'Floating high over the bridge in the first half. Full burn.'),
    S('jungle-radio', 'Coconut Radio', 'wall', 0.64, 1, 'radio', 'glide', 'Two halves, one antenna, mostly static and the odd parrot.', "Balanced on top of the right wall in the second half of the lap. Full burn."),
  ],
  moon: [
    S('moon-golf', 'Hole in One', 'high', 0.2, 1, 'golf', 'skyhigh', 'Still on its way down from a very long drive.', 'High over the road in the first quarter. Low gravity helps.'),
    S('moon-cheese', 'Moon Cheese', 'low', 0.48, 1, 'cheese', 'sparks', 'So the stories were true.', 'Floating by the right edge of the road before half-way.'),
    S('moon-flag', 'Pocket Flag', 'wall', 0.79, -1, 'flag', 'glide', 'One small flag, one giant leap to reach it.', "Planted in the regolith past the left fence, late in the lap."),
  ],
  orbit: [
    S('orbit-wrench', 'Drifting Wrench', 'low', 0.2, 1, 'wrench', 'sparks', 'Dropped on a spacewalk. Still drifting home, very slowly.', 'Turning gently just past the right edge of the ring in the first quarter.'),
    S('orbit-sock', 'Zero-G Sock', 'high', 0.57, -1, 'sock', 'glide', 'Every station loses one. This is where they all go.', 'Floating high above the ring after half-way. Light gravity: burn and glide.'),
    S('orbit-basil', 'Station Basil', 'wall', 0.82, -1, 'basil', 'bullseye', 'The only plant on the station. It has seen things.', "Growing on top of the left wall late in the lap. Full burn."),
  ],
};

export const ALL_SECRETS = Object.entries(SECRETS).flatMap(([world, list]) => list.map((s) => ({ ...s, world })));
export const TOTAL = ALL_SECRETS.length;

/** Jet trails: the cosmetic reward. `need` secrets found; `done: true` = every challenge beaten too. */
export const TRAILS = [
  { id: '', name: 'None', need: 0, colors: null },
  { id: 'ember', name: 'Ember', need: 5, colors: [0xffb347, 0xff5a2a, 0xffe08a] },
  { id: 'aurora', name: 'Aurora', need: 12, colors: [0x49f2c2, 0x4aa8ff, 0xb78bff] },
  { id: 'stardust', name: 'Stardust', need: 20, colors: [0xffffff, 0xcfe4ff, 0xffe9b0] },
  { id: 'prism', name: 'Prism', need: TOTAL, done: true, colors: [0xff4d6d, 0xffc94d, 0x4dff9a, 0x4db8ff, 0xb44dff] },
];
