// Dev-server launcher for the Wikido voiceover bridge. A web page can never
// spawn local processes, but the Vite dev server runs on the same machine the
// superadmin curates from — so it hosts two tiny endpoints:
//
//   POST /__wikido-bridge/start   → spawn the bridge exactly like
//                                   `npm run wikido:bridge` would
//   GET  /__wikido-bridge/status  → the REAL process state: alive/pid, exit
//                                   code, and the bridge's own last lines
//
// Production hosting has no such endpoints (the studio degrades to the
// copy-paste instruction there). Dev-only: this plugin never touches the build.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE_SCRIPT = path.join(ROOT, "functions", "scripts", "wikido-audio-bridge.mjs");
const MAX_LINES = 40;

export function wikidoBridgeLauncher({ spawnImpl = spawn, script = BRIDGE_SCRIPT, log = () => {} } = {}) {
  let child = null;
  let exit = null;    // { code, signal, at } once the process has ended
  const output = [];  // the bridge's own last lines — the ground truth on failure

  const record = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      output.push(line);
      if (output.length > MAX_LINES) output.shift();
    }
  };
  const state = () => ({
    managed: child !== null,
    alive: child !== null && exit === null,
    pid: child?.pid ?? null,
    exit,
    output: [...output],
  });

  function start() {
    if (child && exit === null) return { ok: true, already: true, ...state() };
    if (!existsSync(script)) return { ok: false, error: `Bridge script not found: ${script}` };
    exit = null;
    output.length = 0;
    try {
      child = spawnImpl(process.execPath, [script], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      child = null;
      return { ok: false, error: String(e?.message || e) };
    }
    child.stdout?.on?.("data", record);
    child.stderr?.on?.("data", record);
    child.on("exit", (code, signal) => {
      exit = { code, signal, at: new Date().toISOString() };
      log(`[wikido-bridge] process exited (code ${code ?? signal})`);
    });
    child.unref(); // the bridge outlives the dev server
    log(`[wikido-bridge] spawned pid ${child.pid} — node ${path.relative(ROOT, script)}`);
    return { ok: true, ...state() };
  }

  return {
    name: "wikido-bridge-launcher",
    configureServer(server) {
      server.middlewares.use("/__wikido-bridge", (req, res, next) => {
        // always HTTP 200 — "no launcher here" is the HTML/404 case; real
        // errors travel in the body as { ok: false, error }
        const send = (body) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && req.url === "/start") return send(start());
        if (req.method === "GET" && req.url === "/status") return send({ ok: true, ...state() });
        next();
      });
    },
  };
}
