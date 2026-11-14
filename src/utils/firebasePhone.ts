/**
 * Firebase Phone Auth, client half (docs/LOGIN_REWORK.md § 4c, Q6, Q18).
 *
 * Google sends the SMS and checks the code; the app then sends the resulting Firebase ID token
 * to OUR server (`/api/auth/phone/verify`, `/api/auth/phone/change`, step-up), which verifies it
 * and issues the app's own session. The Firebase session itself is signed out at once: it is
 * used only to prove the number.
 *
 * The SDK is imported LAZILY (only when a learner reaches a phone step), so it never weighs on
 * the main chunk or on email-only visits.
 *
 * Configuration (Vite env, all public by design):
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID
 *   VITE_FIREBASE_APPCHECK_SITE_KEY  — reCAPTCHA Enterprise site key for App Check (Q18 layer 1);
 *                                      optional on dev, required for the SMS-fraud defenses on PPE.
 * Without the first four, `phoneAuthConfigured()` is false and the phone option is greyed out —
 * EXCEPT in the Vite dev server (`import.meta.env.DEV`, false in every built bundle, so never on
 * PPE), where the DEV STAND-IN takes over: the code is "texted" by the backend's
 * DevConsolePhoneVerifier (printed to its log as "📱 [dev sms] …") and confirming it yields a
 * token the phone endpoints accept in place of a Firebase ID token.
 *
 * Layer: shared util (external SDK adapter). Depended on by: src/pages/login/PhoneStep.tsx and
 * the settings phone change.
 */

import type { ConfirmationResult } from "firebase/auth";
import { devConfirmPhoneCode, devSendPhoneCode } from "../api/auth";

const env = import.meta.env;

/** Whether the Firebase web config is present in this build. */
function firebaseConfigured(): boolean {
    return !!(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_AUTH_DOMAIN && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);
}

/** The dev stand-in (see the header): the Vite dev server with no Firebase config. */
const devStandInActive = (): boolean => !firebaseConfigured() && import.meta.env.DEV;

/** Whether this build can send an SMS code: Firebase configured, or the dev stand-in. */
export function phoneAuthConfigured(): boolean {
    return firebaseConfigured() || devStandInActive();
}

/** Loads (once) and returns the Firebase app + auth, with App Check when a site key is set. */
let authPromise: Promise<import("firebase/auth").Auth> | null = null;
async function firebaseAuth() {
    if (!authPromise) {
        authPromise = (async () => {
            const { initializeApp } = await import("firebase/app");
            const { getAuth } = await import("firebase/auth");
            const app = initializeApp({
                apiKey: env.VITE_FIREBASE_API_KEY,
                authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
                projectId: env.VITE_FIREBASE_PROJECT_ID,
                appId: env.VITE_FIREBASE_APP_ID,
            });
            const siteKey = env.VITE_FIREBASE_APPCHECK_SITE_KEY;
            if (siteKey) {
                // Q18 layer 1: only the real app may trigger an SMS send.
                const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
                initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
            }
            const auth = getAuth(app);
            auth.useDeviceLanguage();
            return auth;
        })();
        // A failed load must not be cached forever: the next attempt retries.
        authPromise.catch(() => {
            authPromise = null;
        });
    }
    return authPromise;
}

/** A pending SMS: confirm it with the 6-digit code the learner received. */
export interface PendingSms {
    confirm(code: string): Promise<string>;
}

/**
 * Send the SMS code to `phoneE164` (e.g. "+15551234567"). `recaptchaContainer` is an element
 * Firebase can mount its invisible reCAPTCHA in; it must stay in the DOM until the code is
 * confirmed. Resolves to a handle whose `confirm(code)` yields the Firebase ID token.
 */
export async function sendSmsCode(phoneE164: string, recaptchaContainer: HTMLElement): Promise<PendingSms> {
    if (devStandInActive()) {
        // Errors here are ApiErrors carrying the server's learner-facing message.
        await devSendPhoneCode(phoneE164);
        return { confirm: async (code) => (await devConfirmPhoneCode(phoneE164, code.replace(/\s+/g, ""))).idToken };
    }
    const auth = await firebaseAuth();
    const { RecaptchaVerifier, signInWithPhoneNumber, signOut } = await import("firebase/auth");
    const verifier = new RecaptchaVerifier(auth, recaptchaContainer, { size: "invisible" });
    let confirmation: ConfirmationResult;
    try {
        confirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
    } catch (e) {
        verifier.clear();
        throw new Error(firebaseMessage(e));
    }
    return {
        async confirm(code: string) {
            try {
                const credential = await confirmation.confirm(code.replace(/\s+/g, ""));
                const idToken = await credential.user.getIdToken();
                // The Firebase session is only a proof: drop it so it never lingers.
                await signOut(auth).catch(() => {});
                verifier.clear();
                return idToken;
            } catch (e) {
                throw new Error(firebaseMessage(e));
            }
        },
    };
}

/** Firebase error codes → the learner's words. Unknown codes fall back to a generic line. */
function firebaseMessage(e: unknown): string {
    const code = (e as { code?: string } | null)?.code ?? "";
    switch (code) {
        case "auth/invalid-phone-number":
            return "That phone number doesn't look right. Include your country code, e.g. +1 555 123 4567";
        case "auth/invalid-verification-code":
            return "That code is wrong";
        case "auth/code-expired":
            return "That code has expired. Ask for a new one";
        case "auth/too-many-requests":
        case "auth/quota-exceeded":
            return "Too many attempts. Please try again later";
        case "auth/operation-not-allowed":
            return "Phone sign-in isn't available right now";
        default:
            return "We couldn't send or check the code. Please try again";
    }
}
