// Table server entry point.
//
//   GET /tables/new[?seats=2..8][&turn=20|30|45|60]
//                                 -> {"tableId": "KQMXWD"}  (draws a free 6-letter code, creates its table)
//   GET /tables/:code/ws          -> WebSocket upgrade, forwarded to that table's Durable Object
//                                    (403 refused origin, 404 no such table, 426 not an upgrade)
//
// A table code names its Durable Object (`idFromName`). A new table only takes a code no live table
// holds (PokerTable.init refuses, and another code is drawn); see lib/multiplayer/code.ts.
//
// Only browsers on the origins in ALLOWED_ORIGIN (plus DEV_ORIGINS, which `npm run dev` sets to
// http://localhost:3000) may create tables or open sockets.

import { claimFreshCode, isTableCode, NoFreeCodeError } from "../../lib/multiplayer/code";
import { parseSeatsParam, parseTurnParam } from "../../lib/multiplayer/room";
import type { Env } from "./table";

export { PokerTable } from "./table";

function allowedOrigins(env: Env): Set<string> {
  const list = `${env.ALLOWED_ORIGIN ?? ""},${env.DEV_ORIGINS ?? ""}`
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set(list);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** For refusals the browser client must be able to read (status only; no credentials, no data). */
const READABLE = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    const originOk = origin === null || "Access-Control-Allow-Origin" in cors;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originOk && origin ? 204 : 403, headers: cors });
    }
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

    if (url.pathname === "/tables/new") {
      // Tables are created from our site only (browsers always send Origin on a cross-origin fetch).
      if (!origin || !originOk) return new Response("Origin not allowed", { status: 403, headers: READABLE });
      const seats = parseSeatsParam(url.searchParams.get("seats"));
      if (seats === null) {
        return Response.json({ error: "seats must be 2-8" }, { status: 400, headers: cors });
      }
      const turnMs = parseTurnParam(url.searchParams.get("turn"));
      if (turnMs === null) {
        return Response.json({ error: "turn must be 20, 30, 45 or 60" }, { status: 400, headers: cors });
      }
      const random = () => crypto.getRandomValues(new Uint32Array(1))[0];
      let code: string;
      try {
        code = await claimFreshCode((c) => env.TABLES.get(env.TABLES.idFromName(c)).init({ seats, turnMs }), random);
      } catch (e) {
        if (e instanceof NoFreeCodeError) {
          return Response.json({ error: "no free table code; try again" }, { status: 503, headers: cors });
        }
        console.error("creating a table failed", e);
        return Response.json({ error: "could not create a table" }, { status: 500, headers: cors });
      }
      return Response.json({ tableId: code }, { headers: { ...cors, "Cache-Control": "no-store" } });
    }

    const ws = /^\/tables\/([^/]*)\/ws$/.exec(url.pathname);
    if (ws) {
      // Browsers always send Origin on a WebSocket handshake; only our sites may open one. The 403 and
      // 404 answers are readable from any page so the client's plain-GET probe can tell a refused origin
      // and a missing table from being offline (client.ts).
      if (!origin || !originOk) return new Response("Origin not allowed", { status: 403, headers: READABLE });
      // The code is checked before the upgrade, so the probe (no Upgrade header) learns about it too.
      // Clients send it uppercase (lib/multiplayer/code.ts normalizeTableCode).
      if (!isTableCode(ws[1])) return new Response("No such table", { status: 404, headers: READABLE });
      const id = env.TABLES.idFromName(ws[1]);
      // The table answers 404 if it was never created by /tables/new, then 426 without an upgrade.
      const res = await env.TABLES.get(id).fetch(request);
      if (res.status === 101) return res;
      return new Response(res.body, { status: res.status, headers: READABLE });
    }

    if (url.pathname === "/") return new Response("gashi's poker table server\n", { headers: cors });
    return new Response("Not found", { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
