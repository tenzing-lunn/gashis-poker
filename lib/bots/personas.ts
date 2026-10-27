// Bot personas: parameter sets over the one baseline policy in policy.ts. See README.md.
//
// Preflop widths are fractions of all 1,326 combos, taken from the top of the shared hand ranking in
// preflop.ts (0.15 = the best 15% of hands). Postflop thresholds are on the strength percentile from
// features.ts (0.8 = beats 80% of random hands on this board). Frequencies are probabilities.

export type PersonaId = "nit" | "tag" | "lag" | "station" | "maniac" | "micro";

export type OpenPosition = "UTG" | "MP" | "LJ" | "HJ" | "CO" | "BTN" | "SB";

/** Per street: flop, turn, river. */
export type ByStreet = readonly [number, number, number];

export interface Persona {
  id: PersonaId;
  name: string;
  /** One line on what the persona is for. */
  intent: string;

  // Preflop ------------------------------------------------------------------
  /** Raise-first-in width by position when everyone before has folded (6-max names; see view.ts). */
  open: Readonly<Record<OpenPosition, number>>;
  /** Heads-up button (small blind) raise-first-in width. */
  huOpen: number;
  /** Width played (raised or limped) when nobody has raised; anything above `open` is limped. 0 = never open-limps. */
  limp: number;
  /** Open-raise size in big blinds (+1 bb per limper when isolating). */
  openSize: number;
  /** Width raised over limpers (the big blind uses 80% of it). */
  isoRaise: number;
  /** Value 3-bet width vs a single raise. */
  threeBet: number;
  /** Probability of 3-betting a hand from THREE_BET_BLUFFS that is not a value 3-bet. */
  threeBetBluff: number;
  /** Flat-call width vs a single raise, on top of the 3-bets (scaled by position and raise size). */
  flat: number;
  /** Value 4-bet width vs a 3-bet. */
  fourBet: number;
  /** Width that calls a 3-bet, on top of the 4-bets. */
  callThreeBet: number;
  /** Width that jams vs a 4-bet or more. */
  jam: number;
  /** Width that calls a 4-bet or more, on top of the jams. */
  callJam: number;

  // Postflop -----------------------------------------------------------------
  /** Strength needed to bet for value when checked to (+0.035 per extra opponent). */
  valueBet: ByStreet;
  /** Extra strength over `valueBet` needed to raise for value. */
  raiseGap: number;
  /** Strength needed to call a half-pot bet (moves with the price; draws use their draw value). */
  call: ByStreet;
  /** Bet frequency with non-value hands as the preflop aggressor on the flop (c-bet bluffs). */
  cbet: number;
  /** Turn bet frequency with non-value hands after betting the flop. */
  barrel: number;
  /** River bet frequency with non-value hands after betting the turn. */
  riverBluff: number;
  /** Bet frequency with non-value hands when not the aggressor (stabs, probes, donks). */
  stab: number;
  /** Bet frequency with draws (raises with draws at 35% of this). */
  semibluff: number;
  /** Raise frequency with air facing a bet (halved on the river). */
  bluffRaise: number;
  /** Extra call threshold facing a turn or river bet from a player who also bet the previous street. */
  barrelFold: number;
  /** Extra call threshold facing a raise on the river. */
  riverRaiseFold: number;
  /** Bet-size weights for 33% / 66% / 100% pot. */
  sizes: ByStreet;
  /** 0..1: how much value hands size up and bluffs size down (a readable sizing tell). */
  sizingTell: number;
}

export const NIT: Persona = {
  id: "nit",
  name: "Nit",
  intent: "Plays very few hands, rarely bluffs, folds to pressure. Teaches stealing blinds and folding to its bets.",
  open: { UTG: 0.11, MP: 0.11, LJ: 0.12, HJ: 0.14, CO: 0.19, BTN: 0.28, SB: 0.2 },
  huOpen: 0.4,
  limp: 0,
  openSize: 3,
  isoRaise: 0.05,
  threeBet: 0.03,
  threeBetBluff: 0,
  flat: 0.035,
  fourBet: 0.015,
  callThreeBet: 0.02,
  jam: 0.02,
  callJam: 0.005,
  valueBet: [0.86, 0.88, 0.9],
  raiseGap: 0.08,
  call: [0.7, 0.75, 0.8],
  cbet: 0.45,
  barrel: 0.2,
  riverBluff: 0.05,
  stab: 0.05,
  semibluff: 0.3,
  bluffRaise: 0,
  barrelFold: 0.03,
  riverRaiseFold: 0.05,
  sizes: [0.3, 0.5, 0.2],
  sizingTell: 0.2,
};

export const TAG: Persona = {
  id: "tag",
  name: "TAG",
  intent: "Tight-aggressive regular: position-aware ranges, c-bets by texture, balanced-ish bluffs. The baseline.",
  open: { UTG: 0.17, MP: 0.18, LJ: 0.19, HJ: 0.23, CO: 0.3, BTN: 0.48, SB: 0.4 },
  huOpen: 0.75,
  limp: 0,
  openSize: 2.5,
  isoRaise: 0.12,
  threeBet: 0.065,
  threeBetBluff: 0.35,
  flat: 0.07,
  fourBet: 0.022,
  callThreeBet: 0.04,
  jam: 0.025,
  callJam: 0.01,
  valueBet: [0.8, 0.83, 0.86],
  raiseGap: 0.1,
  call: [0.6, 0.66, 0.71],
  cbet: 0.65,
  barrel: 0.4,
  riverBluff: 0.25,
  stab: 0.15,
  semibluff: 0.55,
  bluffRaise: 0.05,
  barrelFold: 0,
  riverRaiseFold: 0,
  sizes: [0.45, 0.4, 0.15],
  sizingTell: 0,
};

export const LAG: Persona = {
  id: "lag",
  name: "LAG",
  intent: "Loose-aggressive: wider opens and 3-bets, more barrels and bluff-raises. Teaches calling down lighter.",
  open: { UTG: 0.24, MP: 0.25, LJ: 0.27, HJ: 0.32, CO: 0.42, BTN: 0.62, SB: 0.52 },
  huOpen: 0.85,
  limp: 0,
  openSize: 2.5,
  isoRaise: 0.18,
  threeBet: 0.1,
  threeBetBluff: 0.6,
  flat: 0.11,
  fourBet: 0.035,
  callThreeBet: 0.06,
  jam: 0.03,
  callJam: 0.015,
  valueBet: [0.76, 0.79, 0.83],
  raiseGap: 0.08,
  call: [0.6, 0.65, 0.7],
  cbet: 0.75,
  barrel: 0.55,
  riverBluff: 0.35,
  stab: 0.3,
  semibluff: 0.7,
  bluffRaise: 0.12,
  barrelFold: 0,
  riverRaiseFold: 0,
  sizes: [0.35, 0.45, 0.2],
  sizingTell: 0,
};

export const STATION: Persona = {
  id: "station",
  name: "Calling station",
  intent: "Limps and calls with almost anything, rarely raises or bluffs. Teaches thin value betting and not bluffing.",
  open: { UTG: 0.05, MP: 0.05, LJ: 0.05, HJ: 0.06, CO: 0.07, BTN: 0.09, SB: 0.06 },
  huOpen: 0.12,
  limp: 0.45,
  openSize: 3,
  isoRaise: 0.04,
  threeBet: 0.015,
  threeBetBluff: 0,
  flat: 0.38,
  fourBet: 0.01,
  callThreeBet: 0.18,
  jam: 0.012,
  callJam: 0.06,
  valueBet: [0.88, 0.9, 0.93],
  raiseGap: 0.09,
  call: [0.45, 0.48, 0.52],
  cbet: 0.15,
  barrel: 0.05,
  riverBluff: 0.02,
  stab: 0.03,
  semibluff: 0.1,
  bluffRaise: 0,
  barrelFold: 0,
  riverRaiseFold: 0,
  sizes: [0.6, 0.3, 0.1],
  sizingTell: 0.3,
};

export const MANIAC: Persona = {
  id: "maniac",
  name: "Maniac",
  intent: "Raises and re-raises constantly, bluffs every street. Teaches calling down and trapping.",
  open: { UTG: 0.5, MP: 0.5, LJ: 0.55, HJ: 0.6, CO: 0.68, BTN: 0.82, SB: 0.72 },
  huOpen: 0.95,
  limp: 0,
  openSize: 3,
  isoRaise: 0.4,
  threeBet: 0.22,
  threeBetBluff: 0.8,
  flat: 0.25,
  fourBet: 0.1,
  callThreeBet: 0.2,
  jam: 0.08,
  callJam: 0.1,
  valueBet: [0.62, 0.66, 0.7],
  raiseGap: 0.06,
  call: [0.55, 0.6, 0.66],
  cbet: 0.9,
  barrel: 0.75,
  riverBluff: 0.55,
  stab: 0.6,
  semibluff: 0.9,
  bluffRaise: 0.3,
  barrelFold: 0,
  riverRaiseFold: 0,
  sizes: [0.15, 0.4, 0.45],
  sizingTell: 0.1,
};

/** The low-stakes pool from RESEARCH.md section 2, item 6. */
export const MICRO: Persona = {
  id: "micro",
  name: "Micro-stakes regular",
  intent:
    "The typical low-stakes pool: loose-passive preflop (limps, calls too much), sticky on the flop, overfolds to turn and triple barrels, rarely bluffs the river, so big river bets and raises are value.",
  open: { UTG: 0.11, MP: 0.11, LJ: 0.12, HJ: 0.13, CO: 0.17, BTN: 0.22, SB: 0.14 },
  huOpen: 0.3,
  limp: 0.36,
  openSize: 3.5,
  isoRaise: 0.1,
  threeBet: 0.03,
  threeBetBluff: 0.02,
  flat: 0.28,
  fourBet: 0.015,
  callThreeBet: 0.1,
  jam: 0.02,
  callJam: 0.04,
  valueBet: [0.82, 0.86, 0.88],
  raiseGap: 0.1,
  call: [0.52, 0.56, 0.6],
  cbet: 0.55,
  barrel: 0.25,
  riverBluff: 0.03,
  stab: 0.08,
  semibluff: 0.2,
  bluffRaise: 0.02,
  barrelFold: 0.2,
  riverRaiseFold: 0.05,
  sizes: [0.3, 0.4, 0.3],
  sizingTell: 0.7,
};

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  nit: NIT,
  tag: TAG,
  lag: LAG,
  station: STATION,
  maniac: MANIAC,
  micro: MICRO,
};

export const PERSONA_IDS: readonly PersonaId[] = ["nit", "tag", "lag", "station", "maniac", "micro"];
