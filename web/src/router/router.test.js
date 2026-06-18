import { describe, it, expect } from "vitest";

// Phase 0 smoke test: the route table is well-formed and the public/auth
// flags that the navigation guard depends on are present and consistent.
import routerModule from "./index.js";

describe("router", () => {
  const routes = routerModule.options.routes;

  it("exposes the core named routes", () => {
    const names = routes.map((r) => r.name);
    for (const expected of ["home", "login", "dashboard", "curriculum", "syllabus", "planner", "activity", "platform", "invite", "child-player", "not-found"]) {
      expect(names).toContain(expected);
    }
  });

  it("marks login, invite, and the child player as public (no auth required)", () => {
    const login = routes.find((r) => r.name === "login");
    const child = routes.find((r) => r.name === "child-player");
    const invite = routes.find((r) => r.name === "invite");
    expect(login.meta.public).toBe(true);
    expect(child.meta.public).toBe(true);
    expect(invite.meta.public).toBe(true);
  });

  it("guards the platform route to superadmins", () => {
    const platform = routes.find((r) => r.name === "platform");
    expect(platform.meta.requiresAuth).toBe(true);
    expect(platform.meta.role).toBe("superadmin");
  });
});
