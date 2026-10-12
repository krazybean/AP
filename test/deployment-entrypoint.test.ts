import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("Vercel entrypoint starts and serves health", async () => {
  const port = 43118;
  const server = spawn(process.execPath, ["--import", "tsx", "src/app.ts"], {
    env: { ...process.env, VERCEL: "1", HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
  });

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(response.status, 200);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.fail("Vercel entrypoint did not respond to /health");
  } finally {
    server.kill();
  }
});
