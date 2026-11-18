import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { generateServerFnId } from "./scripts/lib/server-fn-id.mjs";

export default defineConfig({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      // Readable wire ids in production builds, so the e2e paid-call guard can see the function
      // name (tests/e2e/server-fn-guard.ts). Dev builds ignore this option.
      serverFns: { generateFunctionId: generateServerFnId },
    }),
    nitro(),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
