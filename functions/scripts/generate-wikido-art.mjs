// Wikido artwork pre-generation — the "developer environment" half of Wikido.
//
// Wikido scene images are NEVER generated at runtime: a developer runs this
// script, curates the results (re-run for any scene until it's right), and
// commits the chosen files. Usage:
//
//   cd functions
//   GEMINI_API_KEY=... node scripts/generate-wikido-art.mjs [--topic civilizations]
//                            [--scene bull-capitals] [--model gemini-3.1-flash-image]
//                            [--dry-run]
//
// For every scene the script:
//   1. composes `pack.artStyle + scene.artPrompt` (both live in the topic pack,
//      so prompts are curated and versioned next to the content they serve),
//   2. calls the Gemini image model on a 16:9 canvas,
//   3. writes web/public/wikido/<topicId>/<sceneId>.jpg, and
//   4. patches the pack's image src for that scene (.svg placeholder → .jpg).
//
// After generating, re-measure hotspot x/y against the new art (press H inside
// Wikido in dev to get a live percentage readout) and update the pack.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { wikidoTopicPacks } from "../../web/src/lib/wikido/index.js";

const args = process.argv.slice(2);
function argOf(name, fallback = "") {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const onlyTopic = argOf("--topic");
const onlyScene = argOf("--scene");
const model = argOf("--model", "gemini-3.1-flash-image");
const dryRun = args.includes("--dry-run");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(root, "web", "public", "wikido");

// Key: env first, then functions/.secret.local (the repo's local-secrets convention).
function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const secrets = readFileSync(path.join(root, "functions", ".secret.local"), "utf8");
    const line = secrets.split("\n").find((l) => l.startsWith("GEMINI_API_KEY="));
    if (line) return line.slice("GEMINI_API_KEY=".length).trim();
  } catch { /* no secrets file */ }
  return "";
}

async function generateImage({ apiKey, prompt }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    }),
  });
  if (!res.ok) {
    console.error(`  ✗ HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return null;
  }
  const json = await res.json();
  const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!part) {
    console.error("  ✗ model returned no image (prompt may have been blocked)");
    return null;
  }
  return Buffer.from(part.inlineData.data, "base64");
}

// Flip the scene's image src from the .svg placeholder to the generated .jpg.
// replaceAll also catches the shelf cover when it reuses the same artwork file
// (the root scene's image doubles as the topic cover).
function patchPackSrc(pack, sceneId) {
  const packFile = path.join(root, "web", "src", "lib", "wikido", "topics", `${pack.id}.js`);
  let text = readFileSync(packFile, "utf8");
  const from = `/wikido/${pack.id}/${sceneId}.svg`;
  const to = `/wikido/${pack.id}/${sceneId}.jpg`;
  if (!text.includes(from)) return false;
  writeFileSync(packFile, text.replaceAll(from, to));
  return true;
}

const packs = wikidoTopicPacks.filter((p) => !onlyTopic || p.id === onlyTopic);
if (!packs.length) {
  console.error(`No topic pack matches --topic ${onlyTopic}`);
  process.exit(1);
}

const apiKey = dryRun ? "" : loadKey();
if (!dryRun && !apiKey) {
  console.error("No API key: set GEMINI_API_KEY (env) or add it to functions/.secret.local.");
  process.exit(1);
}

let ok = 0;
let failed = 0;
for (const pack of packs) {
  console.log(`\n━━ ${pack.title} (${pack.id}) ━━`);
  for (const scene of Object.values(pack.scenes)) {
    if (onlyScene && scene.id !== onlyScene) continue;
    if (!scene.artPrompt) {
      console.log(`• ${scene.id}: no artPrompt — skipped (write one in the pack first)`);
      continue;
    }
    const prompt = `${pack.artStyle || ""} ${scene.artPrompt}`.trim();
    console.log(`• ${scene.id}`);
    if (dryRun) {
      console.log(`  [dry-run] ${prompt}\n`);
      continue;
    }
    const bytes = await generateImage({ apiKey, prompt });
    if (!bytes) { failed += 1; continue; }
    const dir = path.join(publicDir, pack.id);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${scene.id}.jpg`);
    writeFileSync(file, bytes);
    const patched = patchPackSrc(pack, scene.id);
    ok += 1;
    console.log(`  ✓ ${path.relative(root, file)} (${Math.round(bytes.length / 1024)} KB)${patched ? " — pack src updated" : ""}`);
    console.log("  hotspots to re-measure (x%, y%):");
    for (const h of scene.hotspots) console.log(`    - ${h.label}: ${h.x}, ${h.y}`);
  }
}

console.log(`\nDone: ${ok} generated, ${failed} failed. Review the images, re-run any scene until curated, then commit.`);
console.log("Reminder: press H in Wikido (dev) to read off new hotspot coordinates and update the pack.");
