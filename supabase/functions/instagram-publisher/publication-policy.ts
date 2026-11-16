export type GraphDetails = {
  code: number | null;
  subcode: number | null;
  http_status: number;
  transient: boolean;
  trace_id: string | null;
  message: string;
  stage: "publish" | "create_media" | "quota" | "read";
};
const integer = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : null;

export class GraphFailure extends Error {
  readonly details: GraphDetails;
  constructor(status: number, error: Record<string, unknown>, token: string, path: string) {
    const code = integer(error.code);
    super(`meta_${code !== null && code > 0 ? code : status}`);
    let message = typeof error.message === "string" ? error.message : "";
    if (token) message = message.split(token).join("[redacted]");
    message = message.replace(/https?:\/\/[^\s"<>]+/gi, "[url]")
      .replace(/(?:access_token|authorization)\s*[=:]\s*\S+/gi, "[redacted]")
      .replace(/[\r\n\t]/g, " ").slice(0, 500);
    this.details = {
      code, subcode: integer(error.error_subcode), http_status: status,
      transient: error.is_transient === true || code === -1,
      trace_id: typeof error.fbtrace_id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(error.fbtrace_id) ? error.fbtrace_id : null,
      message,
      stage: path.endsWith("/media_publish") ? "publish" : path.endsWith("/media") ? "create_media" : path.endsWith("/content_publishing_limit") ? "quota" : "read",
    };
  }
}

const retryable = new Set(["network_error", "database_error", "meta_500", "meta_502", "meta_503", "meta_504", "meta_1", "meta_2", "meta_4", "meta_17", "meta_32", "meta_613", "meta_429"]);
export function canRetryBeforePublication(error: unknown, code: string, publishStarted: boolean) {
  // Never infer that a failed response means media_publish was not accepted.
  // Safe retries before that boundary do not permanently discard media after 30 calls.
  return !publishStarted && (retryable.has(code) || error instanceof GraphFailure && error.details.transient);
}

/** Use the provider's returned quota instead of hardcoding a daily allowance. */
export function quotaExhausted(report: { data?: { quota_usage?: number; config?: { quota_total?: number } }[] }) {
  const quota = report.data?.[0];
  return Number.isFinite(quota?.quota_usage) && Number.isFinite(quota?.config?.quota_total) &&
    quota!.config!.quota_total! > 0 && quota!.quota_usage! >= quota!.config!.quota_total!;
}
