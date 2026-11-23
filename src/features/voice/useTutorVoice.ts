import { useCallback, useState } from "react";
import { toTutorVoiceRole, type TutorVoiceRole } from "../../../server/contracts/voice";

/**
 * The tutor's voice — male or female (docs/VOICE_ASSISTANT.md Q14, Q21).
 *
 * Its OWN setting, saved in browser storage on its own key, independent of the card
 * narration voice (useTTSSettings). The server maps the role to a Chirp3-HD voice; no
 * provider voice name exists on the client.
 *
 * Layer: feature hook. Used by VoiceSessionSheet (the toggle) and VoiceReviewPage (replay).
 */
const STORAGE_KEY = "voiceTutorVoice";

function readStored(): TutorVoiceRole {
    try {
        return toTutorVoiceRole(localStorage.getItem(STORAGE_KEY));
    } catch {
        return "female";
    }
}

export function useTutorVoice(): [TutorVoiceRole, (voice: TutorVoiceRole) => void] {
    const [voice, setVoiceState] = useState<TutorVoiceRole>(readStored);
    const setVoice = useCallback((next: TutorVoiceRole) => {
        setVoiceState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Storage unavailable (private mode): the choice lasts for this page only.
        }
    }, []);
    return [voice, setVoice];
}
