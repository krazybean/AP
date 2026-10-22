// The smallest AP app: run it, and anyone can call it from the internet.
// Run: node examples/hello-app.mjs
const AP = process.env.AP_URL ?? "https://apchannels.dev";
// Your AP key from `npm run login`, if you have one.
const key = process.env.AP_KEY ? { "x-ap-key": process.env.AP_KEY } : {};

// 1. Ask AP for a public address.
const created = await fetch(`${AP}/channels`, { method: "POST", headers: key });
const channel = await created.json();
if (!created.ok) {
  console.error(`Could not get an address: ${channel.error}`);
  process.exit(1);
}
const address = new URL(channel.url, AP).href.replace(/\/$/, "");
console.log(`Your app is live at: ${address}`);
console.log(`Try it: curl "${address}/hello?name=Sam"`);

// 2. Wait for someone to call it, answer, and wait again.
const secret = { ...key, authorization: `Bearer ${channel.secret}` };
while (true) {
  const next = await fetch(`${AP}/channels/${channel.channel}/next`, { headers: secret });
  if (next.status === 204) continue; // nobody called yet; keep waiting
  if (!next.ok) {
    console.error("AP closed this address. Run the app again for a new one.");
    process.exit(1);
  }

  const request = await next.json();
  const url = new URL(request.path, "http://app");
  console.log(`Someone asked for ${request.method} ${request.path}`);

  // 3. Decide the answer. This is your app: change it however you like.
  const name = url.searchParams.get("name") ?? "friend";
  const answer = url.pathname === "/hello"
    ? { statusCode: 200, body: { message: `Hello, ${name}!` } }
    : { statusCode: 200, body: { try: "/hello?name=Sam" } };

  // 4. Send the answer back through AP.
  await fetch(`${AP}/channels/${channel.channel}/responses/${request.id}`, {
    method: "POST",
    headers: { ...secret, "content-type": "application/json" },
    body: JSON.stringify(answer),
  });
}
