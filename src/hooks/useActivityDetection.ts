import { useEffect, useCallback } from 'react';

interface UseActivityDetectionOptions {
    onActivity: () => void;
    isEnabled: boolean;
    events?: string[];
}

/**
 * Hook to detect user activity through various input events
 * Tracks clicks, keyboard presses, and touch events (but not mouse movement)
 */
export const useActivityDetection = ({
    onActivity,
    isEnabled,
    events = ['click', 'keydown', 'touchstart']
}: UseActivityDetectionOptions) => {
    
    // Memoized activity handler to prevent unnecessary re-renders
    const handleActivity = useCallback((_event: Event) => {
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
