import { useEffect, useState } from "react";
import { Snackbar, Alert } from "@mui/material";
import { FC_FONT } from "./constants";

interface TooManyTabsSnackbarProps {
    // Counter from useEipTabs that ticks up each time a tab push is rejected
    // for not fitting. Each tick re-shows the toast.
    signal: number;
}

// Top-center toast surfaced when the EIP's entry-tab strip is full and the
// user tries to open another entry. Auto-hides after ~2.5s.
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
                Too many tabs open — tap off the panel to start fresh.
            </Alert>
        </Snackbar>
    );
}

export default TooManyTabsSnackbar;
