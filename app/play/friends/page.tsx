import type { Metadata } from "next";
import FriendsClient from "./friends-client";

export const metadata: Metadata = {
  title: "Play with friends · Gashi's Poker",
  description: "Open a no-limit hold'em table, send the link to friends, fill the empty seats with bots.",
};

export default function FriendsPage() {
  return <FriendsClient />;
}
