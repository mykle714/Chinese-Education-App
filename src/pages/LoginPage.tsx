import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { useAuth } from '../AuthContext';
import * as authStorage from '../utils/authStorage';
import { usePageTitle } from '../hooks/usePageTitle';
import { useBootScene } from '../hooks/useBootCover';
import { runCircleExit } from '../hooks/usePageSlide';
import { postLoginPath } from '../utils/loginRedirect';
import { fetchSignInMethods, type CodeSent, type SignUpNext } from '../api/auth';
import { phoneAuthConfigured } from '../utils/firebasePhone';
import { BOOT_COVER_GROUND } from '../components/bootCover/bootCoverGround';
import { SAFE_TOP } from '../theme/safeArea';
import { FormMessage, LoginCard } from './login/loginUi';
import IdentifierStep, { type IdentifierDraft } from './login/IdentifierStep';
import { emptyPhoneDigits } from './login/identifier';
import EmailPasswordStep from './login/EmailPasswordStep';
import CodeStep from './login/CodeStep';
import PhoneStep from './login/PhoneStep';
import DetailsStep from './login/DetailsStep';
import { useCardSlideIn } from './login/useCardSlideIn';

/**
 * The one sign-in / sign-up screen (`/login`; `/register` redirects here) —
 * docs/LOGIN_REWORK.md § 3–4, decisions Q8–Q21.
 *
 * Identifier first: an Email box and a Phone box (each with its own Continue), then
 *   email → password OR "Email me a code" OR "Forgot password?"  (the same for every address, Q17)
 *         → code → signed in (known) | details (new)            (verify first, then details, Q14)
 *   phone → SMS code (Firebase) → signed in (known) | details (new)
 * Every success lands in AuthContext (`login` / `establishSession`), and THIS component's one
 * redirect takes the learner on: the cold-start deep link ProtectedRoute recorded, else `/`
 * (R1, R3, Q2).
 *
 * The screen continues the launch sky (Q12): the boot cover's circle opens onto the same day sky
 * (BOOT_COVER_GROUND) and the same pawn on its platform (useBootScene), left exactly where the
 * drop put it (feet a fifth of the way up the screen), with the form in a raised card in the sky
 * above it. The card slides in from the top when the cover has gone (login/useCardSlideIn.ts). It lives in the phone frame (routeMeta: shell "frame"), so the cover never
 * changes shell under it.
 *
 * Leaving after a sign-in plays the boot circle in REVERSE (owner, 2026-11-14): the destination
 * mounts underneath at once, and the whole login screen (sky, card, pawn and platform) shrinks
 * into a circle closing onto the centre of the platform's floor (usePageSlide.ts →
 * runCircleExit, the app's circle transition). Landing here on a session that was already live
 * (a deep link to /login, a silent refresh under the boot cover) redirects with no circle.
 *
 * Layer: auth page (src/pages/, docs/FRONTEND_LAYERING.md). Steps in src/pages/login/.
 */

type Step =
    | { kind: 'identifier' }
    | { kind: 'email'; email: string }
    | { kind: 'code'; email: string; purpose: 'sign-in' | 'reset'; sent: CodeSent }
    | { kind: 'phone'; phone: string }
    | { kind: 'details'; next: SignUpNext; identifier: string };

function LoginPage() {
    usePageTitle('Sign in');
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    const renderScene = useBootScene();
    const [step, setStep] = useState<Step>({ kind: 'identifier' });
    // What was typed in step 1 and which box (phone / email) was showing, so going back brings it back.
    const [identifierDraft, setIdentifierDraft] = useState<IdentifierDraft>(() => ({ mode: 'phone', email: '', phoneDigits: emptyPhoneDigits() }));
    const [sessionExpired, setSessionExpired] = useState(false);
    // Phone sign-in shows only when BOTH halves are configured: the Firebase web config in this
    // build and FIREBASE_PROJECT_ID on the server.
    const [phoneEnabled, setPhoneEnabled] = useState(false);
    // The card slides in from the top once the boot cover is gone (useCardSlideIn). Called before
    // the early returns below (hooks rule); it waits for the form to actually be on screen.
    const cardSlide = useCardSlideIn(!isLoading && !isAuthenticated);

    // The exit circle (see the header). `formShown` turns true once the signed-out form has been
    // on screen, so only a sign-in made HERE gets the circle; a session that was live on arrival
    // keeps the plain <Navigate> below. An effect sets it, so it is already true on the render
    // in which auth flips.
    const navigate = useNavigate();
    const pageRef = useRef<HTMLDivElement>(null);
    const platformCentreRef = useRef<HTMLDivElement>(null);
    const formShown = useRef(false);
    useEffect(() => {
        if (!isLoading && !isAuthenticated) formShown.current = true;
    }, [isLoading, isAuthenticated]);
    // A layout effect so the clone is taken from the frame on screen, before anything repaints.
    useLayoutEffect(() => {
        if (!isAuthenticated || !formShown.current) return;
        const go = () => navigate(postLoginPath(location.state), { replace: true });
        const page = pageRef.current;
        const centre = platformCentreRef.current?.getBoundingClientRect();
        // No scene drawn (its chunk still loading): no point to close onto, so just go.
        if (!page || !centre) {
            go();
            return;
        }
        runCircleExit(page, go, { x: centre.left, y: centre.top });
        // Once per sign-in: the navigation unmounts this page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // The interceptor's "your session ended" flag, consumed once (TOKEN_EXPIRATION_IMPLEMENTATION.md).
    useEffect(() => {
        if (authStorage.wasSessionExpired()) {
            setSessionExpired(true);
            authStorage.clearSessionExpired();
        }
    }, []);

    useEffect(() => {
        if (!phoneAuthConfigured()) return;
        let live = true;
        fetchSignInMethods()
            .then((m) => live && setPhoneEnabled(m.phone))
            .catch(() => {
                // Unknown → email only; nothing to tell the learner.
            });
        return () => {
            live = false;
        };
    }, []);

    // THE post-sign-in redirect (R3), in two forms. A success on this page (each one sets the
    // user in AuthContext and this re-renders) leaves through the exit circle above, so the form
    // keeps rendering for that last frame. Landing here on a live session (a silent refresh
    // restored it) redirects straight away. `replace` keeps /login out of the history stack
    // either way. The destination is the cold-start deep link ProtectedRoute recorded, else `/`
    // (postLoginPath, Q2).
    if (isLoading) {
        return null; // auth still resolving (under the boot cover on a launch) — don't flash the form
    }
    if (isAuthenticated && !formShown.current) {
        return <Navigate to={postLoginPath(location.state)} replace />;
    }

    const toIdentifier = () => setStep({ kind: 'identifier' });

    let body: ReactElement;
    switch (step.kind) {
        case 'identifier':
            body = (
                <IdentifierStep
                    initial={identifierDraft}
                    phoneEnabled={phoneEnabled}
                    onContinue={(id, draft) => {
                        setIdentifierDraft(draft);
                        setSessionExpired(false);
                        setStep(id.kind === 'email' ? { kind: 'email', email: id.value } : { kind: 'phone', phone: id.value });
                    }}
                />
            );
            break;
        case 'email':
            body = (
                <EmailPasswordStep
                    email={step.email}
                    onCodeSent={(purpose, sent) => setStep({ kind: 'code', email: step.email, purpose, sent })}
                    onChangeIdentifier={toIdentifier}
                />
            );
            break;
        case 'code':
            body = (
                <CodeStep
                    email={step.email}
                    purpose={step.purpose}
                    resendAfterSeconds={step.sent.resendAfterSeconds}
                    onSignUp={(next) => setStep({ kind: 'details', next, identifier: step.email })}
                    onBack={() => setStep({ kind: 'email', email: step.email })}
                />
            );
            break;
        case 'phone':
            body = (
                <PhoneStep
                    phone={step.phone}
                    onSignUp={(next) => setStep({ kind: 'details', next, identifier: step.phone })}
                    onBack={toIdentifier}
                />
            );
            break;
        case 'details':
            body = <DetailsStep next={step.next} identifier={step.identifier} onStartOver={toIdentifier} />;
            break;
    }

    return (
        <Box ref={pageRef} className="login-page" sx={{ position: 'absolute', inset: 0, backgroundColor: BOOT_COVER_GROUND }}>
            {/* The launch pawn on its platform, exactly where the drop left it (the circle opened
                out of it); the form fills the sky above it (useBootScene → BootSceneRenderProps). */}
            {renderScene({
                className: 'login-page__scene',
                platformCentreRef,
                children: (
                    <Box
                        className="login-page__scroller"
                        sx={{
                            // The frame never scrolls; this page opts in with its own scroller
                            // (docs/UX_AND_NAVIGATION.md). It ends just above the pawn's head, so a
                            // tall step (details) scrolls instead of covering the pawn.
                            position: 'absolute',
                            inset: 0,
                            overflowY: 'auto',
                            touchAction: 'pan-y',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <Box
                            ref={cardSlide.ref}
                            className="login-page__column"
                            sx={{
                                // Invisible (still laid out, so the slide can measure it) while the
                                // boot cover is up; it then slides in from the top (useCardSlideIn).
                                visibility: cardSlide.hidden ? 'hidden' : 'visible',
                                width: '100%',
                                maxWidth: 420,
                                mx: 'auto',
                                // Auto margins centre the card in the sky when it fits, and let it
                                // scroll from its top when it does not (justify-content would clip it).
                                my: 'auto',
                                px: 2,
                                pt: `calc(${SAFE_TOP} + 16px)`,
                                pb: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                gap: 1,
                            }}
                        >
                            {sessionExpired && (
                                <FormMessage className="login-page__session-expired" tone="notice">
                                    Your session has ended. Please sign in again.
                                </FormMessage>
                            )}
                            <LoginCard>{body}</LoginCard>
                        </Box>
                    </Box>
                ),
            })}
        </Box>
    );
}

export default LoginPage;
