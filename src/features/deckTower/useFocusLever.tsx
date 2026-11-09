import React, { useEffect, useRef, useState } from "react";
import { setFocusMode } from "../../api/focusMode";
import { useAuth } from "../../AuthContext";
import { forgiveAutoFocusNotice, isAutoFocusNoticeOwed } from "../focusMode/autoFocusNotice";
import { FOCUS_LEVER_THRESHOLD } from "../../../server/contracts/focusMode";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import FocusDialog, { type FocusDialogContent } from "../focusMode/FocusDialog";
import { FOCUS_WORLD_NAMES } from "../focusMode/focusWorldNames";
import type { PawnEntranceCue } from "./iso";
import { TOWER_MODES, bandTotal } from "./towerModes";
import { useLeverMotion, type LeverMotion } from "./useLeverMotion";

/**
 * useFocusLever — one world's focus lever: when it shows, what tapping it does, and its
 * popup (docs/FOCUS_MODE.md § 5, docs/DECK_TOWER.md § "Focus lever").
 *
 * Layer: page logic (feature module `src/features/deckTower`). DeckTowerPage runs one per
 * world (like its ready counts), hands the world on screen's `lever` to DeckTowerPlatform
 * and renders every world's `dialog`.
 *
 *   Shows      while the world's Learning deck is up AND (focus is on, OR the world holds
 *              FOCUS_LEVER_THRESHOLD off-cooldown cards across all four bands — the same
 *              Mix total the tower stands, read before any focus narrowing).
 *   Tap, off   pulls it and opens "Turn on focus mode?". No → it springs back. Yes → focus
 *              goes on and it STAYS pulled.
 *   Tap, on    opens "Turn off focus mode?". Yes → it springs back; if the pile is now under
 *              the threshold it then recedes into the platform and the hatch shuts.
 *   Auto-on    focus was switched on for the learner when this world's goal was turned on
 *              (docs/FOCUS_MODE.md § 1a). On the first settled visit with focus on, the
 *              "auto-on" popup explains it; dismissing it forgives the owed notice
 *              (src/features/focusMode/autoFocusNotice.ts).
 *
 * After a flip the world's ready counts are re-read, so the tower stands the new figure.
 * `onRecount` fires just before that re-read: the page holds the tower at its height and,
 * once the new figure lands, shrinks or grows it there (docs/DECK_TOWER.md § "Tower resizes").
 */

interface ReadyCountsLike {
    counts: Record<string, number>;
    loaded: boolean;
    focusOn: boolean;
    reload: () => void;
}

export interface FocusLever {
    lever: LeverMotion & { ariaLabel: string; onTap: () => void; busy: boolean };
    dialog: React.ReactElement;
}

export function useFocusLever({
    world,
    ready,
    learningShown,
    busy,
    hideInstantly = false,
    skyEntrance,
    onRecount,
    onScreen,
}: {
    world: MasteryWorldId;
    ready: ReadyCountsLike;
    /** The world's tower is showing its Learning deck (the lever is a Learning control). */
    learningShown: boolean;
    /** A swap, pan or tower resize is running: taps are ignored. */
    busy: boolean;
    /** Show / hide without animating (the lever just fell away with a trap-door swap; useLeverMotion `instant`). */
    hideInstantly?: boolean;
    /** Arrive by falling from the sky on this cue (a deck swap's incoming pawn's; useLeverMotion `skyEntrance`). */
    skyEntrance?: PawnEntranceCue;
    /** Focus has just flipped and the counts are about to be re-read (DeckTowerPage → `useTowerResize` `hold`). */
    onRecount?: () => void;
    /** This world is the one on screen (DeckTowerPage → `worldId`). Gates the auto-on popup to a real visit. */
    onScreen: boolean;
}): FocusLever {
    const [dialog, setDialog] = useState<"turn-on" | "turn-off" | "auto-on" | null>(null);
    const [saving, setSaving] = useState(false);
    // The state just confirmed, held until the re-read counts agree, so the lever does not
    // flick back for the round trip.
    const [confirmedOn, setConfirmedOn] = useState<boolean | null>(null);
    useEffect(() => {
        if (confirmedOn !== null && ready.focusOn === confirmedOn) setConfirmedOn(null);
    }, [confirmedOn, ready.focusOn]);

    const focusOn = confirmedOn ?? ready.focusOn;
    // All four bands: the lever's threshold counts what the learner sees as assigned to them.
    const readyTotal = ready.loaded ? bandTotal(ready.counts, TOWER_MODES.mix.bands) : 0;
    // While focus is on, the counts are narrowed to today's remaining set (≤ FOCUS_DAILY_CARDS, 25), so they
    // cannot say whether the full pile still clears the threshold. Hold the lever up until
    // a just-confirmed flip's re-read lands (`confirmedOn` non-null): turning focus off
    // then either leaves it standing — a plain spring back, no sink-and-rise — or, if the
    // full pile is under the threshold, sinks it.
    const visible = ready.loaded && learningShown && (focusOn || confirmedOn !== null || readyTotal >= FOCUS_LEVER_THRESHOLD);
    // The hatch rise marks the deck GROWING past the threshold while the learner watches.
    // The page remounts on every return to `/`, so the counts' first landing flips
    // `visible` false → true; that is the lever already being there, not an arrival — it
    // is put up standing, unanimated (docs/FOCUS_MODE.md § 5 → "Appears"). The ref holds
    // the PREVIOUS commit's `loaded`, so it is still false on the render where they land.
    const loadedBefore = useRef(ready.loaded);
    useEffect(() => {
        loadedBefore.current = ready.loaded;
    }, [ready.loaded]);
    const firstLoad = ready.loaded && !loadedBefore.current;
    // Held pulled while its own popup is up, as well as while focus is on.
    const motion = useLeverMotion({
        visible,
        pulled: focusOn || dialog !== null,
        instant: hideInstantly || firstLoad,
        skyEntrance,
    });

    // ── Auto-on popup (docs/FOCUS_MODE.md § 1a) ──────────────────────────────────
    // Waits for a SETTLED visit: on screen, no swap / pan / resize / study running (`busy`),
    // counts loaded, no other popup. It also waits for the counts to report focus on: they
    // may be a pre-goal read still being re-fetched (DeckTowerPage reloads a world's counts
    // when its goal turns on). A notice that never meets focus on stays dormant and is
    // forgiven the next time the lever is flipped by hand (`onConfirm`).
    const { user } = useAuth();
    const userId = user?.id;
    const language = user?.selectedLanguage;
    useEffect(() => {
        if (!onScreen || busy || dialog !== null || !ready.loaded || !ready.focusOn) return;
        if (!userId || !language || !isAutoFocusNoticeOwed(userId, language, world)) return;
        setDialog("auto-on");
    }, [onScreen, busy, dialog, ready.loaded, ready.focusOn, userId, language, world]);

    const forgiveAutoNotice = () => {
        if (userId && language) forgiveAutoFocusNotice(userId, language, world);
    };

    const onTap = () => {
        if (busy || saving || dialog) return;
        setDialog(focusOn ? "turn-off" : "turn-on");
    };

    const onConfirm = async () => {
        if (!dialog || dialog === "auto-on") return;
        // The learner is now steering focus by hand: an unshown auto-on notice would be stale.
        forgiveAutoNotice();
        const turnOn = dialog === "turn-on";
        setSaving(true);
        try {
            await setFocusMode(world, turnOn);
            setConfirmedOn(turnOn);
            onRecount?.();
            ready.reload();
        } catch (err) {
            console.error("Focus mode switch failed:", err);
        } finally {
            setSaving(false);
            setDialog(null);
        }
    };

    const content: FocusDialogContent | null =
        dialog === "turn-on"
            ? { kind: "turn-on", world, readyCount: readyTotal }
            : dialog === "turn-off"
              ? { kind: "turn-off", world }
              : dialog === "auto-on"
                ? { kind: "auto-on", world }
                : null;

    return {
        lever: {
            ...motion,
            ariaLabel: focusOn
                ? `Focus mode is on in the ${FOCUS_WORLD_NAMES[world]} world. Turn it off`
                : `Turn on focus mode in the ${FOCUS_WORLD_NAMES[world]} world`,
            onTap,
            busy: busy || saving || dialog !== null,
        },
        dialog: (
            <FocusDialog
                key={`focus-dialog-${world}`}
                content={content}
                onClose={() => {
                    if (saving) return;
                    if (dialog === "auto-on") forgiveAutoNotice();
                    setDialog(null);
                }}
                onConfirm={onConfirm}
                busy={saving}
            />
        ),
    };
}
