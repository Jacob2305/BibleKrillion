/** POST /api/daily  { action: "start" | "begin" | "answer" | "reveal" | "finish", ... } */
import { createDailyHandler } from "../server/daily.js";

const handler = createDailyHandler();

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
