"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Rule, TextButton } from "@/components/doc";
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
    <>
      <div ref={listRef} role="toolbar" aria-label="Lab tools" onKeyDown={onKey} className="l">
        <span className="flex flex-wrap gap-x-[2ch]">
          {TABS.map((t) => (
            <TextButton
              key={t.id}
              id={`tab-${t.id}`}
              pressed={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)}
              className="whitespace-nowrap"
            >
              {t.label}
            </TextButton>
          ))}
        </span>
      </div>
      <Rule />
      {TABS.map(({ id, Panel }) => (
        <section key={id} id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tab !== id}>
          {visited.has(id) && <Panel />}
        </section>
      ))}
    </>
  );
}
