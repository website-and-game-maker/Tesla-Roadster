// Quality tiers for world rendering. The engine picks a tier from its
// device benchmark; worlds only read these numbers.
// Physics never depends on the tier: ground height, surfaces and the track
// are identical on every device so multiplayer races stay fair.

export const QUALITY = {
  low: {
    terrainCell: 18,      // metres between terrain vertices
    terrainMargin: 650,   // terrain extends this far past the track
    propDensity: 0.3,     // fraction of props spawned
    shadows: false,
    shadowMapSize: 512,
    shadowRange: 60,
    particles: 350,
    textureSize: 256,
    anisotropy: 1,
    waterDetail: false,
    envMap: false,
    farProps: false,      // skip distant landmark detail
  },
  medium: {
    terrainCell: 11,
    terrainMargin: 850,
    propDensity: 0.55,
    shadows: true,
    shadowMapSize: 1024,
    shadowRange: 70,
    particles: 1400,
    textureSize: 512,
    anisotropy: 4,
    waterDetail: true,
    envMap: true,
    farProps: true,
  },
  high: {
    terrainCell: 7,
    terrainMargin: 1000,
    propDensity: 1,
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 90,
    particles: 3500,
    textureSize: 1024,
    anisotropy: 8,
    waterDetail: true,
    envMap: true,
    farProps: true,
  },
  ultra: {
    terrainCell: 4.5,
    terrainMargin: 1200,
    propDensity: 1.6,
    shadows: true,
    shadowMapSize: 4096,
    shadowRange: 110,
    particles: 7000,
    textureSize: 1024,
    anisotropy: 16,
    waterDetail: true,
    envMap: true,
    farProps: true,
  },
};

export function getQuality(name) {
  return QUALITY[name] || QUALITY.high;
}
