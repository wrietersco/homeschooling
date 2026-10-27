// Colours per activity type (the games' tile palette), shared by the planner and
// the player so an activity wears the same colour everywhere.
export const TINTS = {
  quran: { bg: "#DDF8E8", deep: "#1E9E5C" },
  noorani_qaida: { bg: "#D9F7F2", deep: "#149485" },
  arabic_reading: { bg: "#DDF8E8", deep: "#1E9E5C" },
  urdu_reading: { bg: "#FFEBD3", deep: "#C96F1E" },
  english_reading: { bg: "#DBF3FF", deep: "#1D7FBE" },
  story_reading: { bg: "#EEE3FF", deep: "#7B3FD1" },
  conversation: { bg: "#FFE3EC", deep: "#D6457C" },
  mathematics: { bg: "#FFF8C9", deep: "#A98608" },
  computer: { bg: "#DBF3FF", deep: "#1D7FBE" },
  ai_robotics: { bg: "#FFE6DC", deep: "#D1502A" },
  physical: { bg: "#FFE6DC", deep: "#D1502A" },
  teaching: { bg: "#EEE3FF", deep: "#7B3FD1" },
};
export const tintOf = (type) => TINTS[type] || TINTS.teaching;
export const tintStyle = (type) => ({ "--bg": tintOf(type).bg, "--deep": tintOf(type).deep });
