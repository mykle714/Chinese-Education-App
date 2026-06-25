/**
 * Client adapter for the handwriting recognition proxy. The client never speaks a
 * backend's wire format — it sends canonical Ink to our server and receives ranked
 * candidates. Backend (Google / fallback) is chosen server-side.
 *
 * Depends on: POST /api/handwriting/recognize (server/server.ts).
 * Spec: docs/HANDWRITING_RECOGNITION.md.
 */
import { API_BASE_URL } from "../../constants";
import type { Ink } from "./types";

export interface RecognitionResult {
  candidates: string[];
  top1: string | null;
}

/**
 * Sends drawn strokes to the proxy and returns ranked candidates.
 *
 * @param ink    captured strokes (coords in canvas px)
 * @param width  canvas width the coords live in (declared writing area)
 * @param height canvas height the coords live in
 * @param token  auth bearer token
 */
export async function recognizeHandwriting(
  ink: Ink,
  width: number,
  height: number,
  token: string | null,
): Promise<RecognitionResult> {
  const response = await fetch(`${API_BASE_URL}/api/handwriting/recognize`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ink, writingAreaWidth: width, writingAreaHeight: height }),
  });
  if (!response.ok) {
    throw new Error(`recognition failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    top1: typeof data?.top1 === "string" ? data.top1 : null,
  };
}
