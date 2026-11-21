import { Box } from "@mui/material";
import { IsoScene, IsoShadow, makeProjector } from "../features/deckTower/iso";
import { HEAD_CENTRE, HEAD_RADIUS, REST_POSE, pawnFigure } from "../features/deckTower/iso/pawnFigure";
import { useIsoPalette, useIsoProjector } from "../features/deckTower/iso/sceneContext";
import { PAWN_FOOT_RADIUS } from "../features/deckTower/iso/usePawnMotion";
import { COLORS } from "../theme/colors";

/**
 * ReaderKeycapPawn — the dictionary keycap's EMPTY face: a small pawn standing at rest in the
 * middle of the face, holding the space when the highlighted word has no entry (no det row,
 * no English translation, a grammar word) instead of a "No dictionary entry found." line
 * (owner's call 2026-11-17). Passed to VocabDisplayCard as `emptyFace`.
 *
 * The iso framework's pawn (iso/pawnFigure.ts → `pawnFigure`, REST_POSE) in ink, with a
 * hard CENTRED floor shadow (IsoShadow `centred`: straight under the feet, not slid along
 * the light) laid on the keycap's white face — the same figure as the
 * Deck Tower's IsoPawnStill, which hardcodes a card-stock receiver and so is not reused
 * here. Static: no motion, no tap reaction.
 *
 * Layer: shared presentational component (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Reaches into the iso kit
 * (src/features/deckTower/iso), as the flp's HintPawn does.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Dictionary keycap).
 */

/** Screen px per world unit — sets the pawn's size (~40 px from feet to head top). */
const UNIT = 14;
const PROJ = makeProjector(UNIT);
const FEET = { x: 0, y: 0, z: 0 };

/** The scene's px box around the feet: the head above, the foot shadow's ellipse below. */
const SCENE_BOX = (() => {
    const pad = 2;
    const headTop = HEAD_CENTRE * PROJ.heightUnit + HEAD_RADIUS * PROJ.facingScaleAt(0, 0, 0);
    // The foot disc projects to a floor ellipse 2r·√2·unit wide; the centred shadow grows it
    // a little on every side (light.ts → centredShadowFootprint), so give the sides and the
    // bottom a full radius more.
    const halfWidth = 2 * PAWN_FOOT_RADIUS * UNIT * Math.SQRT2 + pad;
    const below = 2 * PAWN_FOOT_RADIUS * UNIT + pad;
    const top = -headTop - pad;
    return { viewBox: `${-halfWidth} ${top} ${2 * halfWidth} ${below - top}`, width: 2 * halfWidth, height: below - top };
})();

function KeycapPawnFigure() {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const fig = pawnFigure(proj, FEET, REST_POSE);
    const r = PAWN_FOOT_RADIUS;
    return (
        <g className="reader-keycap-pawn__figure">
            <IsoShadow
                footprint={{ x: FEET.x - r, y: FEET.y - r, w: 2 * r, d: 2 * r, r }}
                casterZ={FEET.z}
                receiver={{ z: FEET.z, color: COLORS.white }}
                // Straight under the feet, not slid down-right along the light: the pawn
                // stands alone in the middle of the keycap, and a lit shadow read as off-centre.
                centred
            />
            <path className="reader-keycap-pawn__body" d={fig.bodyPath} fill={palette.ink} />
            <circle className="reader-keycap-pawn__head" cx={fig.head.cx} cy={fig.head.cy} r={fig.head.r} fill={palette.ink} />
        </g>
    );
}

function ReaderKeycapPawn() {
    return (
        <Box
            className="reader-keycap-pawn"
            sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
            <IsoScene
                proj={PROJ}
                viewBox={SCENE_BOX.viewBox}
                className="reader-keycap-pawn__scene"
                style={{ width: SCENE_BOX.width, height: SCENE_BOX.height, display: "block", overflow: "visible" }}
            >
                <KeycapPawnFigure />
            </IsoScene>
        </Box>
    );
}

export default ReaderKeycapPawn;
