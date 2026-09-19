import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";

test("channel proxies a request to a polling downstream", async () => {
  const app = buildApp();

  const created = await app.inject({ method: "POST", url: "/channels" });
  assert.equal(created.statusCode, 201);
  const { channel } = created.json() as { channel: string };

  const publicRequest = app.inject({ method: "GET", url: `/c/${channel}/ping` });

  const next = await app.inject({
    method: "GET",
    url: `/channels/${channel}/next`,
  });

  assert.equal(next.statusCode, 200);
  const pending = next.json() as { id: string; method: string; path: string };
  assert.equal(pending.method, "GET");
  assert.equal(pending.path, "/ping");

  const response = await app.inject({
    method: "POST",
    url: `/channels/${channel}/responses/${pending.id}`,
    payload: { statusCode: 200, body: { pong: true } },
  });
  assert.equal(response.statusCode, 202);

  const completed = await publicRequest;
  assert.equal(completed.statusCode, 200);
  assert.deepEqual(completed.json(), { pong: true });

  await app.close();
});
