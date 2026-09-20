import { useEffect, useState } from "react";
import { Snackbar, Alert } from "@mui/material";
import { FC_FONT } from "../constants";
import { MAX_EIP_TABS } from "./useEipTabs";

interface TooManyTabsSnackbarProps {
    // Counter from useEipTabs that ticks up each time a tab push is rejected for hitting
    // the trail's MAX_EIP_TABS cap. Each tick re-shows the toast.
    signal: number;
}

// Top-center toast surfaced when the EIP's word trail is at its MAX_EIP_TABS cap and the
// user tries to open another entry. Auto-hides after ~2.5s.
//
// It used to fire when the strip ran out of WIDTH, which happened after a handful of
// words; the strip scrolls now (EipTabStrip) and the cap is 50, so in practice this is a
// safety net rather than something a reader meets while reading.
function TooManyTabsSnackbar({ signal }: TooManyTabsSnackbarProps) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (signal > 0) setOpen(true);
    }, [signal]);
    return (
        <Snackbar
            open={open}
            autoHideDuration={2500}
            onClose={() => setOpen(false)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            sx={{ zIndex: 2000 }}
        >
            <Alert severity="info" variant="filled" onClose={() => setOpen(false)} sx={{ fontFamily: FC_FONT }}>
                {`That's ${MAX_EIP_TABS} words open — close one, or tap off the panel to start fresh.`}
            </Alert>
        </Snackbar>
    );
}

export default TooManyTabsSnackbar;
