import React from "react";
import Box from "@mui/material/Box";
import { splitClassifierLabel } from "../utils/definitionUtils";

/**
 * Renders a display gloss (a dd or a `ddt(cluster)`) as inline text, with a classifier
 * sense's fixed "classifier for" label in italics: *classifier for* books.
 *
 * Inline only — it returns text and an `<em>`, never a block — so it drops into any
 * Typography / span that already sets the font, size, colour and wrapping. It changes
 * nothing but the label's font style; the rest of the gloss inherits everything.
 *
 * No markup is ever parsed: the split is a prefix test on plain text (see
 * `splitClassifierLabel`), so gloss content can never inject elements.
 *
 * Used by: the flp/cdp card face (`CardFace` → EnglishBlock), the sense picker
 * (`SensePicker`), the eip header (`EipEntryHeader`, both the sense list and the plain
 * dd), the writing card face (`WritingCardFace`) and `MiniCard`. Game surfaces draw dd
 * as plain strings (canvas measurement, bubble radius) and do not use it.
 * See docs/DEFINITION_CLUSTERS.md § "Classifier senses".
 */
export interface GlossTextProps {
    text: string;
    /** The sense's part(s) of speech, when the caller has them — narrows the italics to
     *  senses tagged `classifier`. Omit on surfaces that hold only a flattened dd. */
    pos?: readonly string[] | null;
}

const GlossText: React.FC<GlossTextProps> = ({ text, pos }) => {
    const { label, rest } = splitClassifierLabel(text, pos);
    if (!label) return <>{text}</>;
    return (
        <>
            <Box component="em" className="gloss-text__classifier-label" sx={{ fontStyle: "italic", fontWeight: "inherit" }}>
                {label}
            </Box>
            {rest}
        </>
    );
};

export default GlossText;
