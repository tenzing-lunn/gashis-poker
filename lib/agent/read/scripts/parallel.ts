// A tiny worker-thread pool for the Reader's scripts. A script calls runJobs(import.meta.url, jobs)
// from the main thread; the same file, loaded in a worker, calls serveJobs(fn) to answer each job.
// Jobs and results must be structured-cloneable. Results come back in job order.

import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

export { isMainThread };

export async function runJobs<J, R>(file: string, jobs: readonly J[], threads = availableParallelism()): Promise<R[]> {
  const results = new Array<R>(jobs.length);
  let next = 0;
  let done = 0;
  const start = performance.now();
  const work = async () => {
    const worker = new Worker(new URL(file));
    try {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await new Promise<R>((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.postMessage(jobs[i]);
        });
        worker.removeAllListeners("error");
        done++;
        process.stderr.write(`\r${done}/${jobs.length} jobs, ${((performance.now() - start) / 1000).toFixed(0)} s`);
      }
    } finally {
      await worker.terminate();
    }
  };
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, work));
  process.stderr.write("\n");
  return results;
}

export function serveJobs<J, R>(fn: (job: J) => R): void {
  parentPort!.on("message", (job: J) => parentPort!.postMessage(fn(job)));
}
