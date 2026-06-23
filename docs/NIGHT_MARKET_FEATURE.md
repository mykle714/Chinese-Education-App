# Night Market Feature

## Overview

The Night Market is a visual reward system tied to work points. As users study and accumulate work points (1 point = 1 minute of active study), they unlock items that populate a personal night market scene. Each user's market is unique because unlocks are randomly selected from a pool and persisted for the life of the account.

---

## Coordinate System

When coordinates are given for night market assets, they are always in **isometric
grid units (isoX, isoY)**. See `src/utils/isometric.ts` for the full definition.

- **isoX** — distance along the isometric X axis (toward top-right on screen / east)
- **isoY** — distance along the isometric Y axis (toward top-left on screen / north)
- **Origin (0, 0)** — maps to the center of the viewport

All night market assets live at `/home/cow/src/assets/` (NOT `public/assets/` — Vite
imports these directly as modules).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                   │
│                                                                   │
│  MarketViewerPage ──▶ useNightMarket() ──▶ GET/POST /api/...    │
│       │                     │                                     │
│       ▼                     ▼                                     │
│  MarketViewer       nightMarketRegistry                          │
│  (canvas render)    (asset definitions)                          │
└──────────────────────────────┬────────────────────────────────────┘
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│                        Backend                                     │
│                                                                   │
│  NightMarketController                                           │
│       │                                                           │
│       ▼                                                           │
│  NightMarketService  ──▶  nightMarketRegistry (asset pool)       │
│       │                                                           │
│       ▼                                                           │
│  NightMarketDAL  ──▶  nightmarketunlocks table                   │
│       │                                                           │
│       ▼                                                           │
│  UserDAL.getTotalWorkPoints()  (threshold verification)          │
└───────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `nightmarketunlocks` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| userId | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | Owner of the unlock |
| assetId | VARCHAR(100) | NOT NULL | Key into the asset registry |
| unlockType | VARCHAR(20) | NOT NULL, DEFAULT 'stall' | Type of unlock (stall, person, etc.) |
| unlockOrder | INTEGER | NOT NULL, DEFAULT 0 | 0 = base set, 1+ = earned unlocks |
| createdAt | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | When the unlock was granted |

**Indexes:**
- `UNIQUE (userId, assetId)` — prevents duplicate unlocks
- `(userId, unlockOrder)` — fast ordered retrieval per user

---

## Asset Registry

All unlockable items are defined in TypeScript config files (not in the database). This keeps asset management in code alongside the image files.

**Asset files live at:** `src/assets/` (imported as Vite modules, not served from `public/`)

**Location:**
- Server: `server/config/nightMarketRegistry.ts`
- Frontend: `src/config/nightMarketRegistry.ts`

**Exports:**
- `NIGHT_MARKET_BASE_SET` — items every user receives automatically (unlockOrder = 0)
- `NIGHT_MARKET_UNLOCK_POOL` — items available for random unlock as users earn points
- `NIGHT_MARKET_CONFIG` — constants (e.g., `POINTS_PER_UNLOCK = 60`)

Each asset definition includes: `assetId`, `unlockType`, `displayName`, `description`, `imagePath`, `x`, `y`, `zIndex`, `scale`.

---

## Unlock Flow

### Threshold Calculation
- 1 unlock per 60 accumulated work points
- Allowed unlocks = `floor(totalWorkPoints / 60)`
- Base set items (unlockOrder = 0) do not count toward the earned unlock limit

### Sequence
1. Frontend detects `accumulativeWorkPoints >= nextThreshold` via `useNightMarket()` hook
2. User triggers unlock (e.g., taps an unlock button)
3. Frontend calls `POST /api/night-market/unlock`
4. Server verifies `totalWorkPoints` against `earnedUnlockCount * POINTS_PER_UNLOCK`
5. Server filters the unlock pool to exclude already-owned assets
6. Server picks a random item from the remaining pool
7. Server persists the selection in `nightmarketunlocks` with `unlockOrder = earnedCount + 1`
8. Server returns the new unlock to the frontend
9. Frontend adds the new item to the scene

### Base Set Seeding
On the first call to `GET /api/night-market/unlocks`, if the user has no unlock records, the service bulk-inserts all `NIGHT_MARKET_BASE_SET` items with `unlockOrder = 0`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/night-market/unlocks` | Get all unlocked items for the authenticated user. Seeds base set on first call. |
| POST | `/api/night-market/unlock` | Unlock the next random item. Returns 400 if insufficient points or pool exhausted. |

---

## Interaction (V1)

- **Tap to see info**: Tapping an item shows its `displayName` and `description` in a dialog
- **Tap to trigger event**: Reserved for future expansion (animations, sounds, etc.)

---

## Unlock Types

| Type | V1 | Description |
|------|-----|-------------|
| stall | Yes | Market stalls/stands |
| person | Yes | Characters/people |
| animal | Future | Animals |
| plant | Future | Plants/trees |
| road | Future | Road/path segments |
| item | Future | Decorative items |

---

## Files

| File | Role |
|------|------|
| `server/types/nightMarket.ts` | TypeScript interfaces for unlocks and API responses |
| `server/config/nightMarketRegistry.ts` | Server-side asset registry (base set + unlock pool) |
| `src/config/nightMarketRegistry.ts` | Frontend asset registry (same data) |
| `database/migrations/47-create-night-market-unlocks.sql` | Table creation migration |
| `server/dal/interfaces/INightMarketDAL.ts` | DAL interface |
| `server/dal/implementations/NightMarketDAL.ts` | DAL implementation |
| `server/services/NightMarketService.ts` | Business logic (unlock verification, random selection, base set seeding) |
| `server/controllers/NightMarketController.ts` | HTTP request/response handling |
| `src/hooks/useNightMarket.ts` | Frontend hook for fetching unlocks and triggering new unlocks |
| `src/pages/MarketViewerPage.tsx` | Page component — builds layers from unlocks + registry |
| `src/components/MarketViewer.tsx` | Canvas renderer with pan/zoom and tap interaction |

## Known Bugs

### Ped z-sort against stands at extreme zoom-out (zoom-aware fallback)

**Where:** `src/components/MarketEngineViewer.tsx` strip-emission path, `src/utils/isometric.ts` `computeStripPlacements`.

**Symptom:** When the camera is zoomed far enough that each sprite strip would be under ~8 screen px wide, the renderer falls back to emitting a stand as a single unsliced sprite (instead of 2F strips) to keep the per-frame sprite count bounded. In that mode, the painter's-algorithm foot anchor is the stand's SW corner, so a pedestrian whose `isoX + isoY` exceeds the stand's SW sum renders in front of the entire roof — even when the ped is geometrically *beside* the stand rather than in front of it. Slicing fixes this at normal zoom; the fallback re-exposes the pre-fix behavior.

**Future fix:** Switch the unsliced fallback's foot anchor from the SW corner to the stand's geometric center (`swX + F/2, swY + F/2`). Cheaper than re-enabling slicing and resolves most "ped pops in front of roof" cases by halving the worst-case z-error.

