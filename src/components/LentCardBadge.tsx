import React, { useState } from "react";
import { iconImageUrl } from "../cardIcons/cardIconLayout";

/**
 * LentCardBadge — the app's single visual mark for "this card is only borrowed".
 *
 * WHY IT EXISTS
 * A lent (provisional) card is a real card the SERVER handed the learner so a surface
 * could reach its baseline — they never sorted it and do not own it yet
 * (docs/PROVISIONAL_CARDS.md). Until now the only place that fact was stated was the
 * pre-round notice, which on the streaming surfaces (Match Speed, flp, Hydra) cannot
 * even name the words. A learner mid-round therefore had no way to tell a borrowed
 * word from one of their own. This badge is that tell, and it is deliberately ONE
 * icon used in both places: the learner meets it on the notice, then recognises it on
 * the cards.
 *
 * WHY AN ICONS8 ICON RATHER THAN A MATERIAL SYMBOL
 * The app's UI-chrome icon primitive is `Icon` (Material Symbols ligatures), and that
 * is what a permanent chrome affordance should use. This is explicitly a TEMPORARY
 * placeholder mark chosen from the icons8 set we already serve, so it lives here
 * behind one constant: swapping `LENT_ICON_ID` (or replacing the whole body with
 * `<Icon name="hourglass_top" />`) changes every site at once.
 *
 * ⚠️ DEPLOY NOTE: `GET /api/icons8/:id/image` does NOT lazily download — it 404s when
 * the row is absent (`Icons8Controller.getIconImage`, unlike the `/ensure` route). The
 * icons8 table only ever syncs prod → dev (`/data-prod-to-dev`), so a row that exists
 * on this dev box is not proof it exists on prod. Hence `onError` below: a missing
 * icon degrades to NO badge rather than a broken-image glyph on every card.
 *
 * Referenced by: src/components/ProvisionalCardsNotice.tsx,
 * src/games/match-speed/MatchSpeedCard.tsx, src/games/hydra-bubbles/HydraLendNotice.tsx.
 * Documented in docs/PROVISIONAL_CARDS.md § 5.
 */

/**
 * icons8 "Hourglass" (id 15850, category Time And Date).
 *
 * Chosen over the literal "Lend"/"Loan" icons (QAL2SzcNYnxV / xwhFqtgWcORr): those are
 * hands-passing-coins scenes that turn to mush at the ~13px corner size, and they say
 * *finance* rather than *temporary*. The hourglass is one silhouette in two tones, so
 * it survives being shrunk, and "temporary" is the thing the learner actually needs to
 * understand about the card.
 */
export const LENT_ICON_ID = "15850";

export interface LentCardIconProps {
    /** Rendered box size in px. */
    size?: number;
    /** Extra classes for the host surface's own naming. */
    className?: string;
    /** Announced label; omit for a decorative use where adjacent copy already says it. */
    title?: string;
}

/**
 * The bare icon. Renders nothing at all if the image cannot be loaded (see the deploy
 * note above), so no call site has to think about the missing-row case.
 */
export const LentCardIcon: React.FC<LentCardIconProps> = ({ size = 20, className, title }) => {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
        <img
            className={className ? `lent-card-icon ${className}` : "lent-card-icon"}
            src={iconImageUrl(LENT_ICON_ID)}
            alt={title ?? ""}
            title={title}
            aria-hidden={title ? undefined : true}
            width={size}
            height={size}
            draggable={false}
            onError={() => setFailed(true)}
            // inline-block + a nudge off the baseline so the same component can sit
            // inside a sentence and inside a flex badge without a second variant.
            style={{ display: "inline-block", verticalAlign: "-0.15em", width: size, height: size, userSelect: "none" }}
        />
    );
};

export interface LentCardBadgeProps {
    /** Icon size in px; the badge's own box is this plus its padding. */
    size?: number;
    className?: string;
}

/**
 * The corner badge form: the icon on a soft disc, absolutely positioned into the
 * top-right of whatever it is placed in. The host must be `position: relative`.
 *
 * `pointerEvents: none` is load-bearing on a game card — the badge sits inside the
 * card's own tap target, and a badge that swallowed a pointerdown would read to the
 * player as a tap that did not register.
 */
export const LentCardBadge: React.FC<LentCardBadgeProps> = ({ size = 13, className }) => (
    <span
        className={className ? `lent-card-badge ${className}` : "lent-card-badge"}
        style={{
            position: "absolute",
            top: 3,
            right: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 2,
            borderRadius: "50%",
            // A translucent white disc rather than a token fill: this sits on card
            // grounds that change colour with selection/wrong/correct state, and the
            // disc has to stay legible on all of them without tracking that state.
            background: "rgba(255, 255, 255, 0.72)",
            pointerEvents: "none",
        }}
    >
        <LentCardIcon size={size} />
    </span>
);

export default LentCardBadge;
