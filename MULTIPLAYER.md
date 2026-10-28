# Multiplayer

Tables with friends run on a small Cloudflare Worker in `table-server/` (one Durable Object per table;
the game rules are `lib/multiplayer/room.ts`). The Next.js app talks to it over a WebSocket:
`/play/friends` creates a table or joins one by its code, `/play/t/<CODE>` is the table.

## Table codes and routes

A table is named by a 6-letter code such as `KXRTVM`, from `ABCDEFGHJKMNPQRSTUVWXYZ` (no I, L or O),
so a friend can read it out or type it in any case (`lib/multiplayer/code.ts`). 23^6 ≈ 148M codes.

| Route | What |
|---|---|
| `GET /tables/new[?seats=2..8]` (server) | Draws a random code, maps it to a Durable Object with `idFromName(code)` and creates the table there; a code a live table already holds is refused and another is drawn. Answers `{"tableId": "KXRTVM"}`. |
| `GET /tables/<CODE>/ws` (server) | The table's WebSocket. Uppercase codes only (clients uppercase). 404 when no table holds the code, 426 for a plain GET of a live table (the client's probe). |
| `/play/friends` (site) | Nickname, JOIN WITH CODE (checks the code exists first), recent tables, and CREATE TABLE. |
| `/play/t/<CODE>` (site) | The table. A lowercase code redirects to uppercase. |

- Joining sends `sit: true`: a new player takes the lowest free seat, so the creator sits in seat 1 and
  friends are seated as they arrive (a full table leaves them watching). A reconnect keeps whatever seat
  the player had, or none.
- A table that has had nobody connected for 2 hours closes: its storage is wiped and the code can be
  drawn again. Its old link then says the table is gone.

## Leaving, bots for players, ending

| Message | Who | What |
|---|---|---|
| `leave` | anyone | `[LEAVE]`: stands up for good (at the end of the hand if dealt in) and goes back to `/play/friends`. The seat remembers the chips they left with (`vacated`), so the host's `[+ BOT]` there plays those chips for them. A host who leaves hands the role on at once. |
| `replaceWithBot` | host | `[BOT IN]` on a player's row: a bot takes the seat and the player's chips (at the end of the hand if they are dealt in). If the player was away (disconnected, sitting out or leaving), they get the seat back with the bot's chips when they return (rejoin or sit there), at the end of the bot's hand. A player taken out while present does not. |
| `removePlayer` | host | `[REMOVE]` on a player's row: the player stands up (at the end of the hand) and watches; their chips stay theirs. They can't undo it with `[STAY]`. |
| `endTable` | host | `[END TABLE]`, then `[CONFIRM — ENDS FOR EVERYONE]`: the table ends after the hand in progress (at once between hands). Everyone gets a last `state` with `ended.rows` (each player's chips and net, buy-ins and rebuys counted; a bot standing in for a player counts as that player), every socket is closed with code 4002 (the client stops, no reconnect), and the storage is wiped like the idle close, so the code answers 404. |

Every buy-in and rebuy is counted per player (`buyIns`), so the final net is chips minus buy-ins. A bot the host
removes hands its chips back to the player it stood in for, when that player has no seat.

The app finds the server through `NEXT_PUBLIC_TABLE_SERVER_URL` (default `http://localhost:8787`, see
`.env.example`). The server only accepts browsers from the origins it is told about.

## Run locally

Two terminals:

```sh
# 1. the table server, on :8787 (allows http://localhost:3000)
cd table-server && npm install && npm run dev

# 2. the site, on :3000
npm run dev
```

Open http://localhost:3000/play/friends, create a table, and join as a second player (type the code on
`/play/friends` or open the link) in a **private window or another browser**. A second normal window shares the first one's storage
(nickname and seat token), so it rejoins as you instead of as a new player.

Use `localhost`, not `127.0.0.1`: `npm run dev` in `table-server/` allows only the origin
`http://localhost:3000`. Any other address (`http://127.0.0.1:3000`, another port, a LAN address) is
refused until you add it to `DEV_ORIGINS`, e.g.
`npx wrangler dev --port 8787 --var DEV_ORIGINS:http://localhost:3000,http://127.0.0.1:3000`.

## Play with a friend on the same network

1. Find your machine's LAN address, e.g. `192.168.1.20`.
2. Start the site on that address: `npm run dev -- -H 192.168.1.20` (the dev server only serves its
   dev assets to `localhost` and the hostname it was started with; or `npm run build && npm start -- -H 0.0.0.0`).
3. Point the site at the server by its LAN address, in `.env.local`:
   `NEXT_PUBLIC_TABLE_SERVER_URL=http://192.168.1.20:8787` (restart `npm run dev` after changing it).
4. Start the table server on all interfaces and allow the LAN origin of the site:
   ```sh
   cd table-server
   npx wrangler dev --ip 0.0.0.0 --port 8787 \
     --var DEV_ORIGINS:http://localhost:3000,http://192.168.1.20:3000
   ```
5. Both of you open `http://192.168.1.20:3000/play/friends` (not `localhost`, or the invite link only
   works on your machine).

If a page says the server does not accept connections from this site, the page's origin is missing
from `DEV_ORIGINS` (local) or `ALLOWED_ORIGIN` (deployed).

## Deploy

Live now: site `https://gashis-poker.vercel.app` (Vercel project `gashis-poker`), table server
`https://gashis-poker-tables.10zinglunn.workers.dev`. Deploy the server and the site together when the
table routes change (the 6-letter codes replaced 64-hex ids: old links stop working). To ship changes: `cd table-server && npx wrangler deploy`
for the server, `vercel deploy --prod` from the root for the site (`.vercelignore` keeps `.claude/`,
`table-server/` and `oracle/` out of the upload).

First-time setup, for reference:

1. Deploy the table server: `cd table-server && npx wrangler login && npm run deploy`. Note the URL it
   prints (`https://gashis-poker-tables.<account>.workers.dev`).
2. Allow the site's origin on the server: set `ALLOWED_ORIGIN` to the Vercel URL (comma-separate several,
   e.g. the production domain and `https://<project>.vercel.app`), either in `table-server/wrangler.jsonc`
   `vars` and deploy again, or in the Cloudflare dashboard (Worker → Settings → Variables).
3. On Vercel, set `NEXT_PUBLIC_TABLE_SERVER_URL` to the worker URL from step 1 (Project → Settings →
   Environment Variables), then redeploy the site: `NEXT_PUBLIC_` values are baked in at build time.
4. Check: open `/play/friends` on the deployed site, create a table, join from a second device.
