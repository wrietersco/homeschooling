import { describe, it, expect, vi, beforeEach } from "vitest";
import { useActivityLink } from "./useActivityLink";

describe("useActivityLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("builds the per-activity page URL from the current origin", () => {
    const { activityUrl } = useActivityLink();
    expect(activityUrl("abc123")).toBe(`${window.location.origin}/activity/abc123`);
  });

  it("copies the shareable link and flags the copied id transiently", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { copiedId, copyActivityLink } = useActivityLink();
    await copyActivityLink("abc123");

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activity/abc123`);
    expect(copiedId.value).toBe("abc123");

    vi.advanceTimersByTime(2000);
    expect(copiedId.value).toBe("");
  });

  it("is a no-op when no id is provided", async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { copiedId, copyActivityLink } = useActivityLink();
    await copyActivityLink("");

    expect(writeText).not.toHaveBeenCalled();
    expect(copiedId.value).toBe("");
  });

  it("does not throw when the clipboard is blocked", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { copiedId, copyActivityLink } = useActivityLink();
    await copyActivityLink("abc123");

    expect(copiedId.value).toBe("");
  });
});
