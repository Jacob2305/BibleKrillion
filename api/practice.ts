/**
 * POST /api/practice  { action: "start" | "begin" | "answer" | "reveal", ... }
 *
 * One function per game mode (not per action) keeps us well under the Vercel
 * Hobby plan's function limit.
 */
import { createPracticeHandler } from "../server/practice.js";

const handler = createPracticeHandler();

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
