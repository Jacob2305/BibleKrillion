/** Small helpers for Web-standard (Request → Response) Vercel functions. */
import type { ApiErrorBody } from "../lib/game/api-types.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Parse a small JSON object body; anything else is a 400. */
export async function readJsonBody(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new HttpError(400, "Body must be a JSON object.");
  return data as Record<string, unknown>;
}

/** Wrap a handler so thrown HttpErrors become JSON errors and anything else a logged 500. */
export function withErrors(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code } satisfies ApiErrorBody, err.status);
      console.error("[api] unhandled error", err);
      return json({ error: "Something went wrong on the server." } satisfies ApiErrorBody, 500);
    }
  };
}
