import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";

// AppNav only reads user / hasFamily / isSuperAdmin / logout off the store, so
// a plain object stub avoids dragging Firebase Auth into the test.
const authState = vi.hoisted(() => ({
  user: null,
  hasFamily: false,
  isSuperAdmin: false,
  logout: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));

import AppNav from "./AppNav.vue";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div>home</div>" } },
      { path: "/dashboard", component: { template: "<div>dashboard</div>" } },
      { path: "/explore", component: { template: "<div>explore</div>" } },
      { path: "/wikido", component: { template: "<div>wikido</div>" } },
      { path: "/phonics", component: { template: "<div>phonics</div>" } },
    ],
  });
}

async function mountNav() {
  const router = makeRouter();
  await router.push("/");
  await router.isReady();
  // attachTo connects the tree to the document so events bubble up to the
  // document-level listeners (outside click / Escape) like they do in the app.
  const wrapper = mount(AppNav, { global: { plugins: [router] }, attachTo: document.body });
  activeWrapper = wrapper;
  return { wrapper, router };
}

beforeEach(() => {
  authState.user = null;
  authState.hasFamily = false;
  authState.isSuperAdmin = false;
});

afterEach(() => {
  // Detach the mounted tree so document-level listeners don't leak across tests.
  if (activeWrapper) activeWrapper.unmount();
  activeWrapper = null;
});

let activeWrapper = null;

describe("AppNav GAMES menu", () => {
  it("hides the Games menu when signed out", async () => {
    const { wrapper } = await mountNav();
    expect(wrapper.find(".games-menu").exists()).toBe(false);
  });

  it("shows a Games toggle that reveals the game hierarchy submenu links", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper } = await mountNav();

    const toggle = wrapper.find(".games-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-controls")).toBe("games-submenu");
    expect(wrapper.find(".games-dropdown").exists()).toBe(false);

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const items = wrapper.findAll(".games-dropdown .nav-link");
    expect(items).toHaveLength(6);
    expect(items[0].attributes("href")).toBe("/games");
    expect(items[0].text()).toContain("All Games");
    expect(items[1].attributes("href")).toBe("/explore");
    expect(items[1].text()).toContain("Explore");
    expect(items[2].attributes("href")).toBe("/wikido");
    expect(items[2].text()).toContain("Wikido");
    expect(items[3].attributes("href")).toBe("/phonics");
    expect(items[3].text()).toContain("Phonics");
    // Math Games is a static page under /games/math/ (not a Vue route), so it is an
    // ordinary anchor that carries the app context for the return pill.
    expect(items[4].attributes("href")).toBe("/games/math/index.html?from=/games");
    expect(items[4].text()).toContain("Math Games");
    // Division Playland is nested under Math Games, mirroring the page hierarchy.
    expect(items[5].attributes("href")).toBe("/games/math/division.html");
    expect(items[5].text()).toContain("Division Playland");
    // The submenu entries must stay ORDINARY LINKS. role="menuitem" hid them
    // from every link-role query (and promised menu keyboard behaviour we don't
    // implement) — a real browser then couldn't find "Phonics" by link role.
    expect(wrapper.find(".games-dropdown").attributes("id")).toBe("games-submenu");
    expect(wrapper.find(".games-dropdown").attributes("role")).toBeUndefined();
    for (const item of items) expect(item.attributes("role")).toBeUndefined();
  });

  it("closes the menu after navigating via a submenu link", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper, router } = await mountNav();

    await wrapper.find(".games-toggle").trigger("click");
    await wrapper.findAll(".games-dropdown .nav-link")[3].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/phonics");
    expect(wrapper.find(".games-dropdown").exists()).toBe(false);
  });

  it("closes the menu on Escape and on an outside click", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper } = await mountNav();

    const toggle = wrapper.find(".games-toggle");
    await toggle.trigger("click");
    expect(wrapper.find(".games-dropdown").exists()).toBe(true);

    await toggle.trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".games-dropdown").exists()).toBe(false);

    await toggle.trigger("click");
    // Clicking the Home link (outside the menu) should also close it.
    await wrapper.find('a[href="/"]').trigger("click");
    expect(wrapper.find(".games-dropdown").exists()).toBe(false);
  });

  it("highlights the Games toggle while a game route is active", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper, router } = await mountNav();

    const toggle = wrapper.find(".games-toggle");
    expect(toggle.classes()).not.toContain("router-link-active");

    await router.push("/explore");
    await router.isReady();
    expect(toggle.classes()).toContain("router-link-active");

    await router.push("/wikido");
    await flushPromises();
    expect(toggle.classes()).toContain("router-link-active");
  });
});

// The mobile hamburger only swaps the layout via CSS; what's testable in
// jsdom is the toggle contract: aria state, the .menu-open class on .links,
// and the same close triggers as the Games menu.
describe("AppNav mobile menu", () => {
  it("toggles aria-expanded and the .menu-open class on .links", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper } = await mountNav();

    const toggle = wrapper.find(".menu-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-controls")).toBe("main-nav-links");
    expect(wrapper.find(".links").classes()).not.toContain("menu-open");

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-label")).toBe("Close menu");
    expect(wrapper.find(".links").classes()).toContain("menu-open");

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".links").classes()).not.toContain("menu-open");
  });

  it("closes the sheet on Escape and on an outside click", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper } = await mountNav();

    await wrapper.find(".menu-toggle").trigger("click");
    expect(wrapper.find(".links").classes()).toContain("menu-open");

    await wrapper.find(".menu-toggle").trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".links").classes()).not.toContain("menu-open");

    await wrapper.find(".menu-toggle").trigger("click");
    await document.body.click();
    expect(wrapper.find(".links").classes()).not.toContain("menu-open");
  });

  it("closes the sheet after navigating via a link", async () => {
    authState.user = { uid: "u1" };
    authState.hasFamily = true;
    const { wrapper, router } = await mountNav();

    await wrapper.find(".menu-toggle").trigger("click");
    // A top-level link (not the Games submenu, which is closed here).
    await wrapper.find('.links a[href="/dashboard"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/dashboard");
    expect(wrapper.find(".links").classes()).not.toContain("menu-open");
  });
});
