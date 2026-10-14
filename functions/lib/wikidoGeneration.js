import {
  buildTopicPrompt, buildHierarchyReviewPrompt, normalizeGeneratedPack,
  validateTopicPack, validateDeclaredHierarchy, parseLlmJson,
} from "./wikidoPack.js";

// No persistence until both structural validation and semantic review pass.
export async function generateReviewedTopic({ llm, genConfig, title, angle = "" }) {
  let normalized;
  let fixes = [];
  let feedback = [];
  // One correction attempt for malformed or semantically misplaced branches.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await llm.generate({
      system: buildTopicPrompt({ title, angle }),
      contents: [{ role: "user", parts: [{ text: `Generate the topic pack JSON for: ${title}${angle ? ` (${angle})` : ""}.${feedback.length ? ` Correct these issues from the previous attempt: ${JSON.stringify(feedback)}. Previous pack: ${JSON.stringify(normalized)}` : ""}` }] }],
      config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 16384) },
    });
  
    let pack;
    try {
      pack = parseLlmJson(result.text);
    } catch (e) {
      throw new Error(`The model's answer could not be parsed: ${e?.message || e}`);
    }
    ({ pack: normalized, fixes } = normalizeGeneratedPack({ ...pack, title: pack.title || title }));
    // a fresh topic has no artwork yet — src is filled in by the artwork step
    feedback = [
      ...validateTopicPack(normalized, { allowMissingArtwork: true }),
      ...validateDeclaredHierarchy(normalized, normalized.hierarchy),
    ];
    if (!feedback.length) {
      const reviewResult = await llm.generate({
        system: buildHierarchyReviewPrompt(),
        contents: [{ role: "user", parts: [{ text: JSON.stringify(normalized) }] }],
        config: { ...genConfig, temperature: 0, maxOutputTokens: 4096 },
      });
      let review;
      try { review = parseLlmJson(reviewResult.text); }
      catch { review = null; }
      if (review?.valid !== true || !Array.isArray(review?.issues) || review.issues.length) {
        feedback = review?.issues?.length && Array.isArray(review.issues)
          ? review.issues.map(String) : ["Hierarchy review did not approve this topic. Recheck every parent/child relation."];
      }
    }
    if (!feedback.length) break;
  }
  if (feedback.length) throw new Error(`The generated hierarchy failed validation: ${feedback.slice(0, 5).join(" · ")}`);
  // Store the checked doorway tree as the single editable source of truth.
  // Keeping the generator's duplicate declaration would become stale on edits.
  delete normalized.hierarchy;
  return { pack: normalized, fixes };
}
