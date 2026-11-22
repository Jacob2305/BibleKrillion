import type {
  AnswerResponse,
  ApiErrorBody,
  DailyFinishResponse,
  DiveStartResponse,
  PromptBeginResponse,
  RevealResponse,
} from "../../lib/game/api-types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection.", 0, "network");
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok || data === null) {
    throw new ApiError(data?.error ?? `The server had a problem (${res.status}).`, res.status, data?.code);
  }
  return data;
}

/** The calls a dive needs; Practice and Daily each provide one. */
export interface DiveApi {
  start(): Promise<DiveStartResponse>;
  begin(dive: string, index: number): Promise<PromptBeginResponse>;
  /** `confirm`: yes, I meant the suggested spelling. */
  answer(promptToken: string, text: string, confirm?: boolean): Promise<AnswerResponse>;
  reveal(promptToken: string): Promise<RevealResponse>;
}

export const practiceApi: DiveApi = {
  start: () => post("/api/practice", { action: "start" }),
  begin: (dive, index) => post("/api/practice", { action: "begin", dive, index }),
  answer: (promptToken, text, confirm) => post("/api/practice", { action: "answer", promptToken, text, confirm }),
  reveal: (promptToken) => post("/api/practice", { action: "reveal", promptToken }),
};

/** Daily Dive calls for this device + nickname. `onStart` sees each start response (to remember the dive). */
export function createDailyApi(opts: { deviceId: string; nickname: string; onStart?: (res: DiveStartResponse) => void }): DiveApi {
  return {
    start: async () => {
      const res = await post<DiveStartResponse>("/api/daily", { action: "start", deviceId: opts.deviceId, nickname: opts.nickname });
      opts.onStart?.(res);
      return res;
    },
    begin: (dive, index) => post("/api/daily", { action: "begin", dive, index }),
    answer: (promptToken, text, confirm) => post("/api/daily", { action: "answer", promptToken, text, confirm }),
    reveal: (promptToken) => post("/api/daily", { action: "reveal", promptToken }),
  };
}

export const finishDaily = (dive: string) => post<DailyFinishResponse>("/api/daily", { action: "finish", dive });
