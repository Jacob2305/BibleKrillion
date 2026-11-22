/** POST /api/live  { action: "create" | "host" | "join" | "state" | "answer", ... } */
import { createLiveHandler } from "../server/live.js";

const handler = createLiveHandler();

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
