# Multiplayer

Tables with friends run on a small Cloudflare Worker in `table-server/` (one Durable Object per table;
the game rules are `lib/multiplayer/room.ts`). The Next.js app talks to it over a WebSocket:
`/play/friends` creates a table, `/play/t/<tableId>` is the table.

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

Open http://localhost:3000/play/friends, create a table, and open the invite link as a second player
in a **private window or another browser**. A second normal window shares the first one's storage
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
`https://gashis-poker-tables.10zinglunn.workers.dev`. To ship changes: `cd table-server && npx wrangler deploy`
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
