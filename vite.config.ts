import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
    base: mode === "development" ? "/" : "/reaper2gma3/",
    plugins: [react()],
    build: {
        outDir: "build",
        emptyOutDir: true,
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/**/*.test.tsx", "tests/**/*.ui.test.ts"],
    },
}));
