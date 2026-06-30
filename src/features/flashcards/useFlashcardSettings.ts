import { useState, useCallback } from "react";

interface UseFlashcardSettingsReturn {
    showPronunciation: boolean;
    setShowPronunciation: React.Dispatch<React.SetStateAction<boolean>>;
    settingsOpen: boolean;
    setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleShowPronunciationChange: (enabled: boolean) => void;
    handleSettingsToggle: () => void;
}

export function useFlashcardSettings(): UseFlashcardSettingsReturn {
    // Flashcard settings state
    const [showPronunciation, setShowPronunciation] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(true);

    // Handle show pronunciation setting change
    const handleShowPronunciationChange = useCallback((enabled: boolean) => {
        setShowPronunciation(enabled);
    }, []);

    // Handle settings panel toggle
    const handleSettingsToggle = useCallback(() => {
        setSettingsOpen(prev => !prev);
    }, []);

    return {
        showPronunciation,
        setShowPronunciation,
        settingsOpen,
        setSettingsOpen,
        handleShowPronunciationChange,
        handleSettingsToggle
    };
}
