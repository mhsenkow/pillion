# Co-op ride protocol

Pillion co-op pairs a **driver** (main game / TV) with a **gunner** (phone gun pad). Rooms are short-lived; wire format lives in `src/net/coopProtocol.ts`.

## Roles

| Role   | Entry                         | Sends                         | Receives        |
|--------|-------------------------------|-------------------------------|-----------------|
| Driver | `index.html` / game with co-op  | `host` binary snapshots       | `gun` input     |
| Gunner | `gun.html?coop=CODE`          | `gun` JSON input              | `host` snapshots |

## Room lifecycle

1. **Create** — `POST /api/coop/new` → `{ code, join }` (4-char code).
2. **Connect** — WebSocket `GET /api/coop/ws?code=CODE&role=driver|gunner|auto`.
3. **Welcome** — `{ t: 'welcome', role, code, peers }`; first open seat wins `driver`, second `gunner` (`ride_full` if both taken).
4. **Play** — Driver emits ~12 Hz `host` frames (binary `0x48` or JSON in dev). Gunner emits `gun` aim/fire/weapon.
5. **Peer presence** — `{ t: 'peer', role, online, peers }` on join/leave.
6. **Drop / state** — Optional `drop`, `state`, `evt`, `toast`, `hb` for lobby UX and pings.
7. **Teardown** — Last socket closes; Durable Object room idles (dev: in-memory map deletes empty rooms).

## Wire formats

- **JSON** — All control messages except host snap use `JSON.stringify` + `t` discriminator.
- **Host binary** — Tag `0x48`, version `1`, little-endian `Float32` bike/zombie payload, UTF-8 `place` + `objective` trailers (`encodeHostBinary` / `decodeHostBinary`).

## URLs

- TV / driver share: `gun?coop=CODE` (from `coopShareUrl`).
- Manual join lobby: `/join` → redirects to gun pad with code.
- Local dev: Vite plugin mirrors `/api/coop/*` and `/api/osm` without Wrangler.

## Dev notes

- Validate inbound size with `validateIncoming` (64 KB cap on binary).
- Gunner profile persisted in `localStorage` (`pillion.gunner.profile`).
- Stale / malformed frames: room may emit `{ t: 'error', code: 'bad_message' }`.