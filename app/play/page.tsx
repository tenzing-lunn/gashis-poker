import type { Metadata } from "next";
import PlayClient from "./play-client";

export const metadata: Metadata = {
  title: "Play · Gashi's Poker",
  description: "Practice no-limit hold'em against a table of bots with known strategies.",
};

export default function PlayPage() {
  return <PlayClient />;
}
