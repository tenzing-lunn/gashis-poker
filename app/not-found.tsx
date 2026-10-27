import type { Metadata } from "next";
import { Blank, BoxButton, Line, Sheet } from "@/components/doc";

export const metadata: Metadata = {
  title: "Not found · Gashi's Poker",
};

/** Unknown URLs and `notFound()` (e.g. a table link that is not a table id). */
export default function NotFound() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">NOT FOUND</span>
      </Line>
      <Blank />
      <Line as="p">NOTHING LIVES AT THIS ADDRESS. A TABLE LINK IS /PLAY/T/ FOLLOWED BY 64 CHARACTERS OF 0–9 AND A–F.</Line>
      <Blank />
      <Line>
        <span className="flex flex-wrap gap-[2ch]">
          <BoxButton href="/" filled>
            HOME →
          </BoxButton>
          <BoxButton href="/play">PLAY →</BoxButton>
        </span>
      </Line>
      <Blank />
    </Sheet>
  );
}
