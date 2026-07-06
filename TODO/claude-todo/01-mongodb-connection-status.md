# 01 — MongoDB Connection Status ✅

**Status:** Done (shipped via PR #6/#7).

## Goal
Surface live MongoDB connection health in the UI, served through the Thingtime
API, with a compact footer indicator linking to a full status page.

## What exists
- `remix/app/api/utils/mongodb/status.ts`
  - `getMongoUri()` — resolves the connection string from
    `MONGODB_CONNECTION_STRING` (swapping the `<db_password>` placeholder for
    `MONGO_PASS`, URL-encoded), falling back to `THINGTIME_PRIVATE_MONGODB_URI`
    / `MONGODB_URI` / `mongodb://localhost:27017`.
  - `getMongoStatus()` — connects, runs `db.command({ ping: 1 })` with a 2s
    fast-fail, lists collections, always closes the client. Returns
    `{ connected, host, dbName, pingMs, collections, checkedAt, error }`
    (host is credential-stripped for safe display).
- `remix/app/routes/api/v1/mongodb/status/_status.tsx` — `GET`/`POST` loader+action
  returning the status (always HTTP 200; truth is in the body).
- `remix/app/routes/mongodb-status.tsx` — full status page + re-check button.
- `remix/app/components/MongoDB/MongoStatus.tsx` — footer indicator (coloured
  dot + ping), used in `remix/app/components/Nav/Footer.tsx`.

## Verified
Live on the Vercel preview: `connected: true`, host `thingtime.4ekjigs.mongodb.net`,
db `thingtime`, ~220ms ping.

## Possible follow-ups (nice-to-have)
- Auto-refresh the footer indicator on an interval.
- Show collection list / document counts on the status page.
- Reuse `getMongoUri()` inside `connection.ts` so every helper shares one
  connection-string source (currently `connection.ts` has its own, fragile,
  HTTP-ping-based `getConnection`).
