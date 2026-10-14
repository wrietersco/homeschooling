// Tests for the dev-server bridge launcher — fake spawn + fake connect
// handlers, no real processes or servers.
import { describe, it, expect, vi } from "vitest";
import { wikidoBridgeLauncher } from "./wikido-bridge-launcher.mjs";

// Run the plugin's configureServer against a fake middleware stack and return
// a connect-style handler invoker.
function mount(plugin) {
  let handler = null;
  let nextCalled = false;
  plugin.configureServer({
    middlewares: { use: (_path, fn) => { handler = fn; } },
  });
  return {
    call: async (method, url) => {
      nextCalled = false;
      const res = {
        headers: {},
        body: null,
        setHeader(k, v) { this.headers[k] = v; },
        end(b) { this.body = b; },
      };
      handler({ method, url }, res, () => { nextCalled = true; });
      return { res: res.body ? { ...res, json: JSON.parse(res.body) } : res, nextCalled };
    },
  };
}

// A ChildProcess look-alike whose stdout/stderr handlers and exit callback the
// test drives by hand.
function fakeSpawn() {
  const calls = [];
  const procs = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const outs = {};
    const p = {
      pid: 4200 + procs.length,
      stdout: { on: (ev, cb) => { outs[`out:${ev}`] = cb; } },
      stderr: { on: (ev, cb) => { outs[`err:${ev}`] = cb; } },
      cbs: {},
      on: (ev, cb) => { p.cbs[ev] = cb; },
      unref: () => { p.unreffed = true; },
    };
    p.emitOut = (chunk) => outs["out:data"]?.(chunk);
    p.emitErr = (chunk) => outs["err:data"]?.(chunk);
    p.emitExit = (code, signal) => p.cbs.exit?.(code, signal);
    procs.push(p);
    return p;
  };
  return { spawnImpl, calls, procs };
}

describe("wikido bridge launcher (dev server)", () => {
  it("start spawns the bridge exactly like npm run wikido:bridge and reports the process", async () => {
    const { spawnImpl, calls, procs } = fakeSpawn();
    const api = mount(wikidoBridgeLauncher({ spawnImpl, log: vi.fn() }));
    const { res } = await api.call("POST", "/start");
    const body = res.json;
    expect(body).toMatchObject({ ok: true, alive: true, pid: 4200 });
    expect(body.already).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe(process.execPath); // node …, no shell wrapper
    expect(calls[0].args[0]).toMatch(/wikido-audio-bridge\.mjs$/);
    expect(procs[0].unreffed).toBe(true); // the bridge outlives the dev server

    // a second start never spawns a second process
    const again = (await api.call("POST", "/start")).res.json;
    expect(again).toMatchObject({ ok: true, already: true, pid: 4200, alive: true });
    expect(calls).toHaveLength(1);
  });

  it("status tells the truth: the bridge's own lines while alive, the exit code after death", async () => {
    const { spawnImpl, procs } = fakeSpawn();
    const api = mount(wikidoBridgeLauncher({ spawnImpl }));
    await api.call("POST", "/start");
    procs[0].emitOut("Kokoro ready on http://localhost:8787");
    procs[0].emitErr("warning: onnx runtime");

    let body = (await api.call("GET", "/status")).res.json;
    expect(body).toMatchObject({ ok: true, alive: true, pid: 4200 });
    expect(body.output).toContain("Kokoro ready on http://localhost:8787");
    expect(body.output).toContain("warning: onnx runtime");

    procs[0].emitExit(1, null);
    body = (await api.call("GET", "/status")).res.json;
    expect(body.alive).toBe(false);
    expect(body.exit).toMatchObject({ code: 1 });
    expect(body.output).toContain("Kokoro ready on http://localhost:8787"); // kept for diagnosis
  });

  it("a fresh start after an exit spawns a new process and clears the old state", async () => {
    const { spawnImpl, calls, procs } = fakeSpawn();
    const api = mount(wikidoBridgeLauncher({ spawnImpl }));
    await api.call("POST", "/start");
    procs[0].emitExit(0, null);
    const body = (await api.call("POST", "/start")).res.json;
    expect(body.already).toBeUndefined();
    expect(body.alive).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("refuses to start when the bridge script is missing, saying so plainly", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const api = mount(wikidoBridgeLauncher({ spawnImpl, script: "Z:/no/such/path.mjs" }));
    const body = (await api.call("POST", "/start")).res.json;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not found");
    expect(calls).toHaveLength(0);
  });

  it("unknown paths fall through to the dev server", async () => {
    const { spawnImpl } = fakeSpawn();
    const api = mount(wikidoBridgeLauncher({ spawnImpl }));
    expect((await api.call("GET", "/elsewhere")).nextCalled).toBe(true);
    expect((await api.call("PUT", "/start")).nextCalled).toBe(true);
  });
});
