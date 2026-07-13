import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProviderBadge from "./ProviderBadge.vue";

describe("ProviderBadge", () => {
  it("renders nothing when no provider is set (pre-tracking activities)", () => {
    const wrapper = mount(ProviderBadge, { props: { provider: "", model: "" } });
    expect(wrapper.find(".provider-badge").exists()).toBe(false);
  });

  it("shows the friendly model label + provider-colored class for Claude", () => {
    const wrapper = mount(ProviderBadge, { props: { provider: "anthropic", model: "claude-sonnet-5" } });
    const badge = wrapper.find(".provider-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("Claude Sonnet 5");
    expect(badge.classes()).toContain("pb-anthropic");
    expect(badge.attributes("title")).toBe("Claude Sonnet 5 (Anthropic Claude)");
  });

  it("shows Gemini/OpenAI labels too", () => {
    expect(mount(ProviderBadge, { props: { provider: "gemini", model: "gemini-2.5-flash" } }).text()).toBe("Gemini 2.5 Flash");
    expect(mount(ProviderBadge, { props: { provider: "openai", model: "gpt-4o-mini" } }).text()).toBe("GPT-4o mini");
  });
});
