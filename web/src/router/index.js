import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

// Route map mirrors the plan's feature modules. Most are placeholders in
// Phase 0 and get fleshed out in their respective phases. `meta.requiresAuth`
// and `meta.role` drive the navigation guard below.
const routes = [
  { path: "/", name: "home", component: () => import("@/views/HomeView.vue") },
  { path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: { public: true } },
  {
    path: "/onboarding",
    name: "onboarding",
    component: () => import("@/views/OnboardingView.vue"),
    meta: { requiresAuth: true, allowNoFamily: true },
  },
  {
    path: "/dashboard",
    name: "dashboard",
    component: () => import("@/views/DashboardView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/profile",
    name: "profile",
    component: () => import("@/views/ProfileView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/guardians",
    name: "guardians",
    component: () => import("@/views/GuardiansView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/children",
    name: "children",
    component: () => import("@/views/ChildrenView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/skills",
    name: "skills",
    component: () => import("@/views/SkillsView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/guide",
    name: "guide",
    component: () => import("@/views/GuideView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/curriculum",
    name: "curriculum",
    component: () => import("@/views/CurriculumView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/syllabus",
    name: "syllabus",
    component: () => import("@/views/SyllabusView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/planner",
    name: "planner",
    component: () => import("@/views/PlannerView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/session",
    name: "session",
    component: () => import("@/views/ActivityPlayerView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/activity/:activityId",
    name: "activity",
    component: () => import("@/views/ActivityView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/platform",
    name: "platform",
    component: () => import("@/views/PlatformView.vue"),
    meta: { requiresAuth: true, role: "superadmin" },
  },
  // Family invite acceptance — public so uninvited users see a sign-in prompt.
  {
    path: "/invite/:token",
    name: "invite",
    component: () => import("@/views/InviteView.vue"),
    meta: { public: true },
  },
  // Child Activity Player — link-scoped, intentionally public (token in URL).
  {
    path: "/play/:token",
    name: "child-player",
    component: () => import("@/views/ChildPlayerView.vue"),
    meta: { public: true },
  },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue"), meta: { public: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const authStore = useAuthStore();
  await authStore.ready();
  if (to.meta.requiresAuth && !authStore.user) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  // Signed-in users without a family must finish onboarding before reaching
  // family-scoped pages; superadmins are exempt.
  if (
    authStore.user &&
    !authStore.hasFamily &&
    !authStore.isSuperAdmin &&
    to.meta.requiresAuth &&
    !to.meta.allowNoFamily
  ) {
    return { name: "onboarding" };
  }
  // Once onboarded, keep them out of the onboarding screen.
  if (to.name === "onboarding" && authStore.hasFamily) {
    return { name: "dashboard" };
  }
  if (to.meta.role === "superadmin" && !authStore.isSuperAdmin) {
    return { name: "home" };
  }
  return true;
});

export default router;
