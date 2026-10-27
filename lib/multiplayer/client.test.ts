import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTable, createTable, CreateTableError, MAX_FAILED_OPENS, type TableClientEvent } from "./client";

const ID = "a".repeat(64);

/** A WebSocket the test drives: `open()`, `fail()` (never opened) or `drop()` (closes after opening). */
class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail() {
    this.readyState = 3;
    this.onclose?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

/** The probe answers with this status (or a network error when null). */
let probeStatus: number | null = 426;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  probeStatus = 426;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (probeStatus === null) throw new TypeError("Failed to fetch");
      return new Response(null, { status: probeStatus });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connect() {
  const events: TableClientEvent[] = [];
  const client = connectTable("http://localhost:8787", ID, {
    name: "Alice",
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    pingIntervalMs: 1_000_000,
  });
  client.on((e) => events.push(e));
  const rejected = () => events.filter((e) => e.type === "rejected");
  return { client, events, rejected };
}

/** Lets the probe's promise settle, then runs the backoff timer so the next socket is created. */
async function settleAndRetry() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(20_000);
}

describe("connectTable gives up when retrying cannot help", () => {
  it("stops with no_such_table when the probe answers 404", async () => {
    probeStatus = 404;
    const { client, rejected } = connect();
    latest().fail();
    await settleAndRetry();
    expect(rejected()).toEqual([{ type: "rejected", code: "no_such_table", message: expect.any(String) }]);
    expect(FakeSocket.all).toHaveLength(1);
    expect(client.status).toBe("closed");
  });

  it("stops with origin_refused when the probe answers 403", async () => {
    probeStatus = 403;
    const { rejected } = connect();
    latest().fail();
    await settleAndRetry();
    expect(rejected().map((e) => e.type === "rejected" && e.code)).toEqual(["origin_refused"]);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it(`stops with unreachable after ${MAX_FAILED_OPENS} attempts that never opened`, async () => {
    probeStatus = null;
    const { rejected } = connect();
    for (let i = 0; i < MAX_FAILED_OPENS; i++) {
      expect(rejected()).toHaveLength(0);
      latest().fail();
      await settleAndRetry();
    }
    expect(rejected().map((e) => e.type === "rejected" && e.code)).toEqual(["unreachable"]);
    expect(FakeSocket.all).toHaveLength(MAX_FAILED_OPENS);
  });

  it("keeps retrying a dropped connection that had opened, however long the outage", async () => {
    probeStatus = null;
    const { rejected } = connect();
    latest().open();
    latest().drop();
    await settleAndRetry();
    for (let i = 0; i < MAX_FAILED_OPENS * 3; i++) {
      latest().fail();
      await settleAndRetry();
    }
    expect(rejected()).toHaveLength(0);
    expect(FakeSocket.all.length).toBeGreaterThan(MAX_FAILED_OPENS * 3);
    // ...and it comes back when the server does.
    latest().open();
    expect(latest().sent[0]).toContain('"join"');
  });

  it("still learns that a table is gone after having been connected", async () => {
    const { rejected } = connect();
    latest().open();
    latest().drop();
    await settleAndRetry();
    probeStatus = 404;
    latest().fail();
    await settleAndRetry();
    expect(rejected().map((e) => e.type === "rejected" && e.code)).toEqual(["no_such_table"]);
  });

  it("resets the count of failed attempts when a socket opens", async () => {
    probeStatus = 503;
    const { rejected } = connect();
    for (let i = 0; i < MAX_FAILED_OPENS - 1; i++) {
      latest().fail();
      await settleAndRetry();
    }
    expect(rejected()).toHaveLength(0);
    latest().open();
    latest().drop();
    await settleAndRetry();
    latest().fail();
    await settleAndRetry();
    expect(rejected()).toHaveLength(0);
  });

  it("sends report false while the socket is not open", () => {
    const { client } = connect();
    expect(client.sendSit(1)).toBe(false);
    latest().open();
    expect(client.sendSit(1)).toBe(true);
  });
});

describe("createTable", () => {
  it("tells a refused site from an unreachable server", async () => {
    probeStatus = 403;
    await expect(createTable("http://localhost:8787")).rejects.toMatchObject({ reason: "origin_refused", status: 403 });
    probeStatus = null;
    await expect(createTable("http://localhost:8787")).rejects.toMatchObject({ reason: "unreachable", status: null });
    probeStatus = 500;
    const e = await createTable("http://localhost:8787").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CreateTableError);
    expect(e).toMatchObject({ reason: "failed", status: 500 });
  });
});
