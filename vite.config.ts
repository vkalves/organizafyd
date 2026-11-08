import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@xyflow")) return "vendor-flow";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("lowlight")) {
            return "vendor-editor";
          }
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@radix-ui")) return "vendor-radix";
        },
      },
    },
  },
}));
