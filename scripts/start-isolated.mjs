// Starts the built app (`next start`) for the browser tests without the developer's env files.
// Next.js loads .env, .env.local and .env.*.local from the folder it starts in, so this starts it from a
// temporary folder that links to the build (.next), node_modules and the config, and holds no .env* file:
// the app sees only the environment the tests give it. The app's own environment rules are unchanged.
// Usage: node scripts/start-isolated.mjs <port>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const port = process.argv[2] ?? "3000";
const root = process.cwd();
// One folder per port, made fresh each start (a server killed with SIGKILL cannot clean up after itself).
const dir = path.join(tmpdir(), `crm-e2e-${port}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
for (const name of [".next", "node_modules", "package.json", "next.config.ts", "tsconfig.json", "public"]) {
  if (existsSync(path.join(root, name))) symlinkSync(path.join(root, name), path.join(dir, name));
}
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "start", dir, "-p", port], { stdio: "inherit" });
const cleanup = () => rmSync(dir, { recursive: true, force: true });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
