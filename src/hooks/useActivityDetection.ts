import { useEffect, useCallback } from 'react';

interface UseActivityDetectionOptions {
    onActivity: () => void;
    isEnabled: boolean;
    events?: string[];
}

/**
 * Hook to detect user activity through various input events
 * Tracks clicks, keyboard presses, touch starts, and pointer-downs (but not
 * mouse movement).
 *
 * `pointerdown` is included because some surfaces (e.g. the Bubble Match game)
 * are driven entirely by pointer events with `touch-action: none` and dragging:
 * a bubble drag fires `pointerdown` but never a `click` (the pointer moves
 * before release), so without this it would not register as activity. Listening
 * for `pointerdown` covers mouse/touch/pen uniformly. On touch devices both
 * `touchstart` and `pointerdown` fire, but the duplicate call is harmless — the
 * activity timeout is simply reset twice.
 */
export const useActivityDetection = ({
    onActivity,
    isEnabled,
    events = ['click', 'keydown', 'touchstart', 'pointerdown']
}: UseActivityDetectionOptions) => {
    
    // Memoized activity handler to prevent unnecessary re-renders
    const handleActivity = useCallback(() => {
        // Only track activity if enabled
        if (!isEnabled) return;
        
        // Call the activity callback
        onActivity();
    }, [onActivity, isEnabled]);
    
    useEffect(() => {
        if (!isEnabled) return;
        
        // Add event listeners for activity detection
        events.forEach(eventType => {
            document.addEventListener(eventType, handleActivity, { 
                passive: true,
                capture: true // Capture phase to catch events early
            });
        });
        
        // Cleanup function to remove event listeners
        return () => {
            events.forEach(eventType => {
                document.removeEventListener(eventType, handleActivity, true);
            });
        };
    }, [handleActivity, isEnabled, events]);
    
    // Return cleanup function for manual cleanup if needed
    return useCallback(() => {
        events.forEach(eventType => {
            document.removeEventListener(eventType, handleActivity, true);
        });
    }, [handleActivity, events]);
};

export default useActivityDetection;
