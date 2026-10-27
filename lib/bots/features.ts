// Cheap postflop features, computed for all 1,326 combos at once. See README.md.
//
// Strength is a percentile: the share of the other live combos this combo's made hand beats on the
// current board (ties count half), from one evaluator lookup per combo. Draws (flush draw, open-ended,
// gutshot) and board texture are bit tricks on suit counts and rank masks. No Monte Carlo anywhere.

import { type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO } from "../poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, HAND_VALUE_COUNT, evaluateState, handState } from "../poker/evaluator";

export type Draw = "none" | "gutshot" | "straight" | "flush" | "combo";

export interface Texture {
  /** Most cards of one suit on the board. */
  maxSuit: number;
  /** The board has a pair (or better). */
  paired: boolean;
  /** Three board ranks fit inside one five-rank window, so a straight is possible. */
  connected: boolean;
  /** 0 (dry) .. 1 (very wet): how many draws the board allows. */
  wet: number;
}

export interface BoardInfo {
  board: Card[];
  /** Percentile strength per combo (0 for combos that use a board card). */
  strength: Float64Array;
  /** 1 for combos that do not use a board card. */
  live: Uint8Array;
  texture: Texture;
  suitCount: number[];
  rankMask: number;
  /** Straight-completing ranks for the board alone (-1 if the board is a straight). */
  boardOuts: number;
}

// Local copies: imported bindings are property reads under Vitest/Turbopack (see lib/poker/README.md).
const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI;
const evalState = evaluateState;

const cache = new Map<string, BoardInfo>();
const CACHE_LIMIT = 64;

/** Features of a 3-5 card board, cached by board. */
export function boardInfo(board: readonly Card[]): BoardInfo {
  const cacheKey = board.join(",");
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  if (board.length < 3 || board.length > 5) throw new Error(`boardInfo needs 3-5 board cards, got ${board.length}`);
  const st = handState(board);
  const dead = new Uint8Array(52);
  for (const c of board) dead[c] = 1;

  const values = new Uint16Array(COMBO_COUNT);
  const live = new Uint8Array(COMBO_COUNT);
  const counts = new Uint32Array(HAND_VALUE_COUNT + 1);
  let total = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    const a = COMBO_HI[c], b = COMBO_LO[c];
    if (dead[a] || dead[b]) continue;
    const v = evalState(st.key + KEY[a] + KEY[b], st.suits + SUIT[a] + SUIT[b], st.lo | LO[a] | LO[b], st.hi | HI[a] | HI[b]);
    values[c] = v;
    live[c] = 1;
    counts[v]++;
    total++;
  }
  // below[v] = number of live combos with a smaller value.
  const below = new Uint32Array(HAND_VALUE_COUNT + 1);
  for (let v = 1; v <= HAND_VALUE_COUNT; v++) below[v] = below[v - 1] + counts[v - 1];
  const strength = new Float64Array(COMBO_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (!live[c]) continue;
    const v = values[c];
    strength[c] = (below[v] + (counts[v] - 1) / 2) / (total - 1);
  }

  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  let pairs = false;
  for (const c of board) {
    suitCount[c & 3]++;
    if (rankMask & (1 << (c >> 2))) pairs = true;
    rankMask |= 1 << (c >> 2);
  }
  const maxSuit = Math.max(...suitCount);
  const connected = windowMax(rankMask) >= 3;
  const flushy = board.length < 5 && maxSuit === 2 ? 0.35 : maxSuit >= 3 ? 0.6 : 0;
  const texture: Texture = { maxSuit, paired: pairs, connected, wet: Math.min(1, flushy + (connected ? 0.5 : 0)) };

  const info: BoardInfo = {
    board: board.slice(),
    strength,
    live,
    texture,
    suitCount,
    rankMask,
    boardOuts: straightOuts(rankMask),
  };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cacheKey, info);
  return info;
}

/** The best draw a combo has on this board (always "none" on the river). */
export function drawOf(info: BoardInfo, combo: number): Draw {
  if (info.board.length >= 5) return "none";
  const a = COMBO_HI[combo], b = COMBO_LO[combo];
  const sa = a & 3, sb = b & 3;
  const flushA = info.suitCount[sa] + 1 + (sb === sa ? 1 : 0);
  const flushB = info.suitCount[sb] + 1 + (sb === sa ? 1 : 0);
  const flush = flushA === 4 || flushB === 4;
  let straight = 0;
  if (info.boardOuts >= 0) {
    const outs = straightOuts(info.rankMask | (1 << (a >> 2)) | (1 << (b >> 2)));
    if (outs > info.boardOuts) straight = outs >= 2 ? 2 : 1;
  }
  if (flush && straight > 0) return "combo";
  if (flush) return "flush";
  return straight === 2 ? "straight" : straight === 1 ? "gutshot" : "none";
}

/** 13-bit rank mask -> 14-bit mask with the ace also at the bottom (bit 0 = ace-low). */
const withLowAce = (mask: number): number => ((mask << 1) | ((mask >> 12) & 1)) & 0x3fff;

function hasStraight(mask: number): boolean {
  const m = withLowAce(mask);
  return (m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4)) !== 0;
}

/** Number of ranks that would complete a straight; -1 if the mask already holds one. */
export function straightOuts(mask: number): number {
  if (hasStraight(mask)) return -1;
  let outs = 0;
  for (let r = 0; r < 13; r++) if (!(mask & (1 << r)) && hasStraight(mask | (1 << r))) outs++;
  return outs;
}

/** Most board ranks inside any window of five consecutive ranks (ace counts high and low). */
function windowMax(mask: number): number {
  const m = withLowAce(mask);
  let best = 0;
  for (let lo = 0; lo + 5 <= 14; lo++) {
    let n = 0;
    for (let r = lo; r < lo + 5; r++) if (m & (1 << r)) n++;
    best = Math.max(best, n);
  }
  return best;
}
