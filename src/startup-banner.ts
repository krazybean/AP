const cyan = "\x1b[36m";
const green = "\x1b[92m";
const white = "\x1b[97m";
const muted = "\x1b[90m";
const reset = "\x1b[0m";

export type APStatus = "ready" | "degraded" | "disconnected" | "error";

const statusPresentation: Record<APStatus, { label: string; color: string }> = {
  ready: { label: "Ready", color: green },
  degraded: { label: "Degraded", color: "\x1b[93m" },
  disconnected: { label: "Disconnected", color: muted },
  error: { label: "Error", color: "\x1b[91m" },
};

interface StartupBannerOptions {
  apVersion: string;
  appVersion: string;
  environment: string;
  host: string;
  port: number;
  status?: APStatus;
}

function paint(text: string, color: string, enabled: boolean) {
  return enabled ? `${color}${text}${reset}` : text;
}

function aiProxyLogo(color: boolean) {
  const ai = [
    "      /\\      |‾|",
    "     /  \\     |_|",
    "    / /\\ \\     |",
    "   / ____ \\    |",
    "  /_/    \\_\\   |_",
  ];
  const proxy = [
    "  ___  ____   ___  __  __ __   __",
    " | _ \\| _  \\ / _ \\ \\/ / \\ \\ / /",
    " |  _/|   /| (_) |>  <   \\ V / ",
    " |_|  |_|_\\ \\___//_/\\_\\   |_|  ",
    "                                  ",
  ];

  return ai.map((line, index) =>
    `${paint(line, cyan, color)}${paint(proxy[index] ?? "", white, color)}`,
  ).join("\n");
}

export function renderStartupBanner(options: StartupBannerOptions) {
  if (!process.stdout.isTTY) return;

  const color = !process.env.NO_COLOR;
  const status = options.status ?? "ready";
  const presentation = statusPresentation[status];
  const localHost = options.host === "0.0.0.0" ? "localhost" : options.host;
  const localUrl = `http://${localHost}:${options.port}`;

  const c = (text: string) => paint(text, cyan, color);
  const g = (text: string) => paint(text, presentation.color, color);
  const w = (text: string) => paint(text, white, color);
  const m = (text: string) => paint(text, muted, color);

  console.log("");
  console.log(`${m(`AP v${options.apVersion}`)}    ${m(`APP v${options.appVersion}`)}`);
  console.log(m("Bridging Private Applications and AI"));
  console.log("");
  console.log(aiProxyLogo(color));
  console.log(c("       CONNECT  •  PROXY  •  EMPOWER"));
  console.log(w("       Your applications, everywhere."));
  console.log("");
  console.log(m("────────────────────────────────────────────────────────────"));
  console.log(`${c("Status:")}       ${g(`● ${presentation.label}`)}`);
  console.log(`${c("AP Version:")}   ${w(options.apVersion)}`);
  console.log(`${c("APP Version:")}  ${w(options.appVersion)}`);
  console.log(`${c("Environment:")}  ${w(options.environment)}`);
  console.log(`${c("Local URL:")}    ${w(localUrl)}`);
  console.log(`${c("Health Check:")} ${w(`${localUrl}/health`)}`);
  console.log("");
  console.log(w("AP connects."));
  console.log(w("APP communicates."));
  console.log(w("Applications define capability."));
  console.log(c("Build amazing things."));
  console.log(m("────────────────────────────────────────────────────────────"));
  console.log("");
  console.log(g("AP is ready to proxy requests."));
  console.log(m("Press Ctrl+C to stop"));
  console.log("");
}
