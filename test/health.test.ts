import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/server.js";

test("GET /health reports AP is healthy", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "ap",
  });

  await app.close();
});
