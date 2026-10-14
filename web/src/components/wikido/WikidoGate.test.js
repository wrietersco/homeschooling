import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// The gate only calls register / login / loginWithGoogle off the store, so a
// plain object stub avoids dragging Firebase Auth into the test. Resolution of
// "who is signed in" (the gate → shelf flip) is WikidoView's job and is covered
// by the router test + the e2e specs.
const auth = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => auth,
}));

import WikidoGate from "./WikidoGate.vue";

let wrapper;

function mountGate() {
  wrapper = mount(WikidoGate);
  return wrapper;
}

const emailInput = () => wrapper.find('input[type="email"]');
const passwordInput = () => wrapper.find('input[type="password"]');

beforeEach(() => {
  vi.clearAllMocks();
  wrapper?.unmount();
  wrapper = null;
});

describe("WikidoGate", () => {
  it("opens in sign-in mode: email + password, Google, and a link to register", async () => {
    await mountGate();
    expect(wrapper.find('input[type="text"]').exists()).toBe(false); // no name field yet
    expect(emailInput().exists()).toBe(true);
    expect(passwordInput().attributes("minlength")).toBe("6");
    expect(wrapper.find(".wd-gate-primary").text()).toContain("Sign in & explore");
    expect(wrapper.find(".wd-gate-google").text()).toContain("Continue with Google");
  });

  it("signs in with the entered credentials and promises the shelf next", async () => {
    await mountGate();
    await emailInput().setValue("  kid@example.com ");
    await passwordInput().setValue("secret123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(auth.login).toHaveBeenCalledWith("kid@example.com", "secret123");
    expect(auth.register).not.toHaveBeenCalled();
    expect(wrapper.find(".wd-gate-error").exists()).toBe(false);
  });

  it("registers with a display name so onboarding can carry it into the family", async () => {
    await mountGate();
    await wrapper.find(".wd-gate-link").trigger("click"); // switch to register
    expect(wrapper.find(".wd-gate-primary").text()).toContain("Create account & explore");
    await wrapper.find('input[type="text"]').setValue("Fatima");
    await emailInput().setValue("fatima@example.com");
    await passwordInput().setValue("secret123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(auth.register).toHaveBeenCalledWith("fatima@example.com", "secret123", "Fatima");
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("translates auth failures into friendly copy", async () => {
    await mountGate();
    auth.login.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "auth/invalid-credential" }));
    await emailInput().setValue("kid@example.com");
    await passwordInput().setValue("wrong-pass");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".wd-gate-error").text()).toContain("Incorrect email or password.");

    auth.login.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "auth/email-already-in-use" }));
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".wd-gate-error").text()).toContain("already registered");

    auth.login.mockRejectedValueOnce(new Error("network down"));
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".wd-gate-error").text()).toContain("network down");
  });

  it("clears the error when switching modes and stays silent after a fix", async () => {
    await mountGate();
    auth.login.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "auth/invalid-credential" }));
    await emailInput().setValue("kid@example.com");
    await passwordInput().setValue("wrong-pass");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".wd-gate-error").exists()).toBe(true);

    await wrapper.find(".wd-gate-link").trigger("click");
    expect(wrapper.find(".wd-gate-error").exists()).toBe(false);
  });

  it("goes through Google and explains a cancelled popup", async () => {
    await mountGate();
    await wrapper.find(".wd-gate-google").trigger("click");
    await flushPromises();
    expect(auth.loginWithGoogle).toHaveBeenCalledTimes(1);

    auth.loginWithGoogle.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "auth/popup-closed" }));
    await wrapper.find(".wd-gate-google").trigger("click");
    await flushPromises();
    expect(wrapper.find(".wd-gate-error").text()).toContain("Google sign-in was cancelled.");
  });

  it("disables both buttons while a sign-in attempt is in flight", async () => {
    await mountGate();
    let settle;
    auth.login.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    await emailInput().setValue("kid@example.com");
    await passwordInput().setValue("secret123");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.find(".wd-gate-primary").text()).toContain("Please wait");
    expect(wrapper.find(".wd-gate-primary").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".wd-gate-google").attributes("disabled")).toBeDefined();
    settle();
    await flushPromises();
    expect(wrapper.find(".wd-gate-primary").attributes("disabled")).toBeUndefined();
  });
});
