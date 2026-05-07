/** Server-side bridge to https://api.lurna.co (or `LURNA_API_BASE_URL`). */

import { resolveLurnaUpstreamAuthHeaders } from "./lurna-outbound-auth";

export function normalizePath(path: string): string {
  const p = path.trim();
  if (!p.startsWith("/")) return `/${p}`;
  return p;
}

function getBaseUrl(): string {
  const base =
    process.env.LURNA_API_BASE_URL?.replace(/\/+$/, "") ||
    "https://api.lurna.co";
  return base;
}

/** If set (comma-separated path prefixes like `/generate-study-set,/generate-quiz-from-flashcards-streaming`), only those paths may be called. */
function assertPathAllowed(normalizedPath: string): string | undefined {
  const raw = process.env.LURNA_PATH_ALLOWLIST?.trim();
  if (!raw) return undefined;

  const prefixes = raw
    .split(",")
    .map((s) => normalizePath(s.trim()))
    .filter(Boolean);

  const ok = prefixes.some(
    (prefix) =>
      normalizedPath === prefix ||
      normalizedPath.startsWith(`${prefix}/`) ||
      normalizedPath.startsWith(`${prefix}?`),
  );
  if (ok) return undefined;

  return `Path "${normalizedPath}" is not allowed by LURNA_PATH_ALLOWLIST (allowed prefixes: ${prefixes.join(", ")}).`;
}

function buildQuery(search: Record<string, string>): string {
  const q = new URLSearchParams(search);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type LurnaRequestResult =
  | { ok: true; status: number; bodyText: string; contentType: string | null }
  | { ok: false; status?: number; error: string };

export async function lurnaBackendRequest(options: {
  method: string;
  path: string;
  query?: Record<string, string>;
  /** Serialized as JSON when present (skipped for GET/HEAD). */
  jsonBody?: unknown;
}): Promise<LurnaRequestResult> {
  const pathNorm = normalizePath(options.path);
  const denied = assertPathAllowed(pathNorm);
  if (denied) return { ok: false, error: denied };

  let upstreamAuth: Record<string, string>;
  try {
    upstreamAuth = await resolveLurnaUpstreamAuthHeaders();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  const base = getBaseUrl();
  const queryStr = options.query ? buildQuery(options.query) : "";
  const url = `${base}${pathNorm}${queryStr}`;

  const method = options.method.toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...upstreamAuth,
  };

  let body: BodyInit | undefined;
  if (
    jsonBodyProvided(options.jsonBody) &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.jsonBody);
  }

  try {
    const res = await fetch(url, { method, headers, body });
    const contentType = res.headers.get("content-type");
    const bodyText = await res.text();

    return {
      ok: true,
      status: res.status,
      bodyText:
        bodyText.length > 150_000
          ? `${bodyText.slice(0, 148_000)}\n…[truncated ${bodyText.length - 148_000} chars]`
          : bodyText,
      contentType,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Request to ${url} failed: ${msg}` };
  }
}

function jsonBodyProvided(body: unknown): boolean {
  return body !== undefined && body !== null;
}

/** Study set generator route (defaults to `/generate-study-set`; override env `LURNA_PATH_FLASHCARDS`). */
export function lurnaPathFlashcards(): string {
  return normalizePath(
    process.env.LURNA_PATH_FLASHCARDS?.trim() || "/generate-study-set",
  );
}

/** Quiz generator route (defaults to `/generate-quiz-from-flashcards-streaming`; override env `LURNA_PATH_QUIZZES`). */
export function lurnaPathQuizzes(): string {
  return normalizePath(
    process.env.LURNA_PATH_QUIZZES?.trim() ||
      "/generate-quiz-from-flashcards-streaming",
  );
}
