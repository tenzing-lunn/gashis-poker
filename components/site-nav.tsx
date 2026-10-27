"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ROOMS = [
  { href: "/learn", label: "LEARN" },
  { href: "/drill", label: "DRILL" },
  { href: "/play", label: "PLAY" },
  { href: "/lab", label: "LAB" },
  { href: "/review", label: "REVIEW" },
] as const;

function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The site header as one numbered line. `pathname` null renders no current page. */
export function NavLine({ pathname }: { pathname: string | null }) {
  const current = (href: string) => (isCurrent(pathname, href) ? ("page" as const) : undefined);
  return (
    <nav aria-label="Site" className="site-nav l">
      <Link href="/" aria-current={current("/")}>
        GASHI&apos;S POKER
      </Link>
      <span className="rooms">
        {ROOMS.map((room) => (
          <Link key={room.href} href={room.href} aria-current={current(room.href)}>
            {room.label}
          </Link>
        ))}
      </span>
    </nav>
  );
}

export function SiteNav() {
  return <NavLine pathname={usePathname()} />;
}
