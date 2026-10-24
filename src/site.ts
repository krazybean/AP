// Static pages served on AP's own address: a landing page and the privacy policy.
// The pages themselves are inline CSS only: no scripts, no external requests. The landing hero loads AP's own
// media and the interactive demo (a separate page at /demo, with its own CSP), all from AP's origin.

import { HERO_POSTER_PATH, HERO_VIDEO_PATH } from "./hero-media.js";

const REPO = "https://github.com/krazybean/AP";
export const PRIVACY_UPDATED = "October 23, 2026";

// The mark and flow diagram are inline SVG so the pages need no image files and the CSP can stay strict.
const HEX_OUTER = "50,5 88.97,27.5 88.97,72.5 50,95 11.03,72.5 11.03,27.5";
const HEX_INNER = "50,14 81.18,32 81.18,68 50,86 18.82,68 18.82,32";

function logo(size: number, label = "AP") {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${label}">
<polygon points="${HEX_OUTER}" fill="none" stroke="#ff3b30" stroke-width="1" transform="translate(50 50) scale(1.04) translate(-50 -50)" opacity=".7"/>
<polygon points="${HEX_OUTER}" fill="#0a0a0b" stroke="#f2f2f2" stroke-width="2.6" stroke-linejoin="miter"/>
<polygon points="${HEX_INNER}" fill="none" stroke="#f2f2f2" stroke-width=".7" stroke-dasharray="2.4 2"/>
<circle cx="50" cy="31" r="4.2" fill="#ff3b30"/>
<text x="50" y="68" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="27" font-weight="800" letter-spacing="1" fill="#f2f2f2">AP</text>
</svg>`;
}

const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="${HEX_OUTER}" fill="#0a0a0b" stroke="#f2f2f2" stroke-width="6"/><circle cx="50" cy="33" r="7" fill="#ff3b30"/></svg>`)}`;

function globe(cy: number) {
  return `<g stroke="#d8d8dc" stroke-width="1" fill="none"><circle cx="130" cy="${cy}" r="24"/><ellipse cx="130" cy="${cy}" rx="10" ry="24"/><line x1="106" y1="${cy}" x2="154" y2="${cy}"/><line x1="130" y1="${cy - 24}" x2="130" y2="${cy + 24}"/></g>
<text x="130" y="${cy + 42}" class="t">AI CLIENTS</text>`;
}

const DIAGRAM = `<svg class="diagram" viewBox="0 0 1000 390" role="img" aria-label="AI clients send HTTPS requests to AP. AP queues them. The private application polls outward, receives the request and returns its response through the same channel.">
<defs>
<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#ff5a4d" stroke-width="1.5"/></marker>
<marker id="aw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#d8d8dc" stroke-width="1.5"/></marker>
</defs>
<g fill="none" stroke="#3a3a40" stroke-width="1" stroke-dasharray="4 4"><rect x="10" y="45" width="240" height="325"/><rect x="330" y="45" width="340" height="325"/><rect x="750" y="45" width="240" height="325"/></g>
<text x="130" y="30" class="t b">PUBLIC / CLIENT SIDE</text>
<text x="500" y="30" class="t b">AP / PUBLIC RENDEZVOUS</text>
<text x="870" y="30" class="t b">PRIVATE / APP SIDE</text>
${globe(110)}${globe(205)}${globe(300)}
<g fill="none" stroke="#ff5a4d" stroke-width="1.6" stroke-linecap="round">
<path d="M154 110 C185 110 190 205 214 205"/><path d="M154 205 L214 205"/><path d="M154 300 C185 300 190 205 214 205"/>
<path d="M214 205 L440 205" marker-end="url(#ar)"/>
<path d="M538 275 C538 356 480 356 400 356 L160 356" marker-end="url(#ar)"/>
<path d="M565 205 L742 205" marker-end="url(#ar)"/>
<path d="M742 245 L565 245" marker-end="url(#ar)"/>
</g>
<path d="M742 165 L580 165" fill="none" stroke="#d8d8dc" stroke-width="1.2" stroke-dasharray="5 4" marker-end="url(#aw)"/>
<text x="330" y="196" class="t m" text-anchor="middle">REQUEST · HTTPS</text>
<text x="320" y="347" class="t m" text-anchor="middle">RESPONSE · SAME CHANNEL</text>
<text x="661" y="154" class="t m" text-anchor="middle">OUTBOUND POLL</text>
<text x="661" y="196" class="t m" text-anchor="middle">QUEUED REQUEST</text>
<text x="661" y="266" class="t m" text-anchor="middle">APPLICATION RESPONSE</text>
<text x="500" y="75" class="t m" text-anchor="middle">STABLE PUBLIC NAMESPACE</text>
<text x="500" y="100" class="t red" text-anchor="middle" font-size="17">/c/{channel}</text>
<g transform="translate(500 205) scale(1.2) translate(-50 -50)">
<polygon points="${HEX_OUTER}" fill="#0a0a0b" stroke="#f2f2f2" stroke-width="2"/><polygon points="${HEX_INNER}" fill="none" stroke="#f2f2f2" stroke-width=".6" stroke-dasharray="2.4 2"/>
<circle cx="50" cy="31" r="3.6" fill="#ff3b30"/><text x="50" y="64" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="800" fill="#f2f2f2">AP</text></g>
<text x="870" y="105" class="t b" font-size="15">APPLICATION</text>
<g><rect x="800" y="125" width="140" height="105" rx="9" fill="#101012" stroke="#d8d8dc" stroke-width="1.2"/>
<circle cx="815" cy="140" r="3" fill="#ff3b30"/><circle cx="826" cy="140" r="3" fill="#ff3b30" opacity=".6"/><circle cx="837" cy="140" r="3" fill="#d8d8dc"/>
<g stroke="#8a8a92" stroke-width="2" stroke-linecap="round"><line x1="815" y1="165" x2="905" y2="165"/><line x1="815" y1="180" x2="885" y2="180"/><line x1="815" y1="195" x2="855" y2="195" stroke="#ff5a4d"/></g></g>
<text x="870" y="262" class="t b">APP-OWNED ROUTES</text>
<text x="870" y="280" class="t m" text-anchor="middle">/.../projects/...</text>
</svg>`;

const STYLE = `
:root { color-scheme: dark; --bg: #0a0a0b; --panel: #101012; --fg: #ececee; --muted: #9b9ba3; --red: #ff3b30; --link: #ff6b5e; --rule: #2a2a2f; --code: #17171a;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100vh;
  background-image: radial-gradient(60rem 28rem at 50% -8rem, rgba(255,59,48,.14), transparent 70%), linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: auto, 44px 44px, 44px 44px; background-position: center top, center top, center top; }
main { max-width: 46rem; margin: 0 auto; padding: 1.25rem 16px 4rem; }
main.wide { max-width: 64rem; }
header { display: flex; align-items: center; gap: .75rem; padding-bottom: 1rem; border-bottom: 1px dashed var(--rule); margin-bottom: 2.5rem; }
header a.brand { display: flex; align-items: center; gap: .6rem; color: var(--fg); text-decoration: none; font-family: var(--mono); letter-spacing: .18em; font-size: .85rem; font-weight: 700; }
header nav { margin-left: auto; display: flex; gap: 1.25rem; }
header nav a, footer a { color: var(--muted); text-decoration: none; font-family: var(--mono); font-size: .75rem; letter-spacing: .14em; text-transform: uppercase; }
header nav a:hover, footer a:hover { color: var(--fg); }
.mark { filter: drop-shadow(0 0 7px rgba(255,59,48,.55)); display: block; }
header .mark { width: 32px; height: 32px; }
h1 { font-size: clamp(1.9rem, 5vw, 2.6rem); line-height: 1.15; margin: 0 0 .5rem; letter-spacing: -.01em; }
h2 { font-family: var(--mono); font-size: .8rem; letter-spacing: .2em; text-transform: uppercase; color: var(--fg); margin: 2.5rem 0 .75rem; padding-left: .7rem; border-left: 2px solid var(--red); }
p, li { margin: .55rem 0; } ul { padding-left: 1.25rem; } li::marker { color: var(--red); }
.kicker { font-family: var(--mono); font-size: .75rem; letter-spacing: .24em; text-transform: uppercase; color: var(--red); margin: 0 0 .75rem; }
.lead { font-size: 1.2rem; color: #c9c9cf; max-width: 36rem; }
.muted { color: var(--muted); }
a { color: var(--link); text-underline-offset: 3px; }
code { background: var(--code); border: 1px solid var(--rule); padding: .05rem .35rem; border-radius: 4px; font-family: var(--mono); font-size: .86em; }
.hero { text-align: center; padding: 1rem 0 2rem; }
.hero .mark { width: 132px; height: 132px; margin: 0 auto 1.5rem; filter: drop-shadow(0 0 16px rgba(255,59,48,.6)); }
.hero .lead { margin-left: auto; margin-right: auto; }
.diagram { width: 100%; height: auto; display: block; margin: 1.5rem 0 .5rem; }
.diagram .t { font-family: var(--mono); font-size: 10.5px; letter-spacing: .16em; fill: #c9c9cf; text-anchor: middle; }
.diagram .t.b { font-weight: 700; fill: #f2f2f2; } .diagram .t.m { fill: #b8b8c0; font-size: 10px; letter-spacing: .12em; paint-order: stroke; stroke: #0a0a0b; stroke-width: 7px; } .diagram .t.red { fill: #ff5a4d; stroke: none; letter-spacing: .04em; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin-top: 1rem; }
.cards a { display: block; padding: 1rem 1.1rem; border: 1px dashed #3a3a40; background: var(--panel); color: var(--fg); text-decoration: none; border-radius: 4px; }
.cards a:hover { border-color: var(--red); box-shadow: 0 0 0 1px rgba(255,59,48,.35), 0 0 18px rgba(255,59,48,.12); }
.cards b { display: block; font-family: var(--mono); font-size: .78rem; letter-spacing: .14em; text-transform: uppercase; color: var(--red); margin-bottom: .25rem; }
.cards span { color: var(--muted); font-size: .92rem; }
.doc { background: rgba(16,16,18,.7); border: 1px solid var(--rule); border-radius: 6px; padding: 1.5rem 1.5rem 2rem; }
.doc h1 { margin-top: 0; }
footer { margin-top: 3.5rem; padding-top: 1rem; border-top: 1px dashed var(--rule); display: flex; gap: 1.25rem; flex-wrap: wrap; }
.stage { position: relative; margin: 1.75rem 0 1.25rem; aspect-ratio: 16 / 9; overflow: hidden; background: #050506; border: 1px dashed #3a3a40; border-radius: 4px; }
.stage > * { position: absolute; inset: 0; width: 100%; height: 100%; }
.stage-static { display: grid; place-items: center; padding: 1rem; }
.stage .diagram { margin: 0; min-width: 0; max-width: 100%; }
.stage-still { background: url("${HERO_POSTER_PATH}") center / cover no-repeat; }
.stage-video { object-fit: cover; background: transparent; }
.stage-demo { border: 0; background: transparent; }
.stage-note { margin: 0 0 1.5rem; font-family: var(--mono); font-size: .72rem; letter-spacing: .08em; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .stage-video { display: none; } }
@media (max-width: 36rem) { header nav { gap: .9rem; } .doc { padding: 1.1rem 1rem 1.5rem; } .diagram { min-width: 38rem; } .scroll { overflow-x: auto; } }
`;

function page(title: string, description: string, body: string, wide = false) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#0a0a0b">
<link rel="icon" href="${FAVICON}">
<style>${STYLE}</style>
</head>
<body>
<main${wide ? ' class="wide"' : ""}>
<header><a class="brand" href="/">${logo(32)}<span>AP</span></a><nav><a href="/privacy">Privacy</a><a href="${REPO}">GitHub</a></nav></header>
${body}
<footer><a href="/privacy">Privacy policy</a><a href="${REPO}">Source</a><a href="${REPO}/blob/main/LICENSE">MIT license</a></footer>
</main>
</body>
</html>
`;
}

const LANDING_TITLE = "AP (AI Proxy)";
const LANDING_DESCRIPTION = "Give a private application a public HTTPS URL that AI clients can call.";
const HEADLINE = "Give a private application a public HTTPS URL.";
const STAGE_SUMMARY = "AP in motion: an AI client's request reaches AP and waits in its queue. AP cannot reach the private application, so the application polls outward to AP, and the waiting request is delivered as the answer to that poll. The response returns through the same channel.";

const LANDING_REST = `<p>An AI client, agent or service calls the public endpoint. AP hands each request to the private app and returns its response. <strong>AP routes intelligence. It does not provide intelligence.</strong></p>
<h2>Get started</h2>
<div class="cards">
<a href="${REPO}/blob/main/docs/EXAMPLE.md"><b>Example</b><span>Put a tiny app online in five steps.</span></a>
<a href="${REPO}#readme"><b>README</b><span>The API overview and how channels work.</span></a>
<a href="${REPO}/blob/main/docs/ACCOUNTS.md"><b>Accounts</b><span>Sign in with Google or GitHub to get an AP key.</span></a>
</div>
<h2>Signing in</h2>
<p>An AP key proves who you are. You get one by signing in with a Google or GitHub account through the device flow, which asks for a short code and gives you a key once you approve it. See the <a href="/privacy">privacy policy</a> for what AP keeps.</p>
<p class="muted">AP is open source. Source, issues and documentation are on <a href="${REPO}">GitHub</a>.</p>`;

const LEAD = `<p class="lead">A private app connects <strong>outward</strong> to AP, and AI clients call it like any web API. No inbound port, no VPN, no tunnel agent.</p>`;

// Live hero: the interactive demo (/demo) in an <object>, over the same fallbacks. This page has no script of its own:
//   - if /demo cannot load (an HTTP error or a network failure), <object> renders its empty fallback content, so the
//     layers underneath show;
//   - if /demo loads but cannot run the scene (no WebGL, reduced motion, a phone-sized hero, a crash), it shows the
//     recorded video or its still frame itself (see docs/HERO.md), or stays transparent so the layers show through.
// An <iframe> would show the browser's own error page on failure, which is why this is an <object>.
const LIVE_SUMMARY = "Interactive 3D demonstration of AP. Drag to orbit, use the timeline to jump between the nine stages: a request reaches AP and waits in its queue, the private application polls outward, and the queued request is delivered as the answer to that poll.";
const LIVE_HERO = `<section class="hero">
<p class="kicker">AI Proxy / Public Rendezvous</p>
<h1>${HEADLINE}</h1>
${LEAD}
</section>
<figure class="stage" aria-label="${LIVE_SUMMARY}">
<div class="stage-static">${DIAGRAM}</div>
<div class="stage-still"></div>
<object class="stage-demo" type="text/html" data="/demo" aria-label="${LIVE_SUMMARY}"></object>
<figcaption class="sr">${STAGE_SUMMARY}</figcaption>
</figure>
<p class="stage-note muted">Interactive demo · <a href="/demo">full screen</a> · <a href="/?hero=video">watch the video</a> · <a href="/?hero=static">static diagram</a></p>
${LANDING_REST}`;

// Video hero. A stack of layers, so each failure falls back to the next one with no scripts involved:
//   1. the video, when the browser can decode it and the file arrives (muted and looping; no `controls`, because
//      browsers paint an opaque control panel over a video that failed, which would hide the layers below it)
//   2. the still frame from the same render, painted underneath, if the video cannot play
//   3. the static diagram underneath that, if the still cannot load either
// Browsers that do not understand <video> at all, and people who ask for reduced motion, land on layer 2 or 3.
const VIDEO_HERO = `<section class="hero">
<p class="kicker">AI Proxy / Public Rendezvous</p>
<h1>${HEADLINE}</h1>
${LEAD}
</section>
<figure class="stage" aria-label="${STAGE_SUMMARY}">
<div class="stage-static">${DIAGRAM}</div>
<div class="stage-still"></div>
<video class="stage-video" autoplay muted loop playsinline preload="metadata" disablepictureinpicture aria-label="${STAGE_SUMMARY}"><source src="${HERO_VIDEO_PATH}" type="video/mp4"></video>
<figcaption class="sr">${STAGE_SUMMARY}</figcaption>
</figure>
${LANDING_REST}`;

// The original hero: mark, headline and the flow diagram. Served at /?hero=static, and for every visitor when
// the AP_HERO environment variable is "static".
const STATIC_HERO = `<section class="hero">
${logo(132, "AP logo")}
<p class="kicker">AI Proxy / Public Rendezvous</p>
<h1>${HEADLINE}</h1>
${LEAD}
</section>
<div class="scroll">${DIAGRAM}</div>
${LANDING_REST}`;

export type HeroVariant = "live" | "video" | "static";
export const LANDING_PAGES: Record<HeroVariant, string> = {
  live: page(LANDING_TITLE, LANDING_DESCRIPTION, LIVE_HERO, true),
  video: page(LANDING_TITLE, LANDING_DESCRIPTION, VIDEO_HERO, true),
  static: page(LANDING_TITLE, LANDING_DESCRIPTION, STATIC_HERO, true),
};

export const PRIVACY_PAGE = page(
  "AP Privacy Policy",
  "What AP collects when you sign in or use a channel, how long it is kept, and who it is shared with.",
  `<div class="doc">
<h1>Privacy policy</h1>
<p class="muted">AP (AI Proxy) at apchannels.dev. Last updated ${PRIVACY_UPDATED}.</p>
<p>This policy explains what information AP handles, why, and how long it is kept. AP is a small open-source service run by an individual maintainer, and it is built to collect as little as it can.</p>

<h2>In short</h2>
<ul>
<li><strong>Signing in is optional.</strong> If you never sign in, AP keeps no account or profile about you.</li>
<li><strong>If you sign in</strong>, AP stores only your account id and email address (or GitHub username), hashes of your AP keys, and a few usage counts. It reads nothing else from your Google or GitHub account.</li>
<li><strong>Channel traffic is not kept.</strong> Requests and responses are held only while they are delivered, for at most 15 minutes, and are never logged.</li>
<li><strong>No tracking.</strong> No cookies, analytics or advertising, and your information is never sold or used to train models.</li>
<li><strong>You can delete your account yourself, at any time</strong>, with one request. See <a href="#delete">Your choices</a>.</li>
</ul>

<h2>What AP collects</h2>
<p><strong>If you sign in with Google.</strong> AP asks Google for the <code>openid</code> and <code>email</code> scopes only. It receives your Google account&rsquo;s stable id and your email address, and only if Google reports the email as verified. AP keeps that id as your account identifier and your email as the name shown for your account. AP does not read your name, photo, contacts, calendar, mail or anything else in your Google account, and it does not keep Google&rsquo;s access token after sign-in.</p>
<p><strong>If you sign in with GitHub.</strong> AP receives your GitHub user id and username, and keeps them in the same way. It asks GitHub for no extra permissions.</p>
<p><strong>AP keys.</strong> When you sign in AP creates a key. AP stores only a one-way hash of it, with the optional label you gave it and when it was created and last used. The key itself is shown to you once.</p>
<p><strong>What you do with your account.</strong> AP records which channels and services your account created, and a count of channels created per day for the last 8 days, so it can enforce limits and let the operator investigate abuse.</p>
<p><strong>Network addresses.</strong> AP uses your IP address to rate-limit sign-ins and channel creation. The address is part of a short-lived counter that expires within an hour.</p>
<p><strong>Traffic through channels.</strong> A channel carries requests from clients to a private application and responses back. AP holds a request and its response only while they are being delivered, for at most 15 minutes. AP does not log request or response bodies, and it removes authorization headers, AP keys, access tokens, downstream secrets and cookies from its logs.</p>
<p><strong>Logs.</strong> AP writes a standard log line for each request: the method, the URL including any query string, the client IP address, the response status and the time taken. It also writes structured events such as key creation, rejected requests and errors, each with an event name, a time, a request id and, where relevant, your account id (for Google accounts this is the Google id, not your email) and never your keys. Because both carry the request id, a person with access to the logs could connect an IP address to an account. AP&rsquo;s hosting provider also keeps its own request logs.</p>

<h2>What AP does not do</h2>
<ul>
<li>It does not sell your information, use it for advertising or profiling, or share it with advertisers.</li>
<li>It does not use it to train machine-learning models.</li>
<li>It sets no cookies and includes no analytics or advertising scripts on its own pages.</li>
<li>It does not link a Google account to a GitHub account, even if they share an email address. They are separate accounts.</li>
</ul>
<p>AP&rsquo;s use of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements. Your Google information is used only to sign you in and to identify your account.</p>

<h2>How long it is kept</h2>
<ul>
<li><strong>Account record</strong> (account id, email or username, when it was created): kept while your account exists, until you delete it.</li>
<li><strong>AP keys</strong> (hashes): kept until you revoke them, delete your account, or an operator disables it.</li>
<li><strong>Sign-in codes in progress:</strong> deleted when you finish or when the code expires, within 30 minutes.</li>
<li><strong>Channel and request data:</strong> expires 15 minutes after a channel goes quiet.</li>
<li><strong>Channel ownership records:</strong> 24 hours. <strong>Daily usage counts:</strong> 8 days.</li>
<li><strong>Rate-limit counters:</strong> up to an hour.</li>
<li><strong>Logs:</strong> kept by the hosting provider for as long as its own policy allows.</li>
</ul>

<h2>Who handles it</h2>
<p>AP runs on infrastructure from service providers that process data on its behalf: Vercel hosts the service, and Upstash provides the Redis database that holds the records above. When you sign in, Google or GitHub receives the sign-in request under their own privacy policies. AP does not share your information with anyone else except where the law requires it.</p>

<h2 id="delete">Your choices</h2>
<ul>
<li><strong>Delete your account.</strong> Send <code>DELETE /account</code> with your AP key and the body <code>{"confirm":"delete-my-account"}</code>. AP then removes your account record, all your AP keys, your channel and service ownership records and your usage counts, and your keys stop working at once. See <a href="${REPO}/blob/main/docs/ACCOUNTS.md#delete-your-account">the accounts guide</a> for a ready-to-run command. Signing in again later starts a new, empty account.</li>
<li><strong>Revoke a single key</strong> with <code>DELETE /keys/&lt;keyId&gt;</code>, or list your keys with <code>GET /keys</code>.</li>
<li><strong>Lost your key?</strong> <a href="${REPO}/issues">Open an issue</a> asking for removal and the operator can delete the account for you. Don&rsquo;t include any keys or secrets. If you would rather not post publicly, say so in the issue and the maintainer will arrange a private way to continue.</li>
<li><strong>Ask what AP holds</strong> about you the same way.</li>
<li>You can remove AP&rsquo;s access to your Google account at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, or to your GitHub account in GitHub&rsquo;s Applications settings.</li>
</ul>
<p><strong>What deleting does not remove.</strong> Log lines already written (see Logs above) are kept by AP&rsquo;s hosting provider under its own retention, and AP writes one log event recording that an account id was deleted. Channel data that is still in flight expires on its own within 15 minutes.</p>

<h2>Security</h2>
<p>Keys and secrets are stored only as hashes, traffic uses HTTPS, and access to account data is limited to the operator. To report a vulnerability, follow <a href="${REPO}/blob/main/SECURITY.md">SECURITY.md</a>. No service can promise perfect security, and if a breach affected you, AP will tell affected users.</p>

<h2>Children</h2>
<p>AP is a developer tool and is not directed at children under 13.</p>

<h2>Changes</h2>
<p>When this policy changes, the date at the top changes, and material changes are noted in the <a href="${REPO}/blob/main/CHANGELOG.md">changelog</a>.</p>

<h2>Contact</h2>
<p>Use <a href="${REPO}/issues">GitHub issues</a> for privacy questions and requests.</p>
</div>`,
);
