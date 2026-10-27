"use client";

import { useCallback, useEffect, useRef } from "react";
import type { JobFor, ResponseFor, SolverJobKind, SolverResponse } from "@/lib/gto/worker-protocol";

let nextId = 1;

/**
 * One solver worker per caller (each Lab panel has its own, so a long Kuhn run never delays a push/fold
 * solve). The worker is created on the first run and terminated on unmount or stop().
 *
 * run() posts a job and routes that job's responses to `onMessage`; responses from any earlier job are
 * dropped, so a stale result can never overwrite a newer one.
 */
export function useSolverWorker<K extends SolverJobKind>(kind: K) {
  const workerRef = useRef<Worker | null>(null);
  const currentRef = useRef<{ id: number; onMessage: (msg: ResponseFor<K>) => void } | null>(null);

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    currentRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (job: JobFor<K>, onMessage: (msg: ResponseFor<K>) => void): number => {
      let worker = workerRef.current;
      if (!worker) {
        worker = new Worker(new URL("../../../workers/solver.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<SolverResponse>) => {
          const current = currentRef.current;
          if (current && e.data.id === current.id) current.onMessage(e.data as ResponseFor<K>);
        };
        worker.onerror = (e) => {
          e.preventDefault();
          const current = currentRef.current;
          const message = e.message || "The solver worker failed to load.";
          if (current) current.onMessage({ id: current.id, kind, type: "error", message } as ResponseFor<K>);
        };
        workerRef.current = worker;
      }
      const id = nextId++;
      currentRef.current = { id, onMessage };
      worker.postMessage({ ...job, id });
      return id;
    },
    [kind],
  );

  return { run, stop };
}
