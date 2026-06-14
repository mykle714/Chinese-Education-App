import { useEffect, useState } from 'react';
import { CircularProgress, type CircularProgressProps } from '@mui/material';

/**
 * Drop-in replacement for MUI's <CircularProgress> for *resource-loading*
 * spinners (page/section data fetches).
 *
 * It forwards every CircularProgress prop unchanged, but renders nothing for
 * the first `delay` ms. The point: when the user is on a fast connection the
 * resource loads before the delay elapses, so the spinner never flashes on
 * screen at all. Only genuinely slow loads ever reveal the spinner.
 *
 * Do NOT use this for button-action spinners (submit/save), where the spinner
 * is immediate feedback for a click and must appear instantly.
 *
 * Layer: presentational UI component (shared).
 */
interface DelayedCircularProgressProps extends CircularProgressProps {
    /** Milliseconds to wait before showing the spinner. Defaults to 1000ms. */
    delay?: number;
}

function DelayedCircularProgress({ delay = 1000, ...progressProps }: DelayedCircularProgressProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Reveal the spinner only once the delay has elapsed; if the component
        // unmounts first (resource finished loading), the timer is cleared and
        // the spinner is never shown.
        const timerId = window.setTimeout(() => setVisible(true), delay);
        return () => window.clearTimeout(timerId);
    }, [delay]);

    if (!visible) {
        return null;
    }

    return <CircularProgress {...progressProps} />;
}

export default DelayedCircularProgress;
