let out = [], tok = "";
do { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${tok ? `&pageToken=${tok}` : ""}`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } }); const j = await r.json(); out.push(...(j.models || [])); tok = j.nextPageToken || ""; } while (tok);
console.log("=== GEMINI (" + out.length + ")");
for (const m of out) console.log(m.name.replace("models/", ""), "|", (m.supportedGenerationMethods || []).filter((x) => !/countTokens|createCached|batch/i.test(x)).join(","), "| in", m.inputTokenLimit, "out", m.outputTokenLimit);
const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
const j = await r.json();
console.log("=== OPENAI", r.status, (j.data || []).length, j.error?.message || "");
console.log((j.data || []).map((m) => m.id).sort().join("\n"));
