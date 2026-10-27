import type { Metadata } from "next";
import Link from "next/link";
import { Line, Sheet } from "@/components/doc";
import PlayClient from "./play-client";

export const metadata: Metadata = {
  title: "Play · Gashi's Poker",
  description: "Practice no-limit hold'em against a table of bots with known strategies.",
};

export default function PlayPage() {
  return (
    <>
      <Sheet as="div">
        <Line>
          <Link href="/play/friends">PLAY WITH FRIENDS →</Link>
        </Line>
      </Sheet>
      <PlayClient />
    </>
  );
}
