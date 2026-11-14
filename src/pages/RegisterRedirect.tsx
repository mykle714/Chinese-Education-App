import { Navigate, useLocation } from "react-router-dom";

/**
 * `/register` → `/login` (docs/LOGIN_REWORK.md Q10, Q15). Sign-up and sign-in are one
 * identifier-first screen now; this route stays so old links and bookmarks still land there.
 * The router state (a cold-start deep link's `from`) is carried over.
 *
 * Layer: auth page (src/pages/, docs/FRONTEND_LAYERING.md). Registered in src/routes/registry.ts.
 */
export default function RegisterRedirect() {
    const location = useLocation();
    return <Navigate to="/login" replace state={location.state} />;
}
