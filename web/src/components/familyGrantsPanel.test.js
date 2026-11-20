import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FamilyGrantsPanel from "./FamilyGrantsPanel.vue";
import * as admin from "@/services/admin";
vi.mock("@/services/admin", () => ({ getFamilyGrants: vi.fn(), setFamilyGrants: vi.fn() }));
const limits = { activities: 80, text: 800, image: 240, tts: 200, liveMinutes: 90 };
const daily = { activities: 80, text: 300, image: 100, tts: 40, liveMinutes: 30 };
beforeEach(() => {
  vi.resetAllMocks();
  admin.getFamilyGrants.mockResolvedValue({ familyId: "f", name: "Rabiya Family", subscription: { effectiveStatus: "active" }, plan: { id: "basic", name: "Basic", durationDays: 30, limits, daily }, used: { package: { tts: 12 }, today: { tts: 3 } }, grants: { liveMinutes: { package: 60 } }, note: "", history: [] });
  admin.setFamilyGrants.mockResolvedValue({ ok: true, grants: {} });
});
describe("quota grants", () => {
  it("adds extra TTS per day, unlimited live per day, and keeps existing grants", async () => {
    const w = mount(FamilyGrantsPanel, { props: { familyId: "f" } }); await flushPromises();
    const tts = w.findAll("article.kind")[0], live = w.findAll("article.kind")[1];
    const ttsDaily = tts.findAll(".scope")[0];
    await ttsDaily.findAll(".chip").find((c) => c.text() === "+50").trigger("click");
    expect(ttsDaily.find(".result").text()).toContain("90");
    await live.findAll(".scope")[0].findAll(".seg button").find((b) => b.text() === "Unlimited").trigger("click");
    expect(live.findAll(".scope")[1].find(".result").text()).toContain("150");
    await w.findAll("button").find((b) => b.text() === "Save grants").trigger("click"); await flushPromises();
    expect(admin.setFamilyGrants).toHaveBeenCalledWith("f", { tts: { daily: 50 }, liveMinutes: { daily: "unlimited", package: 60 } }, "");
  });
});
