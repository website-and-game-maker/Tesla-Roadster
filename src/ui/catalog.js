// Default garage catalog. The lead passes the car team's PAINTS/WHEELS instead when available;
// any entry shape works as long as it has { id, name } and paints have `color`.
export const DEFAULT_PAINTS = [
  { id: 'pearl',     name: 'Pearl White Multi-Coat', color: '#eceae4', metalness: 0.35, roughness: 0.25, clearcoat: 1, price: 0 },
  { id: 'black',     name: 'Solid Black',            color: '#08090b', metalness: 0.5,  roughness: 0.2,  clearcoat: 1, price: 0 },
  { id: 'silver',    name: 'Midnight Silver',        color: '#4b4f56', metalness: 0.85, roughness: 0.3,  clearcoat: 1, price: 0 },
  { id: 'blue',      name: 'Deep Blue Metallic',     color: '#0f2c64', metalness: 0.8,  roughness: 0.28, clearcoat: 1, price: 2000 },
  { id: 'red',       name: 'Red Multi-Coat',         color: '#9e0b16', metalness: 0.6,  roughness: 0.22, clearcoat: 1, price: 2000 },
  { id: 'ultrared',  name: 'Ultra Red',              color: '#c8101e', metalness: 0.7,  roughness: 0.18, clearcoat: 1, price: 5000 },
  { id: 'quicksilver', name: 'Quicksilver',          color: '#a9acb2', metalness: 1.0,  roughness: 0.12, clearcoat: 1, price: 6000 },
  { id: 'lime',      name: 'Electric Lime',          color: '#9be010', metalness: 0.5,  roughness: 0.25, clearcoat: 1, price: 8000 },
  { id: 'stealth',   name: 'Satin Stealth',          color: '#1b1c1f', metalness: 0.4,  roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.5, price: 10000 },
  { id: 'aurora',    name: 'Aurora Flip',            color: '#3a2a6e', metalness: 0.9,  roughness: 0.2,  clearcoat: 1, iridescence: 1, price: 15000 },
  { id: 'gold',      name: 'Champagne Gold',         color: '#b8955a', metalness: 1.0,  roughness: 0.18, clearcoat: 1, price: 20000 },
];

export const DEFAULT_WHEELS = [
  { id: 'turbine', name: 'Turbine 19/20"',   spokes: 14, twist: 0.25, color: '#c7cbd2', roughness: 0.2, price: 0 },
  { id: 'aero',    name: 'Aero Disc',        spokes: 5,  twist: 0,    color: '#2a2c30', roughness: 0.35, price: 3000 },
  { id: 'sport',   name: 'Forged Sport',     spokes: 10, twist: 0,    color: '#1a1b1e', roughness: 0.3, price: 5000 },
  { id: 'carbon',  name: 'Carbon Blade',     spokes: 7,  twist: 0.5,  color: '#101113', roughness: 0.45, price: 9000 },
];

// Upgrade tracks. Levels 0..4; cost scales per level. Stat deltas are display hints;
// the lead owns the real physics effect.
export const UPGRADES = [
  { id: 'motor',    name: 'Tri-Motor',      desc: 'More torque, harder launches.', stat: 'accel',    cost: [3000, 6000, 12000, 24000] },
  { id: 'inverter', name: 'SiC Inverter',   desc: 'Higher top speed.',             stat: 'top',      cost: [2500, 5000, 10000, 20000] },
  { id: 'tires',    name: 'Track Tires',    desc: 'More grip through corners.',    stat: 'grip',     cost: [2000, 4000, 8000, 16000] },
  { id: 'battery',  name: '200 kWh Pack',   desc: 'Longer boost and range.',       stat: 'battery',  cost: [2000, 4000, 8000, 16000] },
];

export const DEFAULT_MODES = [
  { id: 'career',      name: 'Career',      desc: 'Win events, earn credits and stars, unlock new tracks.', icon: '★' },
  { id: 'quick',       name: 'Quick Race',  desc: 'Jump straight into a race against AI on any track.',      icon: '⚑' },
  { id: 'timetrial',   name: 'Time Trial',  desc: 'Chase your ghost and set the perfect lap.',               icon: '⏱' },
  { id: 'multiplayer', name: 'Multiplayer', desc: 'Race friends online with a room code.',                   icon: '◎' },
];

export const DEFAULT_TRACKS = [
  { id: 'coast',  name: 'Pacific Coast',   desc: 'Sweeping cliffside highway at golden hour.' },
  { id: 'city',   name: 'Neon City',       desc: 'Tight downtown circuit, wet streets at night.' },
  { id: 'desert', name: 'Salt Flats',      desc: 'Wide open top-speed run under a blazing sun.' },
];
