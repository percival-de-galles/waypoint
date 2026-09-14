import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://waypoint.invalid",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
