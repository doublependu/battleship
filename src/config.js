// Shared constants. Game rules + tuning live here so the balance sim and the browser use the same numbers.

export const BOARD_SIZE = 10;
export const CELLS = BOARD_SIZE * BOARD_SIZE;
export const ROWS = 'ABCDEFGHIJ';

/** 1990 Milton Bradley fleet. */
export const FLEET = [
  { type: 'carrier', name: 'Carrier', length: 5 },
  { type: 'battleship', name: 'Battleship', length: 4 },
  { type: 'cruiser', name: 'Cruiser', length: 3 },
  { type: 'submarine', name: 'Submarine', length: 3 },
  { type: 'destroyer', name: 'Destroyer', length: 2 },
];
export const TOTAL_SHIP_CELLS = FLEET.reduce((n, s) => n + s.length, 0);
export const SHIP_BY_TYPE = Object.fromEntries(FLEET.map((s) => [s.type, s]));

export const cellName = (r, c) => `${ROWS[r]}${c + 1}`;

/**
 * AI difficulty parameters. Tuned with `npm run sim` against the human-proxy bot (see ai/plan_0.md §4.3).
 * - easy.pDrift: chance to wander back to random hunting while it has unresolved hits
 * - normal.mistakeRate: chance of a random hunt shot instead of a parity shot
 * - hard.temperature: softmax temperature over normalised density in hunt mode (0 = strongest)
 */
export const DIFFICULTIES = {
  easy: { label: 'Recruit', pDrift: 0.55 },
  normal: { label: 'Captain', mistakeRate: 0.4 },
  hard: { label: 'Admiral', temperature: 0.12 },
};
export const DEFAULT_DIFFICULTY = 'normal';

// World layout: 1 cell = 1 unit. Boards side by side on the x axis, rows run along +z (A at the back).
export const BOARD_GAP = 3;
export const BOARD_CENTER_X = { player: -(BOARD_SIZE + BOARD_GAP) / 2, enemy: (BOARD_SIZE + BOARD_GAP) / 2 };

/** Simulation domain around both boards (world units). */
export const SIM_DOMAIN = { minX: -16, maxX: 16, minZ: -8, maxZ: 8 };
/** Physical ripple speed (world units / s) and damping (1/s), shared by the GPU sim and the CPU ripple model. */
export const RIPPLE_SPEED = 4;
export const RIPPLE_DAMPING = 0.55;

/** Pacing, in game-clock seconds (divided by the e2e speed factor). */
export const TIMING = {
  shellFlight: 0.7,
  aiShellFlight: 0.8,
  afterImpact: 0.32,
  aiThink: 0.35,
  afterSunk: 2.3, // keep the camera on a sinking ship long enough to watch it go down
  cameraPan: 0.6,
};

/** Graphics tiers. See ai/plan_0.md §5.5. */
export const TIERS = {
  low: { name: 'Low', dprCap: 1, sim: [128, 64], simHz: 30, detail: false, particles: 512, standard: false,
    seeThrough: false, ultra: false, grid: [96, 64], voices: 10, audioVariants: 2, reverb: false },
  medium: { name: 'Medium', dprCap: 1.5, sim: [256, 128], simHz: 60, detail: true, particles: 1024, standard: true,
    seeThrough: false, ultra: false, grid: [160, 96], voices: 16, audioVariants: 3, reverb: true },
  high: { name: 'High', dprCap: 2, sim: [256, 128], simHz: 60, detail: true, particles: 2048, standard: true,
    seeThrough: true, ultra: false, grid: [192, 128], voices: 24, audioVariants: 3, reverb: true },
  ultra: { name: 'Ultra', dprCap: 2, sim: [512, 256], simHz: 120, detail: true, particles: 2048, standard: true,
    seeThrough: true, ultra: true, grid: [384, 224], voices: 24, audioVariants: 3, reverb: true },
};
export const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];
