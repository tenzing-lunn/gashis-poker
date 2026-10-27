"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AkqPanel } from "./akq-panel";
import { KuhnPanel } from "./kuhn-panel";
import { PushFoldPanel } from "./pushfold-panel";
import { RiverPanel } from "./river-panel";
import { VariancePanel } from "./variance-panel";

const TABS = [
  { id: "kuhn", label: "Kuhn CFR", Panel: KuhnPanel },
  { id: "akq", label: "AKQ game", Panel: AkqPanel },
  { id: "pushfold", label: "Push/fold", Panel: PushFoldPanel },
  { id: "variance", label: "Variance", Panel: VariancePanel },
  { id: "river", label: "River solver", Panel: RiverPanel },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Tabs whose panels mount on first visit and then stay mounted (hidden), so a Kuhn run keeps going
 * while you look at another tool, and nothing is computed for tabs you never open.
 */
export function LabTabs() {
  const [tab, setTab] = useState<TabId>("kuhn");
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set<TabId>(["kuhn"]));
  const listRef = useRef<HTMLDivElement>(null);

  const select = (id: TabId) => {
    setTab(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const j = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (j < 0) return;
    e.preventDefault();
    select(TABS[j].id);
    listRef.current?.querySelector<HTMLElement>(`#tab-${TABS[j].id}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-8">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Lab tools"
        onKeyDown={onKey}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 dark:border-zinc-800"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 ${
              tab === t.id ? "border-foreground text-foreground" : "border-transparent text-zinc-500 hover:text-foreground dark:text-zinc-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map(({ id, Panel }) => (
        <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={tab !== id}>
          {visited.has(id) && <Panel />}
        </div>
      ))}
    </div>
  );
}
