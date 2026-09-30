export function requestBodyLimit() {
  const limit = Number(process.env.AP_REQUEST_BODY_LIMIT_BYTES ?? 1_048_576);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("AP_REQUEST_BODY_LIMIT_BYTES must be a positive integer");
  }
  return limit;
}
