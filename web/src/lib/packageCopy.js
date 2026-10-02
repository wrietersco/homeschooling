// One successful saved activity is the parent-facing package unit.
export const learningAllowances = {
  activities: { label: "Prepared learning activities", description: "One new or refreshed activity with ready-to-use learning content. Includes parent guidance and age-appropriate exercises, stories, reading or practice. Illustrations are included where relevant. Saved activities can be reused without another activity charge." },
  text: { label: "Preparation requests", description: "Supporting limit for curriculum planning, activity preparation, scheduling and Guide. Each model call or retry counts; these are not additional activities." },
  image: { label: "Illustration requests", description: "Supporting limit for new activity pictures, including generation retries. Not every activity needs a picture." },
  tts: { label: "Read-aloud recordings", description: "New audio for learning materials. Requests count; replaying saved audio does not." },
  liveMinutes: { label: "Learning companion minutes", description: "Optional Explore conversations with the interactive companion. These are not teacher-led classes. Starting a session reserves its allowed minutes." },
};
export const learningFeatures = [
  { title: "Learning planned for your child", description: "Build a curriculum around age, interests and developing skills, across the subjects you choose." },
  { title: "Activities ready to use", description: "Reading, stories, maths problems, language practice and more, with learning content and clear parent guidance." },
  { title: "A practical family routine", description: "Put activities in your planner, record progress and return to saved activities for more practice." },
  { title: "Help teaching at home", description: "Worked examples and learning guidance help you lead each activity. Ask Guide when you need support." },
];
export const packageDescriptions = {
  trial: { eyebrow: "A first day of learning", description: "Try a small collection of prepared activities and see how learning at home works for your child." },
  basic: { eyebrow: "Your monthly learning routine", description: "Build a balanced collection of activities across your child's subjects, ready for regular learning at home." },
  premium: { eyebrow: "A larger learning collection", description: "Prepare more activities for wider subject coverage, extra practice or learning together as a family." },
};
export const packageStates = { pending: "Not activated", active: "Ready to learn", scheduled: "Starts soon", expired: "Ready for renewal", suspended: "Access paused", cancelled: "Cancelled", invalid: "Contact the administrator" };
