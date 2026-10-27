import type { MDXComponents } from "mdx/types";

// Required by @next/mdx in the App Router. Lesson styling and shared lesson
// components are passed per page in app/learn/[slug]/page.tsx.
const components: MDXComponents = {};

export function useMDXComponents(): MDXComponents {
  return components;
}
