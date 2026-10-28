// The Practice page's sim worker: spot equity + ranges and decision grading off the main thread.
// Jobs live in jobs.ts, message types in protocol.ts.
//
// One job runs at a time. A newer request or a "cancel" (which bump `active`) stops the running job at
// its next yield; the page can also terminate the worker. Finished results are kept in an LRU cache for
// the worker's lifetime, so revisiting a spot answers at once.
//
// Load with: new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" }).

import { LruCache } from "./cache";
import { runJob, type CachedResult, type JobContext } from "./jobs";
import type { SimRequest } from "./protocol";

interface WorkerScope {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (e: MessageEvent<SimRequest>) => void): void;
}

// Worker wiring (skipped when this module is imported outside a worker, e.g. in Node).
const WorkerGlobal = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
const scope: WorkerScope | undefined =
  WorkerGlobal !== undefined && globalThis instanceof WorkerGlobal ? (globalThis as unknown as WorkerScope) : undefined;

if (scope) {
  let active = 0;
  const cache = new LruCache<CachedResult>();
  const ctxFor = (id: number): JobContext => ({
    post: (msg) => scope.postMessage(msg),
    isCurrent: () => active === id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    cache,
  });
  scope.addEventListener("message", (e) => {
    const req = e.data;
    if (req.kind === "cancel") {
      if (active === req.id) active = 0;
      return;
    }
    active = req.id;
    void runJob(req, ctxFor(req.id));
  });
}
