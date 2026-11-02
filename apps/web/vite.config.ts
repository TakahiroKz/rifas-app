import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    // En desarrollo, el API corre con `wrangler dev` (puerto 8787).
    proxy: { "/api": "http://localhost:8787" },
  },
});
