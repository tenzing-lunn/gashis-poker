import type { Metadata } from "next";
import { Blank, BoxButton, Line, Sheet } from "@/components/doc";

export const metadata: Metadata = {
  title: "No such table · Gashi's Poker",
};

/** `notFound()` from the table page: the address does not hold a table code. */
export default function TableNotFound() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">NOT FOUND</span>
      </Line>
      <Blank />
      <Line as="p">NO TABLE AT THIS ADDRESS. A TABLE CODE IS 6 LETTERS, E.G. /PLAY/T/KXRTVM.</Line>
      <Blank />
      <Line>
        <span className="flex flex-wrap gap-[2ch]">
          <BoxButton href="/play/friends" filled>
            JOIN WITH A CODE →
          </BoxButton>
          <BoxButton href="/play">PLAY →</BoxButton>
        </span>
      </Line>
      <Blank />
    </Sheet>
  );
}
