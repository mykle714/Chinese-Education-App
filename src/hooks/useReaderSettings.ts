import { useMemo, useState } from "react";

interface UseReaderSettingsReturn {
    autoSelectEnabled: boolean;
    setAutoSelectEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    settingsOpen: boolean;
    setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleAutoSelectChange: (enabled: boolean) => void;
    handleSettingsToggle: () => void;
}

export function useReaderSettings(): UseReaderSettingsReturn {
    // Reader settings state
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(true);

    // Handle auto-select setting change
    const handleAutoSelectChange = (enabled: boolean) => {
        setAutoSelectEnabled(enabled);
        console.log(`[READER-SETTINGS] Auto word selection ${enabled ? 'enabled' : 'disabled'}`);
    };

    // Handle settings panel toggle
    const handleSettingsToggle = () => {
        setSettingsOpen(prev => !prev);
    };

    return useMemo(() => ({
        autoSelectEnabled,
        setAutoSelectEnabled,
        settingsOpen,
        setSettingsOpen,
        handleAutoSelectChange,
        handleSettingsToggle
    }), [autoSelectEnabled, settingsOpen]);
}
