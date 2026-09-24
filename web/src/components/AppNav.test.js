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
      { path: "/explore", component: { template: "<div>explore</div>" } },
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

  it("shows a Games toggle that reveals Explore + Phonics submenu links", async () => {
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
    expect(items).toHaveLength(2);
    expect(items[0].attributes("href")).toBe("/explore");
    expect(items[0].text()).toContain("Explore");
    expect(items[1].attributes("href")).toBe("/phonics");
    expect(items[1].text()).toContain("Phonics");
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
    await wrapper.findAll(".games-dropdown .nav-link")[1].trigger("click");
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
  });
});
