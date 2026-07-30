import { apiPost } from "../../api/http";
import type { Text } from "../../types";

// Shared by both reader surfaces (the list's download button and the open
// document's) — see docs/DATA_VALIDATION_SYSTEM.md. Composes a fresh validation
// document server-side and returns it.
//
// Goes through src/api/http.ts, which supplies the base URL, JSON envelope,
// credentials and the live Authorization header — so this takes no `token`
// parameter and a silent refresh cannot change a caller's identity. A non-2xx
// throws ApiError whose message is the server's `error` field, which is what the
// hand-rolled version reconstructed by hand.
// See docs/ARCHITECTURE_REVIEW.md finding 5.
export async function downloadValidationDoc(language: string): Promise<Text> {
    return apiPost<Text>("/api/validation/download", { language });
}
