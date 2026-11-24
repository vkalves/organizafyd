export type HealthState =
  | "unknown"
  | "healthy"
  | "reconnect"
  | "permissions"
  | "unavailable"
  | "temporary";
export function classify(
  code?: number,
  httpStatus = 200,
  isTransient = false,
): HealthState {
  if (
    isTransient || httpStatus === 429 || httpStatus >= 500 ||
    [1, 2, 4, 17, 32, 613].includes(code ?? 0)
  ) return "temporary";
  if (code === 190 || code === 102) return "reconnect";
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    return "permissions";
  }
  if (code === 100 || code === 803) return "unavailable";
  // An undocumented error is not evidence that a profile is inaccessible.
  return "temporary";
}
export function transition(
  previous: { state: HealthState; candidate: HealthState; failures: number },
  result: HealthState,
) {
  const failures = result === "healthy"
    ? 0
    : previous.candidate === result
    ? Math.min(previous.failures + 1, 1000)
    : 1;
  const threshold = result === "temporary"
    ? 3
    : result === "unavailable"
    ? 2
    : 1;
  return {
    state: failures >= threshold || result === "healthy"
      ? result
      : previous.state,
    candidate: result,
    failures,
  };
}
