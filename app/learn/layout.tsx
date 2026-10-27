import Link from "next/link";

export default function LearnLayout({ children }: LayoutProps<"/learn">) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 text-sm">
          <Link href="/learn" className="font-semibold tracking-tight">
            Gashi&apos;s Poker · Learn
          </Link>
          <span className="text-zinc-500">10-module course</span>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
