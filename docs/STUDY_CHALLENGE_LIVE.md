# Study Challenge — Live (synchronous) mode

**Status: DESIGN / DRAFT — phase 2.** Nothing here is built. The async challenge
([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 1–6, 8–12) is fully specified and buildable
without any of this; live mode is strictly additive and must stay that way.

This document is the phase-2 half of the Study Challenge design. It owns everything that
requires two players to be **in the app at the same moment**: the transport, the room, the
invite, and what happens when one of them walks away. The async document owns the
challenge itself — words, decks, windows, scoring, results — and remains the source of
truth for all of it. **Live mode changes only *when* rounds are played, never *what* a
round is or *how* it is scored.**

---

## Table of contents

1. [What live mode is](#1-what-live-mode-is)
2. [Transport: a WebSocket at `/api/ws` (Q19)](#2-transport-a-websocket-at-apiws-q19)
3. [The room](#3-the-room)
4. [Getting two people into the room (Q21)](#4-getting-two-people-into-the-room-q21)
5. [The waiting room and its 1-minute timeout (Q18)](#5-the-waiting-room-and-its-1-minute-timeout-q18)
6. [Playing a live round (Q20)](#6-playing-a-live-round-q20)
7. [Every game needs a run length](#7-every-game-needs-a-run-length)
8. [Collapse: what happens when the room dies](#8-collapse-what-happens-when-the-room-dies)
9. [Data model: no new table](#9-data-model-no-new-table)
10. [Layering map](#10-layering-map)
11. [What phase 1 must not foreclose](#11-what-phase-1-must-not-foreclose)
12. [Question log](#12-question-log)
13. [Code ↔ doc dependencies](#13-code--doc-dependencies)

---

## 1. What live mode is

During the Friday test window, either player may press **Play live**. Instead of each
player running the three rounds alone whenever they like, both run them **at the same
time**, seeing each other's score after each round.

What is identical to async:

* the same 10 words, the same variant, the same three games in the same hidden order
  (STUDY_CHALLENGE.md § 5.1, § 5.1b);
* the same per-round scoring contract (`challengeScoring`) and the same
  contested/filler distinction (§ 5.4);
* the same persistence — a completed live round is written to
  `study_challenges.rounds` by exactly the same service call an async round uses;
* the same window, the same `no_contest`, the same winner resolution (§ 6).

What is different:

* the two players' rounds are **interleaved in real time** rather than independent;
* between rounds there is a **shared scoreboard** and **both must confirm** to advance;
* every game gains a **hard time limit** (§ 7), because a live round must end at a time
  the server can predict.

### Live is all-or-nothing, and it is offered first

> **A challenge may go live only while *neither* player has recorded a single round.**

This is the load-bearing rule of the whole document, and it comes directly from the async
design: rounds are strictly sequential with one attempt each (STUDY_CHALLENGE.md § 5.1a),
so there is no coherent way to play round 1 alone on Friday morning and round 2 together
on Friday evening — the opponent's round 1 would already be banked and visible.

Consequences, all deliberate:

* **Play live disappears the moment either player starts async.** The control is gated on
  `rounds` being empty for both players. A player who wants a live match must not tap
  Start until they have given up on it.
* **Live may be attempted any number of times.** A failed invite, a timeout, a cancelled
  waiting room — none of them consume anything, because none of them write a round. Retry
  is free and unlimited.
* **A collapsed session cannot be resumed live.** Once round 1 is banked, the remaining
  rounds are async for both players (§ 8). Live is entered once or not at all.

---

## 2. Transport: a WebSocket at `/api/ws` (Q19)

**Decision (2026-08-16): a single WebSocket endpoint.** Rejected: SSE + POST, and short
polling.

Three properties of this deployment made WebSocket the cheap option rather than the
expensive one:

| Property | Where it comes from | Why it matters |
|---|---|---|
| **nginx already forwards the upgrade** | `nginx.conf` — the `location /api` block already sets `Upgrade: $http_upgrade` and `Connection: 'upgrade'` | The reverse proxy needs **no change**. This config was written for something else and happens to be exactly what a WS handshake needs |
| **There is exactly one backend container** | `docker-compose*.yml` — `backend` is a single service, not a replica set | Room state can live in **process memory**. No Redis, no pub/sub fan-out between nodes, no sticky sessions |
| **The room is tiny and short-lived** | Two players, three rounds, a few minutes | The entire live-mode state footprint is a `Map<challengeId, Room>` holding at most a handful of entries |

The alternatives lose on coherence, not on capability:

* **SSE + POST** splits one conversation across two half-channels with different failure
  modes — the stream can be alive while the POST path is 401ing on a rotated token, and
  the server cannot tell. It also collides with nginx's default `proxy_read_timeout`
  (60s), so it would need either a raised timeout or a keepalive comment stream. That is
  the same amount of plumbing as a WebSocket for a strictly worse channel.
* **Short polling** at 1–2s makes "both confirmed → go" feel laggy at exactly the moment
  the feature is supposed to feel shared, and it puts a steady query load on the database
  for the duration of every session. It is the right answer for a feature where latency
  does not matter; live mode is the definition of a feature where it does.

### What the WebSocket layer must handle

1. **Auth on connect, and only on connect.** The access token rotates roughly every 15
   minutes (see [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)),
   and a long-lived socket **must not** be torn down when it rotates — that would be the
   socket-level version of the banned "reload the page on a silent token refresh" rule.
   The socket authenticates once at handshake time and then trusts its established
   identity for its lifetime. A live session is minutes long; the token's remaining
   validity at connect time is not a security boundary worth re-checking mid-round.
   * ⚠️ **Do not put the token in the URL query string.** It lands in nginx access logs.
     Send it as the first frame, and let the server close the socket if the first frame
     is not a valid auth frame within a couple of seconds.
2. **Reconnect is the client's job.** A backend redeploy kills every socket at once.
   Clients reconnect with backoff and re-announce which challenge they are in; the server
   rebuilds the room from `study_challenges` plus whatever the reconnecting clients claim.
   Because durable state is entirely in the table (§ 9), a redeploy mid-session costs a
   few seconds of a shared scoreboard, not a round.
3. **The socket carries live mode only.** It is not a general-purpose realtime bus, and
   nothing in §§ 1–6 of the async design may start depending on it. If it is down, the
   whole Study Challenge feature still works — you just cannot play live.

---

## 3. The room

A **room** is the in-memory object representing one challenge that is currently being
played live. Its shape (proposed):

```ts
type LiveRoom = {
  challengeId: string;
  members: Map<userId, { socket: WebSocket; joinedAt: number }>;
  phase: "waiting" | "round" | "scoreboard";
  roundIndex: 1 | 2 | 3;
  roundEndsAt: number | null;   // server clock; set when a round starts (§ 7)
  confirmed: Set<userId>;       // cleared on every phase change
};
```

Rules:

* **The room is created by the first player to press Play live** and destroyed when it
  empties, when the challenge completes, or when the window closes.
* **The room is not authoritative about anything durable.** Scores go to
  `study_challenges.rounds` through `StudyChallengeService.recordRound` — the same path
  async uses, with the same insert-only `jsonb_set` guard (STUDY_CHALLENGE.md § 9). If
  the room's idea of the score and the table's disagree, the table wins and the room is
  wrong.
* **A player may be in at most one room.** Pressing Play live on a second challenge
  leaves the first, which collapses it (§ 8).

### The between-rounds gate

After each round both clients receive both breakdowns and render the shared scoreboard.
Each player taps **Ready**; the room advances when `confirmed.size === 2`.

A confirmation is **revoked** if that player's socket closes or their client reports
`visibilitychange → hidden`. The room must never advance into a round one player is not
present for — the *start* of a round is the one moment where presence is genuinely
required, because a round that starts without you costs you the round (§ 6).

⚠️ **The gate needs a bound.** If one player confirms and the other simply never does, the
room cannot sit open forever. **Proposed: the same 1 minute used by the waiting room
(§ 5), after which the session collapses to async (§ 8).** Flagged rather than assumed —
see Q69 in the log.

---

## 4. Getting two people into the room (Q21)

**Decision (2026-08-16): live-invite delivery is a native-shell demand, not a web
problem.** It has been logged as a concrete product demand in
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) § "Concrete product demands on a
native shell", alongside coarse location and the general notification demand.

The reasoning is that no web mechanism can deliver this invite:

* There is **no push infrastructure in the repo at all** — no service worker push, no
  APNs/FCM, nothing.
* Web push on iOS requires the user to have installed the app to the Home Screen (16.4+),
  which is a precondition we cannot rely on and cannot detect gracefully.
* An invite that only reaches players who already have the app open reaches almost
  nobody: the whole point is to summon a friend who is doing something else.

So live mode's invite is **gated on the Capacitor shell**. This does not block the async
feature, and it does not block *building* live mode either — it bounds who can be reached:

| Shell | Invite delivery | Practical reach |
|---|---|---|
| **Web today** | in-app only, over the invitee's own WebSocket, as a banner on whatever screen they are on | works when both players happen to be in the app — realistically, when they coordinated out of band ("open the app, I'm challenging you") |
| **Capacitor** | `@capacitor/push-notifications` → APNs/FCM, tapped straight into the waiting room | the intended experience |

**Both paths are built the same way**: the server emits a `live-invite` event; on web it
lands on an open socket, and under Capacitor it *also* goes out as a push. The client-side
banner is shared. Nothing about the room, the transport or the round logic changes when
the shell arrives — only the delivery channel widens.

The push payload must be **time-critical and self-expiring**: it says "join now", it deep
links to the waiting room, and it is worthless one minute later (§ 5). That makes it
qualitatively different from the app's other notification demands ("your arena opens",
"your streak is at risk"), which are all "come back sometime". Worth stating in the native
ledger so nobody implements one and assumes it covers the other.

---

## 5. The waiting room and its 1-minute timeout (Q18)

The inviter enters a waiting room. The invitee gets the invite (§ 4).

**Decision (2026-08-16):**

* **The inviter may cancel at any time.** An explicit Cancel control, always present.
* **The room auto-expires after 1 minute** if the invitee has not joined.
* **On expiry or cancel the inviter returns to the page they came from** — the challenge
  detail screen. It does **not** start async, does not consume anything, and does not
  mark the challenge in any way.
* **Retry is unlimited.** Nothing is spent, so nothing needs rationing.

Why 1 minute and not longer: the invite is a "drop what you are doing" ask. If the friend
has not responded within a minute they are not at their phone, and a longer wait just
makes the inviter stare at a spinner. A short, cheap, repeatable attempt is strictly
better than a long one, precisely *because* retry costs nothing.

Why it does not fall back to async automatically: **starting async is irreversible** — it
records a round, and § 1 then permanently forecloses live for that challenge. Silently
dropping a player who wanted a live match into the async runner would spend the one thing
they were trying to protect. Returning them to the challenge screen leaves both doors
open.

⚠️ **Rate limiting.** Unlimited retries plus push notification delivery (§ 4) is an
invite-spam vector: a friend could be pinged every 61 seconds. The block flag
(STUDY_CHALLENGE.md § 1, Q46/Q57) is the blunt remedy, and the 6-challenge cap (Q65)
bounds how many challenges can be a source, but neither limits invites *per challenge*.
Proposed: a per-(challenge, sender) cooldown on push delivery — the in-app banner may fire
every time, the push may not. Logged as Q70.

---

## 6. Playing a live round (Q20)

**Decision (2026-08-16): the game always continues without a player who leaves.** There is
**no desertion state, no grace period, and no pausing.**

* A round starts for both players at the same server-stamped moment and ends at
  `roundEndsAt` (§ 7).
* If a player backgrounds the app, loses connection, or force-quits, **their game keeps
  running on the server's clock**. When the round ends they are scored on whatever they
  had banked at the moment they left — which may be zero.
* Nothing is voided, nothing is replayed, and the present player is never punished for
  their opponent's disconnection. They played the round; they keep the round.

This is the deliberate inverse of the async rule. Async play **pauses when the app is
backgrounded** — that is a global rule covering every game
([GAMES_FEATURE.md](./GAMES_FEATURE.md), STUDY_CHALLENGE.md § 5.8). **Live mode is the one
documented exception**, and it has to be: pausing is only fair when you are alone. In a
live round, pausing would either freeze your opponent (punishing them for your phone
ringing) or let you stop your own clock while theirs runs (an exploit that would be
discovered in about a day).

> ⚠️ **This must be built as an explicit exception, not as a forgotten case.** The
> pause-on-background handler needs a live-mode flag threaded into it. If the audit of
> existing games owed to `GAMES_FEATURE.md` (STUDY_CHALLENGE.md § 12) implements pausing
> as an unconditional behaviour, live mode becomes unbuildable without unpicking it.

### Score reporting when a player is gone

The client reports its score (§ 5.6 of the async doc: the client reports, the server
stores). A player who left cannot report. The room therefore holds a **running score**
pushed by each client during the round — the same events that drive the live scoreboard —
and banks the last value it received if the final report never arrives.

This is a small, contained relaxation of "the client reports at the end": the server is
still not simulating the game, it is just remembering the most recent thing the client
said. Combined with the fixed round length, it means every live round produces a score for
both players, always.

---

## 7. Every game needs a run length

A live round must end at a moment the server can predict, or "the game runs without them"
has no meaning and the scoreboard has nothing to wait for.

Of the three challenge-eligible games today (STUDY_CHALLENGE.md § 5.1):

| Game | Natural end | Live-mode requirement |
|---|---|---|
| **Match Speed** | ✅ 30-second clock (`src/games/match-speed`) | none — it already is what live mode needs |
| **Bubble Match** | ❌ survival: it ends when the screen fills | **needs a hard cap.** At the cap the run terminates and banks the points earned so far. ⚠️ Interacts with the ±500 all-or-nothing survival bonus (§ 5.4, Q68) — a run cut off by the clock has not "survived" in the sense the bonus means, so the cap must define whether reaching it counts as survival. Proposed: **it does** — you were still alive when time ran out |
| **Word Search (Pinyin)** | ❌ runs until every word is found, with a per-second penalty | **needs a hard cap.** At the cap, unfound words simply go unscored |

So the work is: a **`liveTimeLimitSec` on `GameDef`** (`src/games/types.ts`), mandatory for
any challenge-eligible game, and honoured only in live mode. This is a sibling of the
`challengeScoring` contract already owed to `GAMES_FEATURE.md` and should land in the same
pass — both are "what a game must declare to be challenge-eligible".

**A game with no `liveTimeLimitSec` is not live-eligible.** It may still be async
challenge-eligible. That asymmetry is fine and is cheaper than blocking the whole feature
on capping a game nobody wants to cap — but it must be checked when the game sequence is
generated, or a live session can reach round 3 and discover it cannot run it. Proposed:
**live-eligibility is a property of the challenge, decided when its `gameSequence` is
generated** — if any of the three games lacks a limit, Play live is never offered for that
challenge. Logged as Q71.

---

## 8. Collapse: what happens when the room dies

A room can die four ways: the window closes, a player leaves and never returns, the
between-rounds gate times out, or the backend restarts and the clients cannot reconnect.

| Trigger | Rounds already banked | Behaviour |
|---|---|---|
| Window closes mid-session | any | `no_contest`, exactly as async (STUDY_CHALLENGE.md § 6). Live mode has no special case |
| Backend restart, clients reconnect | any | the room is rebuilt from the table; at worst a scoreboard is re-fetched |
| Backend restart, clients do not reconnect | 0 | nothing happened; the challenge is untouched and live may be retried |
| Gate timeout / player gone for good | 0 | nothing happened; live may be retried |
| Gate timeout / player gone for good | ≥1 | **the challenge reverts to async for both players.** The banked rounds stand; each player finishes their remaining rounds alone, in the same order, before the window closes |

The last row is the only one that needed inventing, and it works because of a property the
async design already has: **rounds are stored per player** (`rounds[userId][roundIndex]`),
so a challenge where one player has two rounds and the other has one is already a
representable, ordinary state. Live mode does not need a "half-live" concept — it just
stops driving, and the async runner picks up from whatever is in the table.

The visible consequence is that a player whose opponent vanishes after round 1 does not
lose their round-1 score and is not stuck: they open the challenge, see rounds 2 and 3
waiting, and play them normally.

---

## 9. Data model: no new table

**Decision: `study_challenge_sessions` is retracted.** STUDY_CHALLENGE.md § 9 deferred a
table for "room state: participants, current round, per-player confirmation, heartbeat
timestamps". Every one of those columns describes something that is **true for a few
minutes and worthless afterwards**:

* participants → the sockets in the room;
* current round → derivable from `rounds` plus the room's phase;
* per-player confirmation → cleared on every phase change, never read after;
* heartbeats → the socket's own liveness, which the transport already tracks.

Writing them to Postgres would buy exactly one thing — surviving a backend restart — and
§ 8 shows that is already handled without them: durable state is `study_challenges.rounds`,
and a restart mid-session costs a reconnect, not a round.

**Live mode therefore adds no tables and no columns.** It is the rare feature whose entire
persistence story is "reuse the async write path".

The one schema-adjacent change is on the client contract, not the database:
`GameDef.liveTimeLimitSec` (§ 7).

> This is worth stating loudly because the async doc's § 9 promises a deferred table, and
> a future agent reading only that line would build one. The line is now wrong; § 9 of
> that doc has been updated to point here.

---

## 10. Layering map

Everything here is additive to the map in STUDY_CHALLENGE.md § 10.

| Layer | File | Responsibility |
|---|---|---|
| Transport | `server/live/liveSocketServer.ts` (new) | the `ws` server mounted on the existing HTTP server at `/api/ws`; handshake auth; connection lifecycle. **No game or challenge knowledge** |
| Transport | `server/live/LiveRoomRegistry.ts` (new) | the `Map<challengeId, LiveRoom>`; join/leave/confirm/phase transitions; timers. Pure in-memory state machine, **no SQL** |
| Service | `server/services/StudyChallengeService.ts` | unchanged persistence path — the room calls `recordRound`, it does not write |
| Service | `server/services/StudyChallengeService.ts` | new: `isLiveEligible(challenge)` — both players at zero rounds (§ 1), window open, all three games capped (§ 7) |
| Contract | `server/contracts/wire.ts` | live event names, `LIVE_INVITE_TIMEOUT_SEC = 60`, round-limit constants |
| Client | `src/api/liveSocket.ts` (new) | the socket wrapper: connect, backoff reconnect, typed events. **No `token` param** — it reads auth the way `src/api/http.ts` does |
| Client | `src/features/studyChallenge/live/*` | waiting room, invite banner, shared scoreboard, ready gate |
| Client | `src/games/types.ts` | `liveTimeLimitSec` on `GameDef` |
| Client | each challenge-eligible game page | honour the live time limit; suppress the pause-on-background handler in live mode (§ 6) |

⚠️ **`server/live/` is a new top-level server directory.** It is deliberately not
`services/` — a WebSocket server is transport, the peer of a controller, and putting it
under `services/` would make "a service does not write SQL"
([BACKEND_LAYERING.md](./BACKEND_LAYERING.md)) read as though it also does not do I/O.
Flag for confirmation when this is built.

---

## 11. What phase 1 must not foreclose

Restated from STUDY_CHALLENGE.md § 7, now with the reasons this document supplies:

1. **Store per-round scores as they complete**, not just a final total. § 8's async
   fallback depends on `rounds[userId][roundIndex]` being a legal partial state.
2. **Keep scoring declarative** (`challengeScoring` on `GameDef`), so the live scoreboard
   can render a breakdown without the game page being on screen.
3. **Give every challenge-eligible game a run length** (§ 7) — the single hardest
   requirement, because it changes two existing games' rules.
4. **Do not make pause-on-background unconditional** (§ 6).
5. **Do not let anything in §§ 1–6 of the async doc depend on the socket.** If live mode
   is cut, deleted, or broken in production, the challenge must be unaffected.

---

## 12. Question log

### Settled

| # | Question | Answer |
|---|---|---|
| **Q18** | How long does the inviter wait before the waiting room gives up? | **1 minute**, plus an always-available Cancel. On expiry the inviter returns to the previous page — it does **not** fall back to async, because starting async permanently forecloses live (§ 1). Retry is unlimited and free (§ 5) |
| **Q19** | Transport: WebSocket, SSE + POST, or short polling? | **WebSocket**, single endpoint at `/api/ws`. nginx already forwards the upgrade, there is one backend container so rooms live in process memory, and the alternatives split one conversation into two half-channels or add latency at the exact moment the feature exists to remove it (§ 2) |
| **Q20** | Desertion mid-round — how long a grace period? | **None. The game always continues without them**, on the server's clock, and they are scored on what they had banked. This makes live mode the documented exception to the global pause-on-background rule (§ 6). Requires every game to have a run length (§ 7) |
| **Q21** | How is a live invite delivered with no push infrastructure? | **It is a native-shell demand.** Logged in [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) as a concrete Capacitor demand. On the web the invite reaches only a player who already has the app open; the same server event becomes a push under Capacitor, with no change to the room or the round logic (§ 4) |
| **Q19a** | Does the socket need to survive token rotation? | **Yes — auth at handshake only.** Tearing down a live socket on a silent refresh is the socket-level form of the banned page-reload-on-refresh rule ([TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)) (§ 2) |
| **Q19b** | Does live mode need a `study_challenge_sessions` table? | **No — retracted.** Every field is ephemeral, and durable state is already `study_challenges.rounds`. Live mode adds **no tables and no columns** (§ 9) |
| **Q18a** | Can live be entered after async has started? | **No.** Play live is offered only while *both* players have zero recorded rounds, because rounds are strictly sequential with one attempt each (§ 1) |
| **Q20a** | What happens to a session that collapses after a round is banked? | **It reverts to async for both players.** The banked rounds stand; per-player round storage already makes the asymmetric state legal (§ 8) |

### Still open

| # | Question | Notes |
|---|---|---|
| **Q69** | How long may the between-rounds Ready gate stay open before the session collapses? | Proposed: **1 minute**, matching the waiting room (§ 3, § 5). Needs sign-off — it is the difference between a friend who stepped away for coffee returning to a live game and returning to an async one |
| **Q70** | Rate-limiting live invites | Unlimited free retries (§ 5) plus push delivery (§ 4) is an invite-spam vector. Proposed: in-app banner every time, push on a per-(challenge, sender) cooldown. Only bites once the Capacitor shell exists |
| **Q71** | Is live-eligibility decided per challenge at `gameSequence` generation? | Proposed **yes** — if any of the three drawn games lacks a `liveTimeLimitSec`, Play live is never offered for that challenge, so a session cannot reach round 3 and discover it cannot run it (§ 7) |
| **Q72** | Does Bubble Match's ±500 survival bonus pay out when the live time cap ends the run? | Proposed **yes** — you were alive when the clock stopped. The alternative makes the live variant of the game strictly harsher than the async one for no stated reason (§ 7) |

All four are **implementation-time questions**: none of them changes the transport, the
room model, or the data model, and none blocks starting the build.

---

## 13. Code ↔ doc dependencies

**This document depends on:**

| Thing | Where | What is assumed |
|---|---|---|
| `nginx.conf` | repo root, `location /api` | forwards `Upgrade` / `Connection` — **the whole transport choice rests on this** (§ 2). If the block is rewritten, live mode breaks with a 400 at handshake |
| single `backend` service | `docker-compose*.yml` | no replicas → in-process rooms are safe (§ 2). **Adding a second backend instance breaks live mode** and forces a shared room store |
| `study_challenges.rounds` | STUDY_CHALLENGE.md § 9 | per-player, insert-only, partially-filled states are legal (§ 8) |
| `GameDef` | `src/games/types.ts`, `src/games/registry.ts` | gains `liveTimeLimitSec` (§ 7) |
| pause-on-background | [GAMES_FEATURE.md](./GAMES_FEATURE.md), STUDY_CHALLENGE.md § 5.8 | must be suppressible (§ 6) |
| token rotation | [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md) | handshake-time auth only (§ 2) |

**This document is depended on by / owes an update to:**

| Doc | What it owes |
|---|---|
| [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) | § 7 now points here; § 9's deferred `study_challenge_sessions` is retracted; Q18–Q21 move from Still-open to "settled in the live doc" — **all done 2026-08-16** |
| [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) | the live-invite demand row in "Concrete product demands on a native shell" — **done 2026-08-16** |
| [GAMES_FEATURE.md](./GAMES_FEATURE.md) | when the `challengeScoring` contract is written, `liveTimeLimitSec` goes in beside it, and the pause-on-background section must state the live exception |
| [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) | if `server/live/` is accepted (§ 10), the layering doc needs a row for it |
