export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  field?: string;
  body: unknown;

  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.error === "string" ? body.error : "request_failed";
    super(code);
    this.status = status;
    this.code = code;
    this.detail = typeof body.detail === "string" ? body.detail : undefined;
    this.field = typeof body.field === "string" ? body.field : undefined;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

let csrfToken: string | null = null;
let demoReadonly = false;
export function configureSession(token: string | null, demo: boolean) { csrfToken = token; demoReadonly = demo; }
export function clearSession() { csrfToken = null; demoReadonly = false; }

async function send<T>(method: string, path: string, init: RequestInit): Promise<T> {
  const changing = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (changing && demoReadonly && path !== "/auth/logout" && path !== "/auth/demo") {
    throw new ApiError(403, { error: "demo_readonly", detail: "Sign in to do this" });
  }
  const headers = new Headers(init.headers);
  if (changing && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  let res: Response;
  try {
    res = await fetch(path, { method, ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, { error: "network_error", detail: "Could not reach the server" });
  }
  if (res.status === 401 && path !== "/auth/session") {
    clearSession();
    document.documentElement.style.visibility = "hidden";
    window.location.replace("/login");
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const error = new ApiError(res.status, (body as Record<string, unknown>) ?? {});
    console.warn("Request failed", { method, status: error.status, code: error.code });
    throw error;
  }
  return body as T;
}

const json = { "Content-Type": "application/json" };

export function get<T>(path: string, query?: Query): Promise<T> {
  return send<T>("GET", withQuery(path, query), {});
}

export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return send<T>("POST", path, { headers: json, body: JSON.stringify(body) });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return send<T>("PUT", path, { headers: json, body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return send<T>("PATCH", path, { headers: json, body: JSON.stringify(body) });
}

export function postForm<T>(path: string, form: FormData, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return send<T>("POST", path, { headers, body: form });
}
