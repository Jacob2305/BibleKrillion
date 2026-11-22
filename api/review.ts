/** POST /api/review  { action: "list" | "review", pin, ... } — host review of AI-judged answers. */
import { createReviewHandler } from "../server/review.js";

const handler = createReviewHandler();

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
