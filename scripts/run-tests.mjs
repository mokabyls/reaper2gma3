import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const outDir = new URL("../.test-build", import.meta.url);

rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync("pnpm", ["exec", "tsc", "-p", "tsconfig.tests.json"], {
    stdio: "inherit",
    shell: false,
});

if (compile.status !== 0) {
    process.exit(compile.status ?? 1);
}

const testFiles = readdirSync(new URL("../.test-build/tests", import.meta.url))
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => `.test-build/tests/${name}`)
    .sort();

if (testFiles.length === 0) {
    console.error("No compiled test files found in .test-build/tests.");
    process.exit(1);
}

const run = spawnSync("node", ["--test", ...testFiles], {
    stdio: "inherit",
    shell: false,
});

process.exit(run.status ?? 1);
