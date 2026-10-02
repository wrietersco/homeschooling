// These are descriptions of the existing meters, not promises of lesson counts.
export const learningAllowances = {
  text: { label: "Learning preparation credits", description: "Used to plan curricula, prepare activities and learning materials, organize schedules, and answer questions in Guide. One task can use several credits." },
  image: { label: "Activity illustrations", description: "Preparation of new pictures for stories and learning activities. Requests count toward this allowance, including attempts that need to be retried." },
  tts: { label: "Read-aloud recordings", description: "Preparation of new audio to read words, stories, and activity instructions aloud. Preparation requests count toward this allowance; replaying saved audio does not." },
  liveMinutes: { label: "Explore conversation minutes", description: "Time for your child to talk with the interactive Explore learning companion. These are not live teacher sessions." },
};
export const learningFeatures = [
  { title: "A curriculum for your child", description: "Plan learning around your child's age, interests, and developing skills." },
  { title: "Activities that bring learning to life", description: "Prepare reading, language, maths, and other activities from your curriculum." },
  { title: "A routine your family can follow", description: "Organize activities in the planner and record your child's progress." },
  { title: "Support along the way", description: "Ask Guide for help, listen to learning materials, and explore through conversation." },
];
export const packageDescriptions = {
  trial: { eyebrow: "Try your learning routine", description: "Get a feel for your child's learning journey before choosing a longer package." },
  basic: { eyebrow: "Build a steady routine", description: "Plan and prepare learning for your family, with read-aloud support and Explore conversations." },
  premium: { eyebrow: "More room to learn", description: "The same learning tools with larger allowances for preparing materials, illustrations, audio, and Explore conversations." },
};
export const packageStates = { pending: "Not activated", active: "Ready to learn", scheduled: "Starts soon", expired: "Ready for renewal", suspended: "Access paused", cancelled: "Cancelled", invalid: "Contact the administrator" };
