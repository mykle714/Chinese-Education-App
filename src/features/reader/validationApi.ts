import { API_BASE_URL } from "../../constants";
import type { Text } from "../../types";

// Shared by both reader surfaces (the list's download button and the open
// document's) — see docs/DATA_VALIDATION_SYSTEM.md. Composes a fresh validation
// document server-side and returns it, or throws with the server's error message.
export async function downloadValidationDoc(token: string | null, language: string): Promise<Text> {
    const response = await fetch(`${API_BASE_URL}/api/validation/download`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ language }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error || 'Failed to download an entry to validate');
    }
    return data as Text;
}
