const apBase = process.env.AP_URL ?? "http://localhost:4117";

const created = await fetch(`${apBase}/channels`, { method: "POST" });
if (!created.ok) throw new Error(`Failed to create channel: ${created.status}`);

const { channel, url } = (await created.json()) as { channel: string; url: string };

console.log("Mock APP downstream connected");
console.log(`Channel: ${channel}`);
console.log(`Public root: ${apBase}${url}`);
console.log("Waiting for requests...");

while (true) {
  const next = await fetch(`${apBase}/channels/${channel}/next`);
  if (next.status === 204) continue;
  if (!next.ok) throw new Error(`Channel polling failed: ${next.status}`);

  const request = (await next.json()) as {
    id: string;
    method: string;
    path: string;
    body?: unknown;
  };

  console.log(`${request.method} ${request.path}`);

  let response: { statusCode: number; body: unknown };

  if (request.path === "/") {
    response = {
      statusCode: 200,
      body: {
        protocol: "APP/1.0",
        application: "AP Mock Downstream",
        description: "Minimal downstream used to verify AP end-to-end routing.",
        routes: [
          { method: "GET", path: "/ping", description: "Returns a simple pong response." },
          { method: "POST", path: "/echo", description: "Returns the submitted request body." },
        ],
      },
    };
  } else if (request.method === "GET" && request.path === "/ping") {
    response = { statusCode: 200, body: { pong: true } };
  } else if (request.method === "POST" && request.path === "/echo") {
    response = { statusCode: 200, body: { echo: request.body ?? null } };
  } else {
    response = { statusCode: 404, body: { error: "route_not_found" } };
  }

  const sent = await fetch(
    `${apBase}/channels/${channel}/responses/${request.id}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(response),
    },
  );

  if (!sent.ok) throw new Error(`Response delivery failed: ${sent.status}`);
}
