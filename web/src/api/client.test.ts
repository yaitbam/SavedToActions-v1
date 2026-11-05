import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearSession, configureSession, del, get, post, withQuery } from "./client";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("withQuery", () => {
  it("adds only the values that are set", () => {
    expect(withQuery("/api/saves", { limit: 20, status: "", offset: 0, q: undefined, mine: false })).toBe("/api/saves?limit=20&offset=0&mine=false");
    expect(withQuery("/api/saves", {})).toBe("/api/saves");
    expect(withQuery("/api/saves")).toBe("/api/saves");
  });
});

describe("api client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it("sends the CSRF token on writes and not on reads", async () => {
    configureSession("csrf-1", false);
    fetchMock.mockImplementation(async () => reply(200, { ok: true }));
    await post("/api/actions/1/done");
    await get("/api/home");
    const [, write] = fetchMock.mock.calls[0];
    const [, read] = fetchMock.mock.calls[1];
    expect(new Headers(write.headers).get("X-CSRF-Token")).toBe("csrf-1");
    expect(new Headers(read.headers).get("X-CSRF-Token")).toBeNull();
    expect(write.credentials).toBe("same-origin");
  });

  it("blocks writes in a demo session before they reach the network, but still allows reads and sign out", async () => {
    configureSession("csrf-demo", true);
    fetchMock.mockImplementation(async () => reply(200, { ok: true }));
    await expect(post("/api/actions/1/propose")).rejects.toMatchObject({ status: 403, code: "demo_readonly" });
    await expect(del("/api/saves/1")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
    await get("/api/saves");
    await post("/auth/logout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns an error response into an ApiError with its code and detail", async () => {
    fetchMock.mockImplementation(async () => reply(409, { error: "slot_no_longer_available", detail: "taken", alternative: { found: true } }));
    const error = (await post("/api/actions/1/approve", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "slot_no_longer_available", detail: "taken" });
    expect((error.body as { alternative: unknown }).alternative).toEqual({ found: true });
  });

  it("reports a network failure with a code the interface can translate", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(get("/api/home")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});
