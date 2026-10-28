import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Blank, Line, Sheet } from "@/components/doc";
import { isTableId } from "@/components/multiplayer/storage";
import { normalizeTableCode } from "@/lib/multiplayer/code";
import TableClient from "./table-client";

export const metadata: Metadata = {
  title: "Table · Gashi's Poker",
  description: "A no-limit hold'em table shared with friends.",
};

// The table code is URL data, so the table renders inside a Suspense boundary. A code typed in another
// case (`/play/t/kqmxwd`) goes to its uppercase URL.
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
  if (!isTableId(tableId)) {
    const code = normalizeTableCode(tableId);
    if (code) redirect(`/play/t/${code}`);
    notFound();
  }
  return <TableClient tableId={tableId} />;
}
