/**
 * Copy text to the system clipboard, returning whether it worked.
 *
 * The async Clipboard API is only available in a SECURE context (https, or
 * localhost). This app is regularly opened from another device over plain http
 * on the LAN, where `navigator.clipboard` is undefined — hence the hidden-textarea
 * + `execCommand('copy')` fallback, which still works there. `execCommand` is
 * deprecated but not removed, and it is the only thing that copies in that context.
 *
 * Referenced by: src/components/CPCDRow.tsx (tap-to-copy).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Permission denied or a non-secure context that still exposes the API —
            // fall through to the legacy path rather than failing the copy outright.
        }
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        // Keep it out of view and out of the layout, but still focusable/selectable:
        // display:none or visibility:hidden would make the selection (and the copy) fail.
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}
