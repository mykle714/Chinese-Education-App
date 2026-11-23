# Sentence Tiles — deploy runbook

> ⚠️ **TEMPORARY.** Delete this file (and its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md))
> once every check below has passed on PPE.
>
> **Status: NOT DEPLOYED** (written 2026-11-23). Design: [SENTENCE_TILES_GAME.md](./SENTENCE_TILES_GAME.md).

Sentence Tiles ships **with its flag ON** (`FEATURE_FLAGS.sentenceTiles = true`,
`server/contracts/featureFlags.ts`), reached from the Menu popover → **Sentence Tiles**. Three things the
diff does not make obvious:

1. **Migration 204** (`database/migrations/204-create-sentence-tiles.sql`): additive, four new
   tables. Safe before the rebuild; the old code never reads them. It ships in a batch with 200, 202,
   203 (pre-rebuild) and the held-back contract **205**, so apply it **by hand** with the others. The
   batch order is in [STORY_COMMONALITY_DEPLOY_RUNBOOK.md](./STORY_COMMONALITY_DEPLOY_RUNBOOK.md)
   § "Step order". Do not run plain `migrate.sh` before the rebuild.
2. **New env var `SENTENCE_TILES_AI_API_KEY`**: the AI judge's own Anthropic key, kept apart from
   `DICT_AI_API_KEY` so its spend is billed and revocable on its own (`server/services/anthropicClient.ts`
   → `getSentenceTilesAiClient`). On PPE it goes in the **repo-root `.env`**: `docker-compose.ppe.yml`
   loads `env_file: ./.env`. **The owner supplies the key**; the agent does not create or copy one.
   Without it the game still loads, but every new line answers "Judging is unavailable right now"
   (only already-cached lines can be played).
3. **Spend limits** (approved 2026-11-22, `server/contracts/sentenceTiles.ts`): 40 judge calls per
   player per streak-day, 3 rejected lines per turn, 1,000 calls per day across all players. The
   model is Claude Sonnet 5.5 at low effort (`server/services/sentenceTiles/sentenceJudge.ts`).

## Step order

1. Follow the batch's steps 1–3 in the story runbook (pull → 200/202/203/204 by hand → rebuild both
   containers).
2. Add `SENTENCE_TILES_AI_API_KEY=<key>` to `~/vocabulary-app/.env` on PPE, then recreate the backend
   so it reads the env file: `docker-compose -f docker-compose.ppe.yml up -d backend` (**never** `down -v`).
   If the key is not available yet, skip this step: V1–V3 still pass and V5 shows the "unavailable" banner.
3. Run V1–V5.

## Verification

**V1: tables exist** (expected: four rows)
```sql
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('sentence_tile_games','sentence_tile_moves','sentence_tile_verdicts','sentence_tile_judge_usage')
 ORDER BY 1;
```

**V2: the router is mounted** (expected `401`: mounted, wants auth. A `404` means the flag is off or
the backend was not rebuilt)
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mren.me/api/sentenceTiles/games
```

**V3: the key reached the container** (expected: `set`; prints nothing secret)
```bash
docker exec cow-backend sh -c '[ -n "$SENTENCE_TILES_AI_API_KEY" ] && echo set || echo missing'
```

**V4 (in the app): two accounts that are friends AND feature testers.** The Menu row shows only to
an `isFeatureTester` account whose device has Settings → "Enable testing features" switched on
(`src/hooks/useTestingFeatures.ts`), and a game can only be started against a friend. On PPE
(checked 2026-11-23) the testers are michael, michael2, peter_ren and selena_ren; the only friend pair
among them is **michael2 ↔ peter_ren**. To use michael ↔ michael2, add them as friends first (`/friends`
→ add by friend code). Account A: Menu → Sentence Tiles → **New game** → pick B → place
3+ tiles across the centre square → **Play**.

**V5 (in the app): the judge answers.** A valid line (e.g. 我 | 喜欢 | 你) scores and passes the turn;
nonsense is rejected with a reason and the tiles return to the rack. Then on account B: the game
shows under "Your move"; playing a line accepts the challenge. Expected log line per judged line:
none on success; `[sentence-judge] call failed` means a bad key or API error.
```sql
-- Each judged line is cached here (expect ≥ 1 row after V5)
SELECT line, legal, reason FROM sentence_tile_verdicts ORDER BY "createdAt" DESC LIMIT 5;
```

## If a check fails

- **V2 = 404:** confirm the deployed `server/contracts/featureFlags.ts` has `sentenceTiles: true`
  and that the backend image was rebuilt.
- **V3 = missing:** the key is in the wrong file (`server/.env` is not read on PPE) or the
  container was not recreated after editing `.env`.
- **"Judging is unavailable" with V3 = set:** `docker logs --since 10m cow-backend | grep sentence-judge`
  shows the API error (an invalid key, or the global daily cap was reached).

## Rollback

Set `sentenceTiles: false`, commit, `/deploy` (both containers: the client inlines the flag). The
tables can stay. To remove them entirely:
`DROP TABLE sentence_tile_judge_usage, sentence_tile_verdicts, sentence_tile_moves, sentence_tile_games;`
plus `DELETE FROM schema_migrations WHERE version = 204;`.

## User-visible change

A new **Sentence Tiles** row in the Menu popover (games list at `/sentence-tiles`, a game at
`/sentence-tiles/:gameId`).
