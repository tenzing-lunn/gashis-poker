// Preset river spots for the Lab's river solver. Sizes are in percent of the pot, as typed in the form.

export interface RiverForm {
  board: string;
  oopRange: string;
  ipRange: string;
  pot: string;
  stack: string;
  /** Percent of the pot, comma-separated. */
  oopBets: string;
  ipBets: string;
  /** Percent of the pot after calling. */
  raises: string;
  allIn: boolean;
  maxRaises: number;
}

export interface RiverPreset {
  id: string;
  name: string;
  blurb: string;
  form: RiverForm;
}

export const RIVER_PRESETS: readonly RiverPreset[] = [
  {
    id: "dry-k",
    name: "Dry king-high board, single-raised pot",
    blurb: "A blind-vs-button style spot: OOP holds a capped range of kings, middle pairs and missed draws; IP adds sets and overpairs. Two bet sizes, one raise.",
    form: {
      board: "Ks7d2c9h4s",
      oopRange: "AK, KQ, KJ, KT, K9s, QQ, JJ, TT, 99, 88, 77, 66, 22, A9s, A7s, 98s, 87s, 76s, 65s",
      ipRange: "AA, KK, AK, KQ, KJ, 99, 77, 44, AQs, AJs, QJs, QTs, JTs, T8s, 86s, 65s, 53s, A5s, A4s",
      pot: "10",
      stack: "50",
      oopBets: "33, 75",
      ipBets: "33, 75",
      raises: "100",
      allIn: true,
      maxRaises: 1,
    },
  },
  {
    id: "polar",
    name: "Polarized vs bluff-catcher (textbook)",
    blurb: "IP holds top set (KK) or jack-high air (JT); OOP holds QQ, which beats every bluff and loses to every value hand, and may only check. Expect IP to bluff B/(P+2B) of its bets and OOP to call P/(P+B).",
    form: {
      board: "Ks9d6c3h2s",
      oopRange: "QQ",
      ipRange: "KK, JT",
      pot: "10",
      stack: "100",
      oopBets: "",
      ipBets: "100",
      raises: "",
      allIn: false,
      maxRaises: 0,
    },
  },
  {
    id: "flush",
    name: "Flush completes, wider ranges",
    blurb: "The third heart arrives. Wider ranges on both sides (about 200 combos each), two sizes for each player, a raise and all-in.",
    form: {
      board: "9h8h5c2dKh",
      oopRange: "99-22, AKs-A2s, KQs-K9s, QJs-Q9s, JTs-J9s, T9s, T8s, 98s, 87s, 76s, 65s, AKo-ATo, KQo, KJo",
      ipRange: "AA-22, AKs-A2s, KQs-KTs, QJs, QTs, JTs, T9s, 98s, 87s, 76s, AKo-AJo, KQo",
      pot: "12",
      stack: "60",
      oopBets: "50, 100",
      ipBets: "50, 100",
      raises: "100",
      allIn: true,
      maxRaises: 1,
    },
  },
];
