import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Integration tests share one database: run the files one after the other.
    fileParallelism: false,
    testTimeout: 60_000,
    // SF-118: a test key for sealing Gmail keys (no built-in key exists), so Gmail runs on its fake in every test unless a
    // test stubs GMAIL_TOKEN_KEY to "" (Gmail off). Never a real key: 32 bytes of 0x5a.
    env: { GMAIL_TOKEN_KEY: Buffer.alloc(32, 0x5a).toString("base64") },
    hookTimeout: 60_000,
  },
});
