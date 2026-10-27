import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Blank, Line, Sheet } from "@/components/doc";
import { isTableId } from "@/components/multiplayer/storage";
import TableClient from "./table-client";

export const metadata: Metadata = {
  title: "Table · Gashi's Poker",
  description: "A no-limit hold'em table shared with friends.",
};

// The table id is URL data, so the table renders inside a Suspense boundary.
export default function TablePage({ params }: { params: Promise<{ tableId: string }> }) {
  return (
    <Suspense
      fallback={
        <Sheet className="flex-1">
          <Blank />
          <Line>
            <span className="text-muted">LOADING TABLE…</span>
          </Line>
        </Sheet>
      }
    >
      <Table params={params} />
    </Suspense>
  );
}

async function Table({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  if (!isTableId(tableId)) notFound();
  return <TableClient tableId={tableId} />;
}
