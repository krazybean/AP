export function requestBodyLimit() {
  const limit = Number(process.env.AP_REQUEST_BODY_LIMIT_BYTES ?? 1_048_576);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("AP_REQUEST_BODY_LIMIT_BYTES must be a positive integer");
  }
  return limit;
}

export function defaultExposureMode() {
  const mode = process.env.AP_DEFAULT_EXPOSURE ?? "path";
  if (mode !== "path" && mode !== "isolated-host") {
    throw new Error("AP_DEFAULT_EXPOSURE must be path or isolated-host");
  }
  return mode;
}
