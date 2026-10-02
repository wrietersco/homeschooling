import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SubscriptionView from "./SubscriptionView.vue";
import { getMySubscription, requestPlanChange } from "@/services/admin";
vi.mock("@/services/admin", () => ({ getMySubscription: vi.fn(), requestPlanChange: vi.fn() }));
const p = { name: "Basic", price: 4500, currency: "PKR", durationDays: 30, limits: {}, daily: {}, sessionMinutes: 10 };
describe("user package requests", () => {
  it("submits chosen tier without activating the package and disables duplicate requests", async () => {
    getMySubscription.mockResolvedValue({ plans: { basic: p }, subscription: { planId: "trial", effectiveStatus: "pending" }, usage: {} });
    requestPlanChange.mockResolvedValue({ request: { planId: "basic", planName: "Basic", price: 4500, currency: "PKR", status: "pending" } });
    const w = mount(SubscriptionView); await flushPromises();
    const button = w.findAll("button").find((b) => b.text() === "Request this package");
    await button.trigger("click"); await flushPromises();
    expect(requestPlanChange).toHaveBeenCalledWith("basic");
    expect(w.text()).toContain("Awaiting superadmin review");
    expect(button.element.disabled).toBe(true);
    expect(w.text()).toContain("package changes after approval");
  });
  it("shows submission failures without a pending request", async () => {
    getMySubscription.mockResolvedValue({ plans: { basic: p }, subscription: { planId: "trial", effectiveStatus: "pending" }, usage: {} });
    requestPlanChange.mockRejectedValue(new Error("Try tomorrow"));
    const w = mount(SubscriptionView); await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Request this package").trigger("click"); await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("Try tomorrow");
    expect(w.text()).not.toContain("Awaiting superadmin review");
  });
});
