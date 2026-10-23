// Sign in to AP with GitHub or Google and print your AP key.
// Run: npm run login               (GitHub)
//      npm run login -- google     (Google; AP_PROVIDER=google does the same)
// AP_URL picks another AP; the default is the hosted one.
import { hostname } from "node:os";

const AP = process.env.AP_URL ?? "https://apchannels.dev";
const provider = process.argv[2] ?? process.env.AP_PROVIDER ?? "github";
if (provider !== "github" && provider !== "google") {
  console.error(`Unknown provider "${provider}". Use github or google.`);
  process.exit(1);
}
const post = (path, body) => fetch(`${AP}${path}`, {
  method: "POST",
  ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
});

// 1. Ask AP for a sign-in code.
const started = await post("/auth/device", { provider });
const login = await started.json();
if (!started.ok) {
  console.error(`Could not start sign-in: ${login.error}`);
  process.exit(1);
}
console.log(`1. Open ${login.url}`);
console.log(`2. Type this code: ${login.code}`);
console.log("3. Click Authorize. This window waits for you...");

// 2. Wait until you approve it with your provider, then AP hands back your key.
let interval = login.interval;
while (true) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(interval, 1) * 1_000));
  const polled = await post("/auth/device/token", { deviceId: login.deviceId, provider, label: hostname().replace(/[^\x20-\x7e]/g, "").slice(0, 64) || "login" });
  const result = await polled.json();
  if (polled.status === 202) {
    interval = result.interval ?? interval;
    continue;
  }
  if (!polled.ok) {
    console.error(`Sign-in stopped: ${result.error}. Run npm run login again.`);
    process.exit(1);
  }
  console.log(`\nSigned in as ${result.login}. Your AP key:\n\n  ${result.key}\n`);
  console.log("Keep it secret. Use it in your app like this:");
  console.log(`  export AP_KEY='${result.key}'`);
  break;
}
