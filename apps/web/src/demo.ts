/** Central demo-mode constants. Imported by auth, API routes, and pages. */

export const DEMO_MODE = process.env.DEMO_MODE === "true";

export const DEMO_USER_ID = "demo-user-001";

/** Project IDs → display names shown to the demo user. */
export const DEMO_PROJECTS: Record<string, string> = {
  "demo-norte": "Subestación Norte",
  "demo-sur": "Planta Industrial Sur",
};
