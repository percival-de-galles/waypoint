import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  git: {
    deploymentEnabled: false,
  },
  installCommand: "npm install -g vite-plus && vp install --filter '@waypoint/marketing...'",
  buildCommand: "vp run --filter @waypoint/marketing build",
  outputDirectory: "dist",
  redirects: [
    {
      source: "/app",
      destination: "https://waypoint.invalid",
      permanent: true,
    },
  ],
};
