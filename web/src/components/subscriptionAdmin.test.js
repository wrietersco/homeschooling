import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SubscriptionAdmin from "./SubscriptionAdmin.vue";
import UserAccountsAdmin from "./UserAccountsAdmin.vue";
import * as admin from "@/services/admin";
vi.mock("@/services/admin", () => ({ getSubscriptionAdmin: vi.fn(), setPricingPlans: vi.fn(), setFamilySubscription: vi.fn(), reviewPlanRequest: vi.fn(), listPlatformUsers: vi.fn(), listFamilies: vi.fn(), createPlatformUser: vi.fn(), updatePlatformUser: vi.fn(), setPlatformUserSuspended: vi.fn(), setPlatformUserPassword: vi.fn(), getPlatformPasswordResetLink: vi.fn(), setMemberRole: vi.fn() }));
const plan = (name, price, days) => ({ name, price, durationDays: days, currency: "PKR", limits: { activities: 10, text: 25, image: 5, tts: 15, liveMinutes: 10 }, daily: { activities: 10, text: 25, image: 5, tts: 15, liveMinutes: 10 }, sessionMinutes: 5, maxOutputTokens: 8192, thinkingBudget: 512 });
const click = async (wrapper, text) => { await wrapper.findAll("button").find((b) => b.text() === text).trigger("click"); await flushPromises(); };
beforeEach(() => {
  vi.resetAllMocks();
  admin.getSubscriptionAdmin.mockResolvedValue({ plans: { trial: plan("Trial", 1500, 1), basic: plan("Basic", 4500, 30), premium: plan("Premium", 15000, 30) }, families: [{ familyId: "f", name: "Family", subscription: { planId: "basic", status: "active", effectiveStatus: "active", startsAt: Date.now() - 60000, endsAt: Date.now() + 86400000, agreedPrice: 4500, paymentStatus: "paid" }, usage: { text: 7 } }] });
  admin.listPlatformUsers.mockResolvedValue({ users: [{ uid: "u", email: "u@example.com", displayName: "Parent", familyId: "f", role: "parent", disabled: false }], nextPageToken: null });
  admin.listFamilies.mockResolvedValue({ families: [{ id: "f", name: "Family" }] });
});
describe("manual subscriptions", () => {
  it("requires payment confirmation before approval and retains failed reviews", async () => {
    const base = await admin.getSubscriptionAdmin();
    admin.getSubscriptionAdmin.mockResolvedValue({ ...base, requests: [{ id: "r", familyName: "Family", planName: "Premium", currency: "PKR", price: 15000, durationDays: 30, emailStatus: "QUEUED" }] });
    admin.reviewPlanRequest.mockRejectedValue(new Error("Payment could not be confirmed"));
    const w = mount(SubscriptionAdmin); await flushPromises(); await click(w, "Review request");
    expect(w.findAll("button").find((b) => b.text() === "Approve and activate").element.disabled).toBe(true);
    await w.find('input[type="checkbox"]').setValue(true); await click(w, "Approve and activate");
    expect(admin.reviewPlanRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r", decision: "approve", paymentConfirmed: true }));
    expect(w.find(".request-review").exists()).toBe(true);
    expect(w.find('[role="alert"]').text()).toContain("could not be confirmed");
  });
  it("saves editable prices and quotas while keeping an existing agreed subscription price", async () => {
    const w = mount(SubscriptionAdmin); await flushPromises();
    await w.findAll('input[type="number"]')[0].setValue("2000");
    await w.find('input[aria-label="Trial Prepared learning activities period limit"]').setValue("12");
    await w.find("form").trigger("submit"); await flushPromises();
    expect(admin.setPricingPlans.mock.calls[0][0].trial.price).toBe(2000);
    expect(admin.setPricingPlans.mock.calls[0][0].trial.limits.activities).toBe(12);
    await click(w, "Manage");
    expect(w.find(".editor input[type=number]").element.value).toBe("4500");
    expect(w.text()).toContain("7 / 25");
  });
  it("keeps the subscription editor open and displays rejected activation", async () => {
    admin.setFamilySubscription.mockRejectedValue(new Error("Invalid subscription date"));
    const w = mount(SubscriptionAdmin); await flushPromises(); await click(w, "Manage");
    await w.find(".editor").trigger("submit"); await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("Invalid subscription date");
    expect(w.find(".editor").exists()).toBe(true);
  });
  it("preserves exact activation timestamps so editing status does not reset quota usage", async () => {
    const w = mount(SubscriptionAdmin); await flushPromises();
    const original = (await admin.getSubscriptionAdmin.mock.results[0].value).families[0].subscription;
    await click(w, "Manage"); await w.find(".editor").trigger("submit"); await flushPromises();
    expect(admin.setFamilySubscription.mock.calls[0][0].startsAt).toBe(original.startsAt);
    expect(admin.setFamilySubscription.mock.calls[0][0].endsAt).toBe(original.endsAt);
  });
});
describe("account controls", () => {
  it("generates a reset link for manual sharing without updating the account password", async () => {
    admin.getPlatformPasswordResetLink.mockResolvedValue({ link: "https://example.test/reset?oobCode=private" });
    const w = mount(UserAccountsAdmin); await flushPromises(); await click(w, "Modify"); await click(w, "Generate reset link");
    expect(admin.getPlatformPasswordResetLink).toHaveBeenCalledWith("u");
    expect(admin.setPlatformUserPassword).not.toHaveBeenCalled();
    expect(w.find("input[readonly]").element.value).toContain("oobCode=private");
    expect(w.text()).toContain("no email has been sent");
  });
  it("clears specified passwords after submission and does not claim success on suspension failure", async () => {
    const w = mount(UserAccountsAdmin); await flushPromises(); await click(w, "Modify");
    await w.find('input[type="password"]').setValue("new-secret-123");
    await click(w, "Set password");
    expect(admin.setPlatformUserPassword).toHaveBeenCalledWith("u", "new-secret-123");
    expect(w.find('input[type="password"]').element.value).toBe("");
    admin.setPlatformUserSuspended.mockRejectedValue(new Error("Account cannot be suspended"));
    await click(w, "Suspend");
    expect(w.find('[role="alert"]').text()).toContain("cannot be suspended");
  });
});
