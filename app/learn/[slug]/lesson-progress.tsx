"use client";

import type { ReactNode } from "react";
import { LessonSlug } from "../_components/progress";

/** Tells the checks inside which lesson they belong to, so they can record progress. */
export function LessonProgressProvider({ slug, children }: { slug: string; children: ReactNode }) {
  return <LessonSlug value={slug}>{children}</LessonSlug>;
}
