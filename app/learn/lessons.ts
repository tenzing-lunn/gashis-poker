import type { MDXContent } from "mdx/types";

export interface LessonInfo {
  slug: string;
  module: number;
  title: string;
  summary: string;
  load: () => Promise<{ default: MDXContent }>;
}

// The course in order (PLAN.md §2). Each lesson is content/NN-slug.mdx.
export const LESSONS: readonly LessonInfo[] = [
  {
    slug: "rules",
    module: 0,
    title: "Rules & mechanics",
    summary: "Hand rankings, positions, blinds, betting rounds and side pots.",
    load: () => import("@/content/00-rules.mdx"),
  },
  {
    slug: "combinatorics",
    module: 1,
    title: "Combinatorics",
    summary: "1,326 starting hands, 169 hand classes, and counting combos after card removal.",
    load: () => import("@/content/01-combinatorics.mdx"),
  },
  {
    slug: "outs",
    module: 2,
    title: "Probability & outs",
    summary: "Exact outs math, the rule of 2 and 4, and where the shortcut breaks.",
    load: () => import("@/content/02-outs.mdx"),
  },
  {
    slug: "pot-odds",
    module: 3,
    title: "Pot odds & EV",
    summary: "The equity a call needs, the EV of a call, and implied odds.",
    load: () => import("@/content/03-pot-odds.mdx"),
  },
  {
    slug: "equity",
    module: 4,
    title: "Equity & ranges",
    summary: "Hand vs range, range vs range, and equity realization.",
    load: () => import("@/content/04-equity.mdx"),
  },
  {
    slug: "game-theory",
    module: 5,
    title: "Game theory with toy games",
    summary: "Kuhn poker solved live, the AKQ game, bluff ratios and MDF.",
    load: () => import("@/content/05-game-theory.mdx"),
  },
  {
    slug: "preflop",
    module: 6,
    title: "Preflop",
    summary: "Heads-up push/fold and 6-max opening ranges by position.",
    load: () => import("@/content/06-preflop.mdx"),
  },
  {
    slug: "postflop",
    module: 7,
    title: "Postflop",
    summary: "Board texture, range and nut advantage, c-betting and geometric sizing.",
    load: () => import("@/content/07-postflop.mdx"),
  },
  {
    slug: "exploitation",
    module: 8,
    title: "Exploitation",
    summary: "Reading tendencies from stats and adjusting away from equilibrium.",
    load: () => import("@/content/08-exploitation.mdx"),
  },
  {
    slug: "variance",
    module: 9,
    title: "Variance & bankroll",
    summary: "Standard deviation, confidence intervals, sample size and risk of ruin.",
    load: () => import("@/content/09-variance.mdx"),
  },
];

export function lessonBySlug(slug: string): LessonInfo | undefined {
  return LESSONS.find((l) => l.slug === slug);
}
