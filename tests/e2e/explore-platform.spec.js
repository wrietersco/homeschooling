import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Platform superadmin settings for the Explore live-voice agent. Covers the model
// catalog / voice / thinking-level / limits editor and that saved settings
// persist. The real "Preview" (connects to Gemini Live and plays the voice) costs
// a few cents so it only runs on demand:  E2E_LIVE=1 npm run test:e2e

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
if (!getApps().length) initializeApp({ projectId: "homeschooling-b3e57" });

const PASSWORD = "test123456";

// The platform LLM config is ONE global document, so these tests share state:
// run them in order (the read-only pricing test first, before any test saves).
test.describe.configure({ mode: "serial" });

async function signInAsSuperadmin(page) {
  const email = `platform.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  // Create the account with the platform role already attached, then use the
  // normal sign-in form (claims reach the client on that first sign-in).
  const user = await getAuth().createUser({ email, password: PASSWORD });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
  await page.getByLabel("Family name").fill("Platform Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

// A <label> wraps its control plus helper text, so target the control inside it.
const field = (card, label) => card.locator("label", { hasText: new RegExp(`^${label}`) }).locator("select, input, textarea").first();

async function openExploreCard(page) {
  await page.locator("header.nav").getByRole("link", { name: "Platform" }).click();
  await page.getByRole("button", { name: "LLM config" }).click();
  const card = page.locator(".llm-card", { has: page.locator("code.agent-key", { hasText: /^explore$/ }) });
  await expect(card).toBeVisible({ timeout: 60_000 });
  return card;
}

test("Models & pricing tab shows every text, speech and image model with its price, and flags retired models", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsSuperadmin(page);
  await page.locator("header.nav").getByRole("link", { name: "Platform" }).click();
  await page.getByRole("button", { name: "Models & pricing" }).click();

  // Text models: all 25 (incl. the newest Gemini 3.x and OpenAI GPT-5.6 / GPT-6), grouped by provider, with per-1M-token input / output.
  const text = page.getByRole("table", { name: "Text models" });
  await expect(text.locator("tbody tr:not(.price-group)")).toHaveCount(25, { timeout: 60_000 });
  const row = (id) => text.locator("tbody tr", { has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
  await expect(row("gemini-2.5-flash")).toContainText("$0.30");
  await expect(row("gemini-2.5-flash")).toContainText("$2.50");
  await expect(row("gpt-4o")).toContainText("$1.25"); // cached input
  await expect(row("claude-opus-4-8")).toContainText("$25.00");
  // Sonnet 5's launch price is now permanent: $2 / $10 (not $3 / $15).
  await expect(row("claude-sonnet-5")).toContainText("$2.00");
  await expect(row("claude-sonnet-5")).toContainText("$10.00");
  await expect(row("claude-sonnet-5")).toContainText("$2.00 in / $10.00 out"); // and it's what Costs charges
  await expect(row("gemini-2.0-flash")).toContainText("Unavailable");
  // Latest models: Gemini 3.8 Flash (intro price that doubles on 2027-01-01) and OpenAI's GPT-6 Astra / 5.6 family.
  await expect(row("gemini-3.8-flash")).toContainText("$0.75");
  await expect(row("gemini-3.8-flash")).toContainText("→ $1.50 from 2027-01-01");
  await expect(row("gemini-3.8-flash")).toContainText("→ $7.50 from 2027-01-01");
  await expect(row("gemini-3.8-flash").locator(".md-new")).toHaveText("New");
  await expect(row("gemini-3.1-pro-preview")).toContainText("$12.00");
  await expect(row("gpt-6-astra")).toContainText("$10.00");
  await expect(row("gpt-6-astra")).toContainText("$50.00");
  await expect(row("gpt-5.6-luna")).toContainText("$0.20");
  await expect(row("gpt-5.6-luna")).toContainText("$1.20");
  await expect(row("gpt-5.6-luna").locator(".md-rec", { hasText: "Recommended" })).toBeVisible();
  await expect(row("gpt-5.6-sol")).toContainText("$20.00");

  // Speech and image models.
  const tts = page.getByRole("table", { name: "Speech models" });
  await expect(tts.locator("tbody tr")).toHaveCount(6);
  await expect(tts.locator("tbody tr", { hasText: "gemini-3.1-flash-tts-preview" })).toContainText("$20.00");
  await expect(tts.locator("tbody tr", { hasText: "tts-1-hd" })).toContainText("$30.00");
  await expect(tts.locator("tbody tr", { hasText: "gemini-2.5-pro-preview-tts" })).toContainText("$20.00");
  const img = page.getByRole("table", { name: "Image models" });
  await expect(img.locator("tbody tr")).toHaveCount(10);
  await expect(img.locator("tbody tr", { hasText: "gemini-3.1-flash-image" }).first()).toContainText("$0.067");
  await expect(img.locator("tbody tr", { hasText: "gemini-3.1-flash-lite-image" })).toContainText("$0.0336");
  await expect(img.locator("tbody tr", { hasText: "gemini-3-pro-image" })).toContainText("$0.134");
  await expect(img.locator("tbody tr", { hasText: "gpt-image-2.5-flare" })).toContainText("$0.006");
  await expect(img.locator("tbody tr", { hasText: "gemini-2.5-flash-image" })).toContainText("$0.039");
  await expect(img.locator("tbody tr", { hasText: "imagen-4.0-ultra-generate-001" })).toContainText("Unavailable");

  // Attention box: retired Imagen / 2.0 Flash + the deprecating default image model.
  const alerts = page.getByRole("alert", { name: "Model alerts" });
  await expect(alerts).toContainText("gemini-2.0-flash");
  await expect(alerts).toContainText("imagen-4.0-generate-001");
  await expect(alerts).toContainText("gemini-2.5-flash-image");
  await expect(alerts).toContainText("2026-10-02");
  // The default image model is now Nano Banana 2, so nothing depends on the retiring one.
  await expect(alerts).toContainText("switches to Gemini 3.1 Flash Image automatically");
  await expect(alerts).not.toContainText("Currently used by: Storybook images", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Anthropic" })).toBeVisible();
});

test("Live models tab lists every Live model with pricing and what Explore currently uses", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsSuperadmin(page);
  await page.locator("header.nav").getByRole("link", { name: "Platform" }).click();
  await page.getByRole("button", { name: "Models & pricing" }).click();

  // Conversational models (selectable as the buddy): 6 rows.
  const main = page.getByRole("table", { name: "Conversational Live models" });
  await expect(main.locator("tbody tr")).toHaveCount(6, { timeout: 60_000 });
  const live38 = main.locator("tbody tr", { has: page.locator("code", { hasText: /^gemini-3\.8-live$/ }) });
  await expect(live38).toContainText("$3.00 / $12.00"); // audio in / out per 1M tokens
  await expect(live38).toContainText("$0.005 / $0.018"); // per audio minute
  await expect(live38).toContainText("$0.014"); // ≈ per conversation minute (0.005 + ½ × 0.018)
  await expect(live38).toContainText("20 min ≈ $0.28");
  // Defaults: Exploration uses 3.8 Live, Learning uses the thinking model.
  await expect(live38.locator(".live-badge")).toHaveText(["Exploration"], { timeout: 60_000 }); // waits for the saved config to load
  const ext = main.locator("tbody tr", { has: page.locator("code", { hasText: /^gemini-3\.8-live-extended-thinking$/ }) });
  await expect(ext.locator(".live-badge")).toHaveText(["Learning"], { timeout: 60_000 });
  // The older 2.5 native-audio builds are listed too, with estimated per-minute input.
  await expect(main.locator("code", { hasText: "gemini-2.5-flash-native-audio-latest" })).toBeVisible();
  await expect(main.locator("code", { hasText: "gemini-2.5-flash-native-audio-preview-09-2025" })).toBeVisible();
  await expect(main.locator("code", { hasText: "gemini-3.1-flash-live-preview" })).toBeVisible();

  // Specialised Live models are listed for reference, flagged as not usable as the buddy.
  const other = page.getByRole("table", { name: "Other Live models" });
  await expect(other.locator("tbody tr")).toHaveCount(3);
  await expect(other.locator("tbody tr", { hasText: "gemini-3.5-transcribe-live" })).toContainText("Not usable as the buddy");
  await expect(other.locator("tbody tr", { hasText: "gemini-3.5-live-translate-preview" })).toContainText("$3.50 in / $21.00 audio out");
  await expect(page.getByRole("link", { name: /ai\.google\.dev\/gemini-api\/docs\/pricing/ })).toBeVisible();
  await expect(page.locator(".live-intro p.sm-text")).toContainText("last checked 2026-09-20");
});

test("LLM config defaults to the latest image model and offers every current model", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsSuperadmin(page);
  await page.locator("header.nav").getByRole("link", { name: "Platform" }).click();
  await page.getByRole("button", { name: "LLM config" }).click();
  const cardFor = (key) => page.locator(".llm-card", { has: page.locator("code.agent-key", { hasText: new RegExp(`^${key}$`) }) });

  // Storybook images: Nano Banana 2 is the default (2.5 Flash Image is being shut down),
  // and the picker offers Gemini AND OpenAI image models.
  const image = cardFor("image");
  await expect(image).toBeVisible({ timeout: 60_000 });
  const imageModel = image.getByLabel("Model ID");
  await expect(imageModel).toHaveValue("gemini-3.1-flash-image");
  await expect(imageModel.locator("option")).toHaveCount(10);
  await expect(imageModel.locator("option", { hasText: "gpt-image-2.5-flare" })).toHaveCount(1);
  await expect(imageModel.locator("option", { hasText: "gemini-2.5-flash-image" })).toContainText("SHUTTING DOWN");
  await expect(imageModel.locator("option", { hasText: "imagen-4.0-generate-001" })).toContainText("UNAVAILABLE");

  // A text agent on OpenAI offers the GPT-5.6 / GPT-6 line-up; on Gemini the 3.x Flash models.
  const guide = cardFor("guide");
  await expect(guide.getByLabel("Model ID").locator("option", { hasText: "gemini-3.8-flash" })).toHaveCount(1);
  const curriculum = cardFor("curriculum");
  await curriculum.getByLabel("Provider").selectOption("openai");
  const cModel = curriculum.getByLabel("Model ID");
  for (const id of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-4o-mini"]) {
    await expect(cModel.locator("option", { hasText: id }).first()).toHaveCount(1);
  }
  // Switching provider snaps to that provider's recommended model (GPT-5.6 Luna).
  await expect(cModel).toHaveValue("gpt-5.6-luna");

  // Speech: the newest Gemini TTS model is available.
  const tts = cardFor("tts");
  await expect(tts.getByLabel("Model ID").locator("option", { hasText: "gemini-3.1-flash-tts-preview" })).toHaveCount(1);
});

test("superadmin configures the Explore live model, voice, thinking level and limits", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsSuperadmin(page);
  const card = await openExploreCard(page);

  // Live catalog (not the text models): 6 verified conversational models, default selected.
  const model = card.getByLabel("Model ID");
  await expect(model.locator("option")).toHaveCount(6);
  await expect(model).toHaveValue("gemini-3.8-live");
  // 30 Live voices, Puck by default; no thinking level for the standard model.
  const voice = field(card, "Voice");
  await expect(voice.locator("option")).toHaveCount(30);
  await expect(voice).toHaveValue("Puck");
  await expect(field(card, "Thinking level")).toHaveCount(0);

  // Extended-thinking reveals the thinking level.
  await model.selectOption("gemini-3.8-live-extended-thinking");
  await expect(field(card, "Thinking level")).toBeVisible();
  await field(card, "Thinking level").selectOption("medium");

  await voice.selectOption("Leda");
  // Learning mode has its own model (defaults to the thinking model at Medium).
  await expect(field(card, "Learning-mode model")).toHaveValue("gemini-3.8-live-extended-thinking");
  await expect(field(card, "Learning thinking level")).toHaveValue("medium");
  await field(card, "Learning thinking level").selectOption("high");
  await card.getByLabel("Max minutes per conversation").fill("12");
  await card.getByLabel("Max conversations per family / day").fill("7");
  await card.getByLabel(/System instructions/).fill("Always begin with Bismillah.");
  await page.getByRole("button", { name: "Save all agent settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });

  // Persisted: reload the config from the server.
  await page.reload();
  const card2 = await openExploreCard(page);
  await expect(card2.getByLabel("Model ID")).toHaveValue("gemini-3.8-live-extended-thinking");
  await expect(field(card2, "Voice")).toHaveValue("Leda");
  await expect(field(card2, "Thinking level")).toHaveValue("medium");
  await expect(field(card2, "Learning thinking level")).toHaveValue("high");
  await expect(card2.getByLabel("Max minutes per conversation")).toHaveValue("12");
  await expect(card2.getByLabel("Max conversations per family / day")).toHaveValue("7");
  await expect(card2.getByLabel(/System instructions/)).toHaveValue("Always begin with Bismillah.");

  // Switching back to a standard model clears the thinking level.
  await card2.getByLabel("Model ID").selectOption("gemini-3.8-live");
  await expect(field(card2, "Thinking level")).toHaveCount(0);

  // ...and saving in that state must not leave the level behind: a level on a
  // model without thinking closes the Live socket ("Thinking level is not
  // supported for this model") and the child just sees "couldn't connect".
  await card2.getByLabel("Learning-mode model").selectOption("gemini-3.8-live");
  await expect(field(card2, "Learning thinking level")).toHaveCount(0);
  await page.getByRole("button", { name: "Save all agent settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  const card3 = await openExploreCard(page);
  await expect(card3.getByLabel("Model ID")).toHaveValue("gemini-3.8-live");
  await expect(field(card3, "Thinking level")).toHaveCount(0);
  await expect(field(card3, "Learning thinking level")).toHaveCount(0);
});

test("Preview connects to Gemini Live for real and reports latency + a spoken greeting", async ({ page }) => {
  test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 to run the real Gemini Live preview");
  test.setTimeout(180_000);
  await signInAsSuperadmin(page);
  const card = await openExploreCard(page);
  await card.getByRole("button", { name: "Preview" }).click();
  await expect(card.locator(".preview-row .ok")).toContainText(/first audio/, { timeout: 60_000 });
  await expect(card.locator(".preview-output")).not.toBeEmpty();
});
