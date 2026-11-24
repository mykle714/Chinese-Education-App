/**
 * Client adapter for the handwriting recognition proxy. The client never speaks a
 * backend's wire format — it sends canonical Ink to our server and receives ranked
 * candidates. Backend (Google / fallback) is chosen server-side.
 *
 * Transport: `apiPost` (src/api/http.ts), so the Authorization header is read at call
 * time and the global fetch interceptor's token refresh + 401 retry apply. It takes no
 * `token` (docs/FRONTEND_LAYERING.md § 3.2); until 2026-11-23 it was a raw `fetch` with a
 * caller-passed token, which skipped the refresh and turned an expired token into a 401.
 *
 * ⛔ FAILURE MUST THROW. Any non-2xx (the proxy's 502 `ERR_UPSTREAM` when Google is down,
 * a 429 from its rate limiter, a 400 other than the one below) or a network error rejects
 * — `apiPost` throws an `ApiError`. Every caller reads a rejection as "the check could
 * not run" and records NO verdict or mark, leaving the attempt for a retry:
 * useWritingFlashcard → handleSubmit, WritingGridStage → handleCellDone,
 * PracticeWritingPopup → handleVerify. Never swallow those here into an empty result,
 * which callers would grade as a wrong answer.
 *
 * The ONE exception is a 400 `ERR_BAD_INK` (server/utils/handwritingRecognizer.ts →
 * `validateInk`): the drawing itself was refused — in practice a scribble past
 * MAX_STROKES or a stroke past MAX_POINTS_PER_STROKE. Retrying sends the same ink and
 * fails the same way, so a retry-forever would trap the learner on the card. It is
 * answered as "nothing recognised" (`top1: null`), which every caller grades wrong —
 * the drawing was not a readable character. (Added 2026-11-23.) `ERR_BAD_WRITING_AREA`
 * is NOT included: the canvas size is a client constant, so that 400 is a code bug,
 * not the learner's answer.
 *
 * Depends on: POST /api/handwriting/recognize (server/routes/handwritingRoutes.ts).
 * Spec: docs/HANDWRITING_RECOGNITION.md.
 */
import { ApiError, apiPost } from "../../api/http";
import type { Ink } from "./types";

export interface RecognitionResult {
  candidates: string[];
  top1: string | null;
}

/**
 * Sends drawn strokes to the proxy and returns ranked candidates. Rejects when the
 * check could not run (see the header).
 *
 * @param ink    captured strokes (coords in canvas px)
 * @param width  canvas width the coords live in (declared writing area)
 * @param height canvas height the coords live in
 */
export async function recognizeHandwriting(
  ink: Ink,
  width: number,
  height: number,
): Promise<RecognitionResult> {
  let data: { candidates?: unknown; top1?: unknown } | null;
  try {
    data = await apiPost<{ candidates?: unknown; top1?: unknown } | null>(
      "/api/handwriting/recognize",
      { ink, writingAreaWidth: width, writingAreaHeight: height },
      // A read sent as POST (the ink is the body), so safe to repeat: the proxy's 502 when
      // Google hiccups, or a network blip, is retried quietly before callers see a failure.
      { retry: true },
    );
  } catch (err) {
    // Refused ink is an unreadable answer, not a failed check (see the header).
    if (isRefusedInk(err)) return { candidates: [], top1: null };
    throw err;
  }
  return {
    candidates: Array.isArray(data?.candidates) ? (data.candidates as string[]) : [],
    top1: typeof data?.top1 === "string" ? data.top1 : null,
  };
}

/** The proxy's 400 for a drawing `validateInk` refused (too many strokes / points). */
function isRefusedInk(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  const body = err.response.data as { code?: unknown } | null;
  return body?.code === "ERR_BAD_INK";
}
