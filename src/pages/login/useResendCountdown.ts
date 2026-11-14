import { useEffect, useState } from "react";

/**
 * Seconds left before a code may be re-sent (the server's 30 s cooldown, docs/LOGIN_REWORK.md
 * Q16), counting down once a second. `restart(seconds)` after each send.
 *
 * Layer: page hook (src/pages/login/). Used by CodeStep and PhoneStep.
 */
export function useResendCountdown(initialSeconds: number): { secondsLeft: number; restart: (seconds: number) => void } {
    const [until, setUntil] = useState(() => Date.now() + initialSeconds * 1000);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (now >= until) return;
        const t = window.setTimeout(() => setNow(Date.now()), 1000);
        return () => window.clearTimeout(t);
    }, [now, until]);
    return {
        secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)),
        restart: (seconds: number) => {
            setUntil(Date.now() + seconds * 1000);
            setNow(Date.now());
        },
    };
}
