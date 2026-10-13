// Colors for the intro's world. Kept here rather than in theme.ts because
// they only make sense inside the scene: stylized-natural tones that sit
// comfortably next to the app's parchment, pine and ink.

export const Palette = {
  // Sky
  skyTop: '#5B8DBF',
  skyHorizon: '#C3DAE5',
  // What distance fades toward, near the horizon
  haze: '#A9C1CB',

  // The trail
  mud: '#5C4632',
  mudDark: '#3F2F21',
  mudLight: '#7A6146',
  mudWet: '#3A322B',
  puddle: '#56676B',

  // Grass
  grassDeep: '#2C3D1E',
  grass: '#4A6230',
  grassLight: '#6E8A3D',
  grassDry: '#8E8B4C',

  // Forest floor under the trees: needle litter, moss, and patches of
  // sunlight coming through the canopy.
  forestFloor: '#2F2F1B',
  needles: '#4B3C27',
  floorMoss: '#44562B',
  sunfleck: '#8A8A48',

  // Trail-edge rocks, in three stones: grey granite, warm sandstone, and
  // grey with moss on it.
  rock: '#7B766B',
  rockLit: '#A29C8C',
  rockDark: '#45423B',
  sandstone: '#86735A',
  sandstoneLit: '#AD9B7D',
  sandstoneDark: '#4E4233',
  moss: '#5F6B4A',

  // Pines
  pineDeep: '#1F2C19',
  pine: '#2E4225',
  pineMid: '#3F5831',
  pineLit: '#5E7A46',
  pineTip: '#7E9C5A',
  trunk: '#4A3521',
  trunkLit: '#6B4E2E',

  // White-tailed deer: warm brown coat, darker along the back, pale belly
  // and throat. Legs on the far side are in shadow.
  deerBack: '#5E3B22',
  deerCoat: '#8A5A35',
  deerCoatLit: '#A16C42',
  deerFar: '#4E321D',
  deerPale: '#E6DCC6',
  deerDark: '#2B2119',
  antler: '#D6C6A0',

  // The hiker: red plaid jacket, khaki trousers, a green toque.
  hikerJacket: '#A8392C',
  hikerPlaid: '#6B2119',
  hikerPants: '#7B6E4C',
  hikerPantsShade: '#5E5439',
  hikerBoots: '#3A281B',
  hikerSkin: '#D6A27A',
  hikerBeard: '#5A3A22',
  hikerToque: '#2F5B3B',
  hikerToqueCuff: '#244730',
  hikerPom: '#EDE3CC',
  hikerPack: '#3B4A2E',
  hikerStrap: '#27301F',
  hikerPole: '#4A4A46',

  // The CN Tower: pale concrete, lit from the left; dark glass in the pods.
  towerLit: '#DCD5C5',
  tower: '#B5AD9C',
  towerShade: '#857D6F',
  towerUnder: '#6D685E',
  towerGlass: '#3D4550',
  towerGlint: '#C9A45C',

  // Peggy's Cove lighthouse: a white tower, sunlit on its left, with a red
  // lantern room and roof; dark glazing with a warm lamp behind it.
  lighthouseLit: '#FBF8F0',
  lighthouse: '#E8E4DA',
  lighthouseShade: '#A7ABAA',
  lighthousePlinth: '#C9C4B8',
  lighthouseRed: '#B8322A',
  lighthouseRedLit: '#D04B3B',
  lighthouseRedShade: '#7C211C',
  lighthouseUnder: '#74261F',
  lighthouseGlass: '#2C3E44',
  lighthouseLamp: '#F2D488',
  lighthouseDoor: '#6E2A22',
  // The granite it stands on, and the boulders round it: pale and worn
  // smooth, with dark joints and patches of lichen.
  graniteLit: '#D3C7B8',
  granite: '#A99D8E',
  graniteDark: '#71675D',
  graniteJoint: '#4F4841',
  lichen: '#B8963F',
  lichenGrey: '#9DA28B',
  beacon: '#D8412F',
  plazaStone: '#B7AD98',
  plazaJoint: '#7E7566',

  // The black bear, a tan muzzle; the flock, dark against the sky.
  bearFur: '#1F1D22',
  bearNear: '#2E2B33',
  bearFar: '#131216',
  bearRim: '#3B3742',
  bearMuzzle: '#8C6B4B',
  bearDark: '#0A0A0B',
  bearClaw: '#CFC6B4',
  bird: '#26262B',

  // The Niagara Escarpment: a pale dolostone cap over darker, softer shale,
  // wet and dark where the falls spray it; loose rubble at its foot.
  cliffCap: '#A99F8A',
  cliffCapLit: '#C4BBA6',
  cliffStrata: '#7D7263',
  cliffShale: '#6A5D51',
  cliffWet: '#3E3D38',
  cliffJoint: '#4F463D',
  cliffMoss: '#5D6B45',
  scree: '#8B8373',

  // The falls: glassy green where the water tips over the lip, breaking
  // into white; the pond below, deep green-blue with foam.
  fallsGlass: '#2F6E62',
  fallsGreen: '#4E9888',
  fallsWhite: '#EDF4F2',
  fallsStreak: '#B7D0D2',
  mist: '#F2F7F7',
  pondDeep: '#1F4E4F',
  pond: '#3C7470',
  pondFoam: '#DDEBE8',
  shoreWet: '#3B3A2E',

  // The stream: darker and greener than the pond, between earth banks; the
  // footbridge's weathered planks and log kerbs.
  streamDeep: '#1B3E40',
  streamWater: '#3A6F6B',
  bank: '#6E573B',
  bankDark: '#4A3A2A',
  plank: '#8C6C49',
  plankLight: '#A07F58',
  plankDark: '#78593A',
  plankGap: '#2A1F16',
  deckFace: '#56402C',
  kerb: '#5F4630',
  kerbShade: '#46331F',
  kerbTop: '#8A6A4A',
  kerbEnd: '#B09268',

  // The compass in the sky at the end: the app's logo, in its pine.
  compass: '#3B4A2E',

  // Contact shadows on the ground
  shadow: '#1A1A10',
} as const;

// '#RRGGBB' → [r, g, b] in 0–1, for shader constants and color mixing.
export function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
