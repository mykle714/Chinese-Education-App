import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { reportClientError } from "../utils/errorReporting";

/**
 * AppErrorBoundary — top-level React error boundary.
 *
 * Why: the app previously had NO error boundary, so any render-phase throw
 * (e.g. an out-of-range icon-layout index in the flashcard icon editor)
 * unmounted the entire tree into a blank white screen — which is what users
 * experience as a "crash". This boundary catches those throws, ships a scrubbed
 * report to the server (see utils/errorReporting.ts → POST /api/diagnostics/error),
 * and renders a recoverable fallback instead of a blank page.
 *
 * Scope: it only catches errors thrown during React's render/commit of its
 * subtree. Errors in event handlers and async code do NOT bubble to a boundary —
 * those are captured by the global window listeners in initErrorReporting().
 *
 * Recovery: "Reload" does a full page reload (the simplest reliable reset). The
 * boundary deliberately does not try to re-render the failed subtree in place,
 * since the underlying state that caused the throw is likely still bad.
 */
interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    hasError: boolean;
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): AppErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportClientError({
            kind: "react",
            message: error?.message || String(error),
            stack: error?.stack,
            componentStack: info?.componentStack ?? undefined,
        });
    }

    render(): ReactNode {
        if (!this.state.hasError) return this.props.children;
        return (
            <Box
                className="app-error-boundary"
                sx={{
                    minHeight: "100vh",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    px: 3,
                    textAlign: "center",
                }}
            >
                <Typography className="app-error-boundary__title" variant="h6">
                    Something went wrong
                </Typography>
                <Typography
                    className="app-error-boundary__message"
                    variant="body2"
                    sx={{ color: "text.secondary", maxWidth: 320 }}
                >
                    The app hit an unexpected error and couldn't continue. Reloading
                    usually fixes it.
                </Typography>
                <Button
                    className="app-error-boundary__reload"
                    variant="contained"
                    onClick={() => window.location.reload()}
                >
                    Reload
                </Button>
            </Box>
        );
    }
}

export default AppErrorBoundary;
