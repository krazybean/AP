import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("production server entrypoint starts and serves health", async () => {
  const port = 43117;
  const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: { ...process.env, HOST: "127.0.0.1", NODE_ENV: "test", PORT: String(port) },
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
    assert.fail("AP server did not respond to /health");
  } finally {
    server.kill();
  }
});
