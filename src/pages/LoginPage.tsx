import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../AuthContext';
import * as authStorage from '../utils/authStorage';
import { APP_NAME, usePageTitle } from '../hooks/usePageTitle';
import { COLORS } from '../theme/colors';
import { FONTS } from '../theme/fonts';
import { LEADING, SIZE, WEIGHT } from '../theme/scale';
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
import CodeStep from './login/CodeStep';
import PhoneStep from './login/PhoneStep';
import DetailsStep from './login/DetailsStep';
import { useCardSlideIn } from './login/useCardSlideIn';
import WindowSlide from './login/WindowSlide';

// ── The fixed title spot (see the header, "Layout") ──
/** The title's spot: this share of the way down the sky region, but never closer to the top than TITLE_MIN_TOP. */
const TITLE_TOP_SHARE = 0.14;
const TITLE_MIN_TOP = `calc(${SAFE_TOP} + 24px)`;
/** The title's height: SIZE.display (40 px) at line-height 1. */
const TITLE_HEIGHT_PX = 40;
/** From the title's bottom to the top of the window below it. */
const TITLE_TO_CARD_GAP_PX = 16;
/** Create account's top: it ignores the title and starts near the top of the screen, over it. */
const TALL_CARD_TOP = `calc(${SAFE_TOP} + 16px)`;
/** Space between the notices (session ended, test finished) and the card. */
const COLUMN_GAP_PX = 8;

/**
 * The one sign-in / sign-up screen (`/login`; `/register` redirects here) —
 * docs/LOGIN_REWORK.md § 3–4, decisions Q8–Q21.
 *
 * Identifier first (a phone field, email behind "Other ways to sign in"), then the
 * verification window for that identifier (owner, 2026-11-15: no password window):
 *   email → "Send code" → code → signed in (known) | details (new)    (verify first, then details, Q14)
 *   phone → "Text me a code" → SMS code (Firebase) → signed in (known) | details (new)
 * Both verification windows fold a "Sign in with password" section (shown for every identifier,
 * account or not), whose "Forgot password?" leads to that channel's reset window. The password
 * itself is optional, chosen on the details step (Create account) or later in Settings.
 * Every success lands in AuthContext (`login` / `establishSession`), and THIS component's one
 * redirect takes the learner on: the cold-start deep link ProtectedRoute recorded, else `/`
 * (R1, R3, Q2).
 *
 * The screen continues the launch sky (Q12): the boot cover's circle opens onto the same day sky
 * (BOOT_COVER_GROUND) and the same pawn on its platform (useBootScene), left exactly where the
 * drop put it (feet a fifth of the way up the screen), with the form in a raised card in the sky
 * above it. The title and the card slide in from the top together when the cover has gone
 * (login/useCardSlideIn.ts). It lives in the phone frame (routeMeta: shell "frame"), so the
 * cover never changes shell under it.
 *
 * Layout (owner, 2026-11-15): the app title (a PLACEHOLDER: the app name in plain display type
 * until a wordmark is designed) has ONE fixed spot, TITLE_TOP_SHARE of the way down the sky
 * region, and never moves. Every window hangs from just below it (TITLE_TO_CARD_GAP_PX) and grows
 * DOWNWARD only, over the pawn when it has to ("Other ways to sign in" opening, a longer step).
 * Create account (the details step) is the exception: it is tall enough to need the whole screen,
 * so it starts near the top (TALL_CARD_TOP) and covers the title. The title sits outside the
 * scroller, under it, so it stays put while a window scrolls. The scroller is stretched from the
 * sky region down to the bottom of the screen (`belowPx`, measured) so a grown window covers the
 * pawn instead of being clipped above it.
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
    // The email verification window: `sent` is the send that opened it (reset), or null (sign-in:
    // nothing is sent until the learner taps "Send code").
    | { kind: 'code'; email: string; purpose: 'sign-in' | 'reset'; sent: CodeSent | null }
    | { kind: 'phone'; phone: string; purpose: 'sign-in' | 'reset' }
    | { kind: 'details'; next: SignUpNext };

function LoginPage() {
    usePageTitle('Sign in');
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    const renderScene = useBootScene();
    const [step, setStep] = useState<Step>({ kind: 'identifier' });
    // What was typed in step 1 and which box (phone / email) was showing, so going back brings it back.
    const [identifierDraft, setIdentifierDraft] = useState<IdentifierDraft>(() => ({ mode: 'phone', email: '', phoneDigits: emptyPhoneDigits() }));
    // Which box step 1 is showing right now (IdentifierStep owns it; it reports swaps), so the
    // phone ⇄ email swap counts as a new window for WindowSlide.
    const [identifierMode, setIdentifierMode] = useState<IdentifierDraft['mode']>('phone');
    const [sessionExpired, setSessionExpired] = useState(false);
    // A test sign-up (login/testSignUp.ts) just finished: say so over step 1 until the next Continue.
    const [testFinished, setTestFinished] = useState(false);
    // Phone sign-in shows only when BOTH halves are configured: the Firebase web config in this
    // build and FIREBASE_PROJECT_ID on the server.
    const [phoneEnabled, setPhoneEnabled] = useState(false);
    // The card slides in from the top once the boot cover is gone (useCardSlideIn). Called before
    // the early returns below (hooks rule); it waits for the form to actually be on screen.
    const cardSlide = useCardSlideIn(!isLoading && !isAuthenticated);

    // ── Layout (see the header) ──
    // The sky region the scene gives the form (`skyPx`, its height: places the title) and how far
    // the screen extends below it (`belowPx`: down over the pawn to the bottom). The region is
    // read through a callback-ref'd child because, off a cold start, the form first renders in the
    // scene's Suspense fallback and then moves into the real scene.
    const [layerEl, setLayerEl] = useState<HTMLDivElement | null>(null);
    const [belowPx, setBelowPx] = useState(0);
    const [skyPx, setSkyPx] = useState(0);
    useLayoutEffect(() => {
        const page = pageRef.current;
        const region = layerEl?.parentElement;
        if (!page || !region) return;
        const measure = () => {
            const r = region.getBoundingClientRect();
            setBelowPx(Math.max(0, Math.round(page.getBoundingClientRect().bottom - r.bottom)));
            setSkyPx(Math.round(r.height));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(page);
        ro.observe(region);
        return () => ro.disconnect();
    }, [layerEl]);

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
    // The window on screen: a change slides the card left (login/WindowSlide.tsx).
    const windowKey =
        step.kind === 'identifier' ? `identifier-${identifierMode}` : step.kind === 'code' || step.kind === 'phone' ? `${step.kind}-${step.purpose}` : step.kind;
    // Where the title sits and where the window hangs (see the header, "Layout").
    const titleTop = `max(${TITLE_MIN_TOP}, ${Math.round(skyPx * TITLE_TOP_SHARE)}px)`;
    const cardTop = step.kind === 'details' ? TALL_CARD_TOP : `calc(${titleTop} + ${TITLE_HEIGHT_PX + TITLE_TO_CARD_GAP_PX}px)`;

    let body: ReactElement;
    switch (step.kind) {
        case 'identifier':
            body = (
                <IdentifierStep
                    initial={identifierDraft}
                    phoneEnabled={phoneEnabled}
                    onContinue={(id, draft) => {
                        setIdentifierDraft(draft);
                        setIdentifierMode(draft.mode);
                        setSessionExpired(false);
                        setTestFinished(false);
                        setStep(id.kind === 'email' ? { kind: 'code', email: id.value, purpose: 'sign-in', sent: null } : { kind: 'phone', phone: id.value, purpose: 'sign-in' });
                    }}
                    onModeChange={setIdentifierMode}
                />
            );
            break;
        case 'code':
            body = (
                <CodeStep
                    email={step.email}
                    purpose={step.purpose}
                    initialSent={step.sent}
                    onSignUp={(next) => setStep({ kind: 'details', next })}
                    onResetCodeSent={(sent) => setStep({ kind: 'code', email: step.email, purpose: 'reset', sent })}
                    // The reset window backs out to the sign-in window; the sign-in window to step 1.
                    onBack={() => (step.purpose === 'reset' ? setStep({ kind: 'code', email: step.email, purpose: 'sign-in', sent: null }) : toIdentifier())}
                />
            );
            break;
        case 'phone':
            body = (
                <PhoneStep
                    phone={step.phone}
                    purpose={step.purpose}
                    onSignUp={(next) => setStep({ kind: 'details', next })}
                    onForgotPassword={() => setStep({ kind: 'phone', phone: step.phone, purpose: 'reset' })}
                    onBack={() => (step.purpose === 'reset' ? setStep({ kind: 'phone', phone: step.phone, purpose: 'sign-in' }) : toIdentifier())}
                />
            );
            break;
        case 'details':
            body = (
                <DetailsStep
                    next={step.next}
                    onStartOver={toIdentifier}
                    onTestFinished={() => {
                        setTestFinished(true);
                        setStep({ kind: 'identifier' });
                    }}
                />
            );
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
                    // The title and the scroller slide in together (useCardSlideIn), so this layer
                    // carries the slide; it fills the sky region exactly.
                    <Box
                        ref={(el: HTMLDivElement | null) => {
                            setLayerEl(el);
                            cardSlide.ref(el);
                        }}
                        className="login-page__layer"
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            // Invisible (still laid out, so the slide can measure it) while the boot
                            // cover is up; it then slides in from the top (useCardSlideIn).
                            visibility: cardSlide.hidden ? 'hidden' : 'visible',
                        }}
                    >
                        {/* The app title, in its one fixed spot. A PLACEHOLDER: the app name in plain
                            display type, standing in for a wordmark not designed yet. Under the
                            scroller, so Create account can cover it. */}
                        <Typography
                            component="p"
                            className="login-page__title"
                            sx={{
                                position: 'absolute',
                                top: titleTop,
                                left: 0,
                                right: 0,
                                textAlign: 'center',
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.display,
                                fontWeight: WEIGHT.bold,
                                lineHeight: LEADING.none,
                                letterSpacing: '-0.02em',
                                color: COLORS.onSurface,
                            }}
                        >
                            {APP_NAME}
                        </Typography>
                        <Box
                            className="login-page__scroller"
                            // overflow-x: hidden still lets a focus() scroll sideways (the incoming
                            // window's autofocused field sits off to the right mid-slide): undo it.
                            onScroll={(e) => {
                                if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0;
                            }}
                            sx={{
                                // The frame never scrolls; this page opts in with its own scroller
                                // (docs/UX_AND_NAVIGATION.md). It reaches down to the bottom of the
                                // screen (`belowPx`), so a window that grows past the sky covers the
                                // pawn rather than being clipped above it, and one taller than the
                                // screen (Create account on a short phone) scrolls.
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: -belowPx,
                                overflowY: 'auto',
                                // The incoming window starts a screen to the right (WindowSlide);
                                // hidden, so it never adds a horizontal scroll.
                                overflowX: 'hidden',
                                touchAction: 'pan-y',
                            }}
                        >
                            <Box
                                className="login-page__column"
                                sx={{
                                    width: '100%',
                                    maxWidth: 420,
                                    mx: 'auto',
                                    px: 2,
                                    // Hung from the title (or, for Create account, from the top).
                                    pt: cardTop,
                                    pb: 2,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'stretch',
                                    gap: `${COLUMN_GAP_PX}px`,
                                }}
                            >
                                {sessionExpired && (
                                    <FormMessage className="login-page__session-expired" tone="notice">
                                        Your session has ended. Please sign in again.
                                    </FormMessage>
                                )}
                                {testFinished && (
                                    <FormMessage className="login-page__test-finished" tone="notice">
                                        Test sign-up finished. No account was created.
                                    </FormMessage>
                                )}
                                <WindowSlide windowKey={windowKey}>
                                    <LoginCard>{body}</LoginCard>
                                </WindowSlide>
                            </Box>
                        </Box>
                    </Box>
                ),
            })}
        </Box>
    );
}

export default LoginPage;
