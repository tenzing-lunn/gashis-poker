// The module 4 equity calculator's worker: keeps Monte Carlo and exact enumeration off the main thread.
// A newer request supersedes the running one, which stops at its next yield. The math is in equity-math.ts.

import { runEquityJob, type EquityRequest } from "./equity-math";

interface WorkerScope {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (e: MessageEvent<EquityRequest>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
let active = 0;

scope.addEventListener("message", (e) => {
  const req = e.data;
  active = req.id;
  void runEquityJob(req, {
    post: (msg) => scope.postMessage(msg),
    isCurrent: () => active === req.id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
  });
});
