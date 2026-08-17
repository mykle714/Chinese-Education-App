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
4. [Getting two people into the room (Q21, Q70)](#4-getting-two-people-into-the-room-q21-q70)
5. [The waiting room and its 1-minute timeout (Q18)](#5-the-waiting-room-and-its-1-minute-timeout-q18)
6. [Playing a live round (Q20)](#6-playing-a-live-round-q20)
7. [How a live round ends (Q71, Q72)](#7-how-a-live-round-ends-q71-q72)
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
* an **unpausable AFK timer** runs underneath the round and forfeits a player who stops
  playing (§ 6) — the one live-only mechanic, and the only thing that bounds a round when
  someone walks away.

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
  roundBackstopAt: number | null; // server clock; the room stops waiting here (§ 7)
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

### The gate has no timeout (Q69)

**Decision (2026-08-16): the gate waits indefinitely, and never collapses to async on its
own.** If one player confirms and the other never does, the room simply stays open.

Instead of a timer there is an **Exit live challenge** control on the scoreboard, always
present. The waiting player leaves when *they* decide they have waited long enough.

Why a button beats a timer here:

* **A timer would have to guess.** The right wait is 20 seconds for one player and five
  minutes for another (their friend said "one sec, doorbell"). Only the waiting player
  knows, and they are sitting right there looking at the screen — this is the cheapest
  possible place to ask them.
* **Expiry would be the worst outcome for both.** A friend who returns at 90 seconds to
  find the session already dissolved learns not to play live again. Nothing is degrading
  while the room sits open: the scores are already banked in `study_challenges.rounds`,
  and the window's own deadline (§ 8) still applies underneath.
* **It removes a whole class of state.** No gate timer, no "was I timed out or did they
  quit" ambiguity, no sweep for expired rooms — a room ends when a human ends it, when the
  window closes, or when the process restarts.

Pressing **Exit live challenge** ends the live session for both players (there is no live
session with one person in it). Banked rounds stand and the rest is played async — see
§ 8, where explicit exit is now the *only* trigger for that transition.

---

## 4. Getting two people into the room (Q21, Q70)

**The primary mechanism is a rendezvous, not an invite.** The challenge detail screen
carries a permanent **Go to waiting room** control (whenever the challenge is live-eligible
per § 1). Either player may enter at any time during the window; **when both are in the
room, the test starts.** No invitation is required, accepted, or waited on.

This is the load-bearing decision of the section, because it means **live mode does not
depend on notification delivery at all.** Two friends who agree out of band — a text, a
call, sitting on the same sofa — both tap the same button and play. The notification is a
convenience on top, not the mechanism.

### The invite ping: one per day, per sender, per target (Q70)

Entering the waiting room *may* ping the other player: an in-app banner if they have the
app open, and (under Capacitor) a push if they do not.

**Decision (2026-08-16): at most one ping per day, per sender, per target player** —
counting the banner and the push together as one allowance.

That is a much harder limit than the per-challenge cooldown I proposed, and it is the
right one because of how it composes with the rendezvous:

* **The spam vector closes completely.** Retries stay free and unlimited (§ 5) — the
  waiting room can be re-entered all afternoon — but only the *first* entry of the day
  reaches the other person's phone. There is no cooldown to wait out and no per-challenge
  budget to farm across the 6-challenge cap (STUDY_CHALLENGE.md § 1, Q65).
* **It costs nothing, because the ping was never the mechanism.** A once-daily "your
  friend is waiting" is exactly the right weight for a signal whose only job is to make
  someone *aware* live mode is being attempted. Everything after that first ping is the
  rendezvous button doing the work.
* **Per (sender, target), not per challenge** — deliberately. The allowance follows the
  *person being interrupted*, so a player cannot spend six allowances on the same friend by
  spreading them across six challenges.

**The allowance lives in memory (Q73, settled 2026-08-16).** It is the one piece of
live-mode state that outlives a room, and it is deliberately *not* persisted:

* the failure mode is **one extra ping after a backend restart** — self-correcting, and
  indistinguishable from the friend simply trying again the next day;
* persisting it would cost a table or a column for a counter whose entire purpose is to be
  forgotten every 24 hours;
* it keeps § 9's "live mode adds no tables and no columns" true without an asterisk.

Shape: a `Map<"senderId:targetId", lastPingedAtLocalDate>` beside the room registry,
pruned opportunistically. **The day boundary is the *target's* 04:00 local day** — the app
uses that boundary everywhere else (streak cron, AI usage, community week), and the person
whose sleep is being protected is the one being pinged, not the one pinging.

### What this leaves for the native shell (Q21)

Live-mode invite delivery is still logged as a concrete demand in
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md), but its weight has changed:

| Shell | Ping delivery | What live mode can do |
|---|---|---|
| **Web today** | in-app banner only, over the target's own WebSocket | **fully playable** — the rendezvous needs no delivery at all; discovery is out of band |
| **Capacitor** | the same event *also* leaves as a push (`@capacitor/push-notifications`), deep-linked to the waiting room | spontaneous invites become possible: your friend finds out without you texting them |

> ⚠️ I previously wrote that this demand "decides whether live mode ships at all". **That
> was wrong** and the native ledger has been corrected. With a permanent waiting-room
> entrance, push widens *discovery*; it does not gate the feature.

**Both paths are built identically**: the server emits one `live-invite` event; the web
delivers it to an open socket, Capacitor additionally delivers it as a push. Nothing about
the room, the transport, or the round logic changes when the shell arrives.

The push payload is still **time-critical** — "your friend is in the waiting room", deep
linked, worth nothing an hour later — which distinguishes it from the app's other
notification demands ("your arena opens", "your streak is at risk"), all of which are
"come back sometime". Stated here and in the ledger so nobody implements one and assumes
it covers the other.

---

## 5. The waiting room and its 1-minute timeout (Q18)

A player enters the waiting room from the challenge screen (§ 4). If the other player is
already there, the test starts immediately. If not, they wait.

**Decision (2026-08-16):**

* **Leaving is always available.** An explicit Cancel / Leave control, always present.
* **A solitary waiting room auto-expires after 1 minute.** Nobody is left staring at a
  spinner they have forgotten about.
* **On expiry or cancel the player returns to the challenge screen.** It does **not**
  start async, does not consume anything, and does not mark the challenge in any way.
* **Re-entry is unlimited and free.** Nothing is spent by waiting, so nothing needs
  rationing — the *ping* is rationed instead, once per day (§ 4).

Note the asymmetry with the between-rounds gate (§ 3), which has **no** timeout. It is
deliberate and the reason is presence: in the waiting room you may be waiting for someone
who has no idea you are there, so an unbounded wait is a trap. On the scoreboard the other
player was, seconds ago, demonstrably in the app with you — waiting for them is reasonable,
and you can see exactly what you are waiting for.

Why expiry does not fall back to async: **starting async is irreversible.** It records a
round, and § 1 then permanently forecloses live for that challenge. Silently dropping a
player who wanted a live match into the async runner would spend the one thing they were
trying to protect. Returning them to the challenge screen leaves both doors open.

**No spam vector survives this.** Re-entry is unlimited but the ping is once per day per
(sender, target), so a friend cannot be pinged repeatedly no matter how many times the
waiting room is re-entered, or across how many of the 6 concurrent challenges.

---

## 6. Playing a live round (Q20)

**Decision (2026-08-16, revised): the game pauses like everywhere else, and a separate
unpausable AFK timer forfeits a player who stays away too long.**

This replaces an earlier draft in which live rounds ran on regardless. The revision is
better on every axis, and the reason is that it stops conflating two different questions:

| Question | Answered by |
|---|---|
| *Should a player be billed for time they were not playing?* | **No, ever.** The game pauses — popup or background, live or async, no exceptions |
| *May a player hold the room hostage by walking away?* | **No.** An unpausable AFK timer forfeits them |

So the rules are:

* **Pause-on-background is universal.** `GAMES_FEATURE.md`'s pause rule has **no live-mode
  exception** and needs no suppression flag. Backgrounding a live round freezes it exactly
  as it freezes a solo one.
* **A second clock runs underneath, and it cannot be paused.** It measures wall-clock time
  since the player's last input (or since they backgrounded). When it expires, that player
  **forfeits the round**: their run ends where it stands, the score is banked, and the room
  advances.
* **The forfeit timer exists only in live mode.** It is the price of holding another
  person's evening; there is nobody to inconvenience in a solo run.

**Why this beats "the game runs without them":** a player whose phone rings mid-round used
to lose points in real time to a game they could not see. Now they lose nothing for thirty
seconds of absence, and lose the *round* only if they are gone long enough that the other
player is genuinely being made to wait. The punishment lands on the behaviour we actually
want to deter — abandoning your opponent — rather than on owning a phone.

It also removes the exploit the old rule was guarding against. Pausing your own game while
your opponent's runs would be an obvious cheat; here **pausing does not help you**, because
the AFK clock keeps running and forfeits you. Both players' games advance only while they
are playing, and the one who stops playing is the one who pays.

**Working number: 60 seconds of no input (Q77).** Long enough to read a definition popup —
which pauses the *game* but is not idleness in the sense that matters here — or to answer a
short interruption; short enough that the waiting player is not stranded. ⚠️ This is the
live-mode constant most likely to need tuning once a real session has been played, so it
belongs in `wire.ts` as a named constant rather than inline in a game page.

> **Consequence for `GAMES_FEATURE.md`:** the pause rule is now written **unconditionally**,
> which is simpler than the suppressible version an earlier draft demanded. What each
> challenge-eligible game gains instead is an **idle signal** — "the player has done
> nothing for N seconds" — which is a smaller and much less invasive hook than threading a
> live-mode flag through every timer.

### Score reporting when a player is gone

The client reports its score (§ 5.6 of the async doc: the client reports, the server
stores). A player who left cannot report. The room therefore holds a **running score**
pushed by each client during the round — the same events that drive the live scoreboard —
and banks the last value it received if the final report never arrives.

This is a small, contained relaxation of "the client reports at the end": the server is
still not simulating the game, it is just remembering the most recent thing the client
said. It means every live round produces a score for both players, always.

---

## 7. How a live round ends (Q71, Q72)

An earlier draft asked *"does this game end on its own when nobody is playing it?"* and
concluded that games failing that test needed a live-only time cap. **The AFK forfeit
timer (§ 6) answers that question for every game at once**, so the per-game analysis
collapses:

| How a round can end | Applies to |
|---|---|
| The game's own end condition — clock, death, completion | every game, as in async |
| **AFK forfeit** | any player who stops playing for the timeout (§ 6) |
| Exit live challenge | the whole session (§ 3, § 8) |

Between them these are exhaustive: a player is either playing (their game ends normally)
or not playing (they forfeit). **There is no third state in which a round hangs**, which
was the only thing the time caps were ever for.

### Consequences

* **`GameDef.liveTimeLimitSec` is dropped.** No game needs a live-only time cap. Word
  Search was the last candidate, and it fails only against a *present* player who cannot
  find the final word — see below.
* **Bubble Match keeps its natural end and its scoring, and the contradiction dissolves.**
  The previous draft required Bubble Match to *not* pause when abandoned (so an abandoned
  run would self-terminate) while `GAMES_FEATURE.md` required it *to* pause. Under the AFK
  rule it pauses, unconditionally, like everything else — and an abandoned run ends by
  forfeit rather than by drowning in bubbles. Its ±500 survival bonus (STUDY_CHALLENGE.md
  § 5.4, Q68) is untouched in live mode, so live and async scores stay comparable.
* **Every game becomes live-capable**, which retires Q71's per-challenge eligibility check:
  there is no longer a property a drawn game can fail. `isLiveEligible` reduces to "both
  players at zero rounds, window open" (§ 1).
* **A forfeited run banks what it had.** Forfeit ends the round, it does not zero it — the
  running score the room already holds (above) is what gets written. In practice an AFK
  player banked little, so the outcome is the same without needing a punitive special case.

### The slow-but-present player

A live Word Search against someone who simply cannot find the last word can run long. That
is **accepted, not solved**, and it is the same answer Q69 gives for the scoreboard gate:
the waiting player is not trapped, because **Exit live challenge** is always available
(§ 3), and someone who is genuinely still hunting is not doing anything wrong. A time cap
here would punish slowness, which is the opposite of what a study app should do.

⚠️ **The room still keeps a backstop deadline** — a generous ceiling after which it stops
waiting for a client that has reported nothing at all. That is not a game rule; it is the
room refusing to leak memory over a client that vanished without its AFK timer ever
reporting in (a hard crash, not a walk-away). It should be comfortably longer than the AFK
timeout, so in normal operation the forfeit always fires first.

## 8. Collapse: what happens when the room dies

A room can die three ways: **a player presses Exit live challenge** (§ 3), the window
closes, or the backend restarts and the clients cannot reconnect. There is **no
timeout-driven death** — the gate waits forever (§ 3) and the waiting room's 1-minute
expiry (§ 5) only ever applies before a round has been played.

| Trigger | Rounds already banked | Behaviour |
|---|---|---|
| Window closes mid-session | any | `no_contest`, exactly as async (STUDY_CHALLENGE.md § 6). Live mode has no special case |
| Backend restart, clients reconnect | any | the room is rebuilt from the table; at worst a scoreboard is re-fetched |
| Backend restart, clients do not reconnect | 0 | nothing happened; the challenge is untouched and live may be retried |
| **Exit live challenge** | 0 | nothing happened; live may be retried |
| **Exit live challenge** | ≥1 | **the challenge reverts to async for both players.** The banked rounds stand; each player finishes their remaining rounds alone, in the same order, before the window closes |

The last row is the only one that needed inventing, and it works because of a property the
async design already has: **rounds are stored per player** (`rounds[userId][roundIndex]`),
so a challenge where one player has two rounds and the other has one is already a
representable, ordinary state. Live mode does not need a "half-live" concept — it just
stops driving, and the async runner picks up from whatever is in the table.

⚠️ **Reverting to async is one-way** (§ 1: live requires both players at zero rounds). So
Exit live challenge is a **destructive-ish** control and must confirm — "Leave the live
game? You'll each finish the remaining rounds on your own." Without that, a mis-tap by the
waiting player ends a shared game their friend was thirty seconds from rejoining.

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

The only state that outlives a room is the **once-per-day ping allowance**, and it is
**held in memory too** (§ 4, Q73) — so the claim above stands with no asterisk. Its whole
failure mode is one extra ping after a restart.

There is **no client-contract change either** since the AFK forfeit replaced the per-game
time caps (§ 7): `GameDef` gains nothing for live mode. The only new client-side concept is
an **idle signal** inside the challenge-eligible game pages, which is behaviour, not
schema.

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
| Service | `server/services/StudyChallengeService.ts` | new: `isLiveEligible(challenge)` — both players at zero rounds (§ 1) and the window open. **No per-game check** — every game is live-capable under the AFK rule (§ 7) |
| Service | `server/services/StudyChallengeService.ts` | new: the once-per-day ping allowance per (sender, target) (§ 4, Q70) — **policy, so it lives here, not in the room** |
| Contract | `server/contracts/wire.ts` | live event names, `LIVE_WAITING_ROOM_TIMEOUT_SEC = 60`, the per-round backstop, ping-allowance window |
| Client | `src/api/liveSocket.ts` (new) | the socket wrapper: connect, backoff reconnect, typed events. **No `token` param** — it reads auth the way `src/api/http.ts` does |
| Client | `src/features/studyChallenge/live/*` | waiting room, invite banner, shared scoreboard, ready gate, Exit-live confirm |
| Client | each challenge-eligible game page | emit an **idle signal** (no input for N seconds) when running in live mode. **Nothing else** — the pause handler is unconditional and needs no live-mode branch (§ 6) |

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
3. **Do not build scoring that assumes a run always completes** (§ 7) — a live round can
   end by forfeit, so a game that only computes its score in an end-of-run branch has
   nothing to report for a forfeited player.
4. **Do not make pause-on-background unconditional** (§ 6).
5. **Do not let anything in §§ 1–6 of the async doc depend on the socket.** If live mode
   is cut, deleted, or broken in production, the challenge must be unaffected.

---

## 12. Question log

### Settled

| # | Question | Answer |
|---|---|---|
| **Q18** | How long does a player wait alone in the waiting room? | **1 minute**, plus an always-available Cancel. On expiry they return to the challenge screen — it does **not** fall back to async, because starting async permanently forecloses live (§ 1). Re-entry is unlimited and free (§ 5). Note the contrast with Q69: the waiting room times out because you may be waiting for someone who does not know you are there; the scoreboard gate does not, because they were with you seconds ago |
| **Q19** | Transport: WebSocket, SSE + POST, or short polling? | **WebSocket**, single endpoint at `/api/ws`. nginx already forwards the upgrade, there is one backend container so rooms live in process memory, and the alternatives split one conversation into two half-channels or add latency at the exact moment the feature exists to remove it (§ 2) |
| **Q20** | Desertion mid-round — how long a grace period? | **Revised 2026-08-16: the game pauses like everywhere else, and an unpausable AFK timer forfeits a player who stays away.** Two questions were being conflated: *should you be billed for time you were not playing* (never) and *may you hold the room hostage* (no). Pause answers the first, forfeit the second. Live mode is therefore **no longer an exception** to the global pause rule, and needs no suppression flag (§ 6) |
| **Q21** | How is a live invite delivered with no push infrastructure? | **It mostly isn't — and that turned out not to matter.** The mechanism is a **permanent waiting-room entrance** on the challenge screen: both players tap in and the test starts, no invitation involved. The ping (banner on web, push under Capacitor — still logged in [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md)) only widens *discovery*, and is capped at one per day (Q70). ⚠️ This **downgrades** the native-shell dependency: push makes spontaneous invites possible, it does not gate live mode (§ 4) |
| **Q19a** | Does the socket need to survive token rotation? | **Yes — auth at handshake only.** Tearing down a live socket on a silent refresh is the socket-level form of the banned page-reload-on-refresh rule ([TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)) (§ 2) |
| **Q19b** | Does live mode need a `study_challenge_sessions` table? | **No — retracted.** Every field is ephemeral, and durable state is already `study_challenges.rounds`. Live mode adds **no tables and no columns** (§ 9) |
| **Q18a** | Can live be entered after async has started? | **No.** Play live is offered only while *both* players have zero recorded rounds, because rounds are strictly sequential with one attempt each (§ 1) |
| **Q20a** | What happens to a session that collapses after a round is banked? | **It reverts to async for both players.** The banked rounds stand; per-player round storage already makes the asymmetric state legal (§ 8) |
| **Q69** | How long may the between-rounds Ready gate stay open? | **Forever — no timeout, and it never collapses to async on its own.** Instead there is an always-present **Exit live challenge** control on the scoreboard. Only the waiting player knows how long is too long, and they are sitting right there; a timer would have to guess, and guessing wrong dissolves a session the friend was about to rejoin (§ 3). Explicit exit is now the **only** trigger for the async reversion (§ 8) |
| **Q70** | Rate-limiting live invites | **One ping per day, per sender, per target** — banner and push counted together. Much harder than the per-challenge cooldown originally proposed, and affordable because the **waiting room is a permanent rendezvous** (§ 4): the ping only creates awareness, it is not the mechanism. Per *person*, not per challenge, so the 6-challenge cap cannot be farmed for six allowances against one friend |
| **Q71** | Is live-eligibility decided per challenge at `gameSequence` generation? | **Retired — the question no longer exists.** The AFK forfeit (§ 6) bounds every round regardless of the game, so no game can fail live-eligibility and there is nothing to check when the sequence is drawn. `GameDef.liveTimeLimitSec` is dropped with it (§ 7) |
| **Q72** | Does Bubble Match's ±500 survival bonus pay out when a live time cap ends the run? | **Moot twice over.** First because Bubble Match has a natural end, then — decisively — because **no game gets a live time cap at all** under the AFK rule. Its scoring is untouched in live mode, so live and async scores stay comparable (§ 7). The one live-only ruling: a player who **forfeits** mid-run banks their points but does not earn the bonus |
| **Q77** | How long is the AFK forfeit timeout? | **60 seconds of no input**, measured unpausably from the last interaction. Long enough to read a definition popup or answer a short interruption, short enough that the waiting player is not stranded. ⚠️ Recorded as the working number — this is the one live-mode constant most likely to want tuning against a real session |

**The revision of Q20 is worth keeping visible**, because it dissolved a contradiction the
earlier draft had built in. That draft needed Bubble Match to **not** pause when abandoned
(so an abandoned run would self-terminate and end the round) while `GAMES_FEATURE.md`
needed it **to** pause. Under the AFK forfeit, every game pauses unconditionally and every
round is bounded by the forfeit instead — one rule replacing a per-game analysis, and the
contradiction goes with it.

| **Q73** | Where does the once-per-day ping allowance live? | **In memory.** It is the only live-mode state that outlives a room, and persisting it would buy a table for a counter designed to be forgotten daily. A backend restart hands out one extra ping — self-correcting, and invisible to the user. Keyed on the **target's** 04:00 local day, the app-wide boundary (§ 4) |

### Still open

**Nothing.** Every question in both documents is settled: Q1–Q68 in
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md), Q69–Q73 here.

The build order that follows: the prerequisites in STUDY_CHALLENGE.md § 12 (the
`challengeScoring` contract, the unconditional pause rule, the doc updates), then phase 1
async, then this. Nothing in phase 2 is blocked by an unanswered design question — only by
phase 1 existing.

---

## 13. Code ↔ doc dependencies

**This document depends on:**

| Thing | Where | What is assumed |
|---|---|---|
| `nginx.conf` | repo root, `location /api` | forwards `Upgrade` / `Connection` — **the whole transport choice rests on this** (§ 2). If the block is rewritten, live mode breaks with a 400 at handshake |
| single `backend` service | `docker-compose*.yml` | no replicas → in-process rooms are safe (§ 2). **Adding a second backend instance breaks live mode** and forces a shared room store |
| `study_challenges.rounds` | STUDY_CHALLENGE.md § 9 | per-player, insert-only, partially-filled states are legal (§ 8) |
| pause-on-background | [GAMES_FEATURE.md](./GAMES_FEATURE.md), STUDY_CHALLENGE.md § 5.8 | is **unconditional** — live mode adds no exception to it (§ 6) |
| per-game idle detection | each challenge-eligible game page | the AFK forfeit needs "no input for N seconds" from the game that owns the input surface (§ 6) |
| token rotation | [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md) | handshake-time auth only (§ 2) |

**This document is depended on by / owes an update to:**

| Doc | What it owes |
|---|---|
| [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) | § 7 now points here; § 9's deferred `study_challenge_sessions` is retracted; Q18–Q21 move from Still-open to "settled in the live doc" — **all done 2026-08-16** |
| [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) | the live-invite demand row in "Concrete product demands on a native shell" — **done 2026-08-16** |
| [GAMES_FEATURE.md](./GAMES_FEATURE.md) | the pause-on-background section is written **unconditionally** (no live exception); the `challengeScoring` contract must tolerate a run that ends by forfeit rather than completion |
| [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) | if `server/live/` is accepted (§ 10), the layering doc needs a row for it |
