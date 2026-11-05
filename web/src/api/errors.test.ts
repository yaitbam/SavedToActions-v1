import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { errorText } from "./errors";

describe("errorText", () => {
  it("uses the approved message for a known code", () => {
    expect(errorText(new ApiError(403, { error: "demo_readonly" }))).toBe("Sign in to do this");
    expect(errorText(new ApiError(429, { error: "daily_limit_reached" }))).toBe("No free credits left today. They reset at 00:00");
  });

  it("never shows a raw code, detail or stack for an unknown error", () => {
    const unknown = new ApiError(500, { error: "sqlite_busy", detail: "SQLITE_BUSY at db.js:42" });
    expect(errorText(unknown)).toBe("Something went wrong. Please try again");
    expect(errorText(new Error("boom"))).toBe("Something went wrong. Please try again");
    expect(errorText(null)).toBe("Something went wrong. Please try again");
  });

  it("accepts a custom fallback", () => {
    expect(errorText(new Error("x"), "Could not sign out. Try again")).toBe("Could not sign out. Try again");
  });
});
