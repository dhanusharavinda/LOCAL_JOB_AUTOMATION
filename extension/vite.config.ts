import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

// CRX plugin handles MV3 bundling end-to-end:
//   - splits content scripts so each ATS gets its own bundle
//   - generates the service-worker entry from background.ts
//   - injects HMR shims for `npm run dev` (load unpacked, edits hot-reload)
//   - rewrites manifest.json paths to point at hashed dist files
//
// Build-time env injection. The extension can't read process.env at
// runtime, so the API base + Supabase keys are baked into the bundle
// via `define`. Set in extension/.env (gitignored) for production:
//   VITE_API_URL=https://api.gocandid8.com
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon-jwt>
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), crx({ manifest })],
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL || "http://localhost:3001"),
      __SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || ""),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ""),
      __DASHBOARD_URL__: JSON.stringify(env.VITE_DASHBOARD_URL || "http://localhost:5173"),
    },
    build: {
      rollupOptions: {
        output: { format: "es" },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      hmr: { port: 5174 },
    },
  };
});
