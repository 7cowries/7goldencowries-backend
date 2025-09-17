export function respond(res, options = {}) {
  const {
    status = 200,
    ok = true,
    code,
    message = "",
    error,
    payload,
  } = options;

  const resolvedCode = code || (ok ? "ok" : "error");
  const resolvedError = ok ? null : error || resolvedCode;
  const body = {
    ok,
    code: resolvedCode,
    message,
    error: resolvedError,
  };

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    Object.assign(body, payload);
  } else if (payload !== undefined) {
    body.payload = payload;
  }

  return res.status(status).json(body);
}

export function jsonOk(res, code, message, data = {}, opts = {}) {
  const { status, ...rest } = opts;
  const payload = { ...rest, ...data };
  return respond(res, { status, ok: true, code, message, payload });
}

export function jsonError(res, code, message, opts = {}) {
  const { status = 400, error, ...rest } = opts;
  const payload = { ...rest };
  return respond(res, { status, ok: false, code, message, error, payload });
}
