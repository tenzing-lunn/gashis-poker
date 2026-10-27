import { Sheet } from "@/components/doc";

// The site nav (app/layout.tsx) is the only header; lessons and the index render into one document sheet.
export default function LearnLayout({ children }: LayoutProps<"/learn">) {
  return <Sheet className="flex-1">{children}</Sheet>;
}
