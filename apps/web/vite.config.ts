import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  build: {
    rollupOptions: {
      output: {
        sourcemapExcludeSources: true,
      },
    },
    sourcemap: true,
  },
});
