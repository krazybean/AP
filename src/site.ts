// Static pages served on AP's own address: a landing page and the privacy policy.
// Inline CSS only, no scripts, no external requests, so the page CSP can stay `default-src 'none'`.

const REPO = "https://github.com/krazybean/AP";
export const PRIVACY_UPDATED = "October 23, 2026";

function page(title: string, description: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #1c1c1e; --muted: #5b5b62; --link: #0b57d0; --rule: #e3e3e8; --code: #f3f3f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #131316; --fg: #ececf0; --muted: #a0a0aa; --link: #8ab4f8; --rule: #2a2a31; --code: #1d1d22; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 3rem 1rem 4rem; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .5rem; }
h2 { font-size: 1.25rem; margin: 2.25rem 0 .5rem; }
p, li { margin: .5rem 0; }
.lead { font-size: 1.2rem; color: var(--muted); }
.muted { color: var(--muted); }
a { color: var(--link); }
code { background: var(--code); padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
pre { background: var(--code); padding: 1rem; border-radius: 8px; overflow-x: auto; }
nav, footer { color: var(--muted); font-size: .9rem; }
nav { margin-bottom: 2.5rem; } nav a { margin-right: 1rem; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); }
</style>
</head>
<body>
<main>
<nav><a href="/">AP</a><a href="/privacy">Privacy</a><a href="${REPO}">GitHub</a></nav>
${body}
<footer><a href="/privacy">Privacy policy</a> · <a href="${REPO}">Source</a> · <a href="${REPO}/blob/main/LICENSE">MIT license</a></footer>
</main>
</body>
</html>
`;
}

export const LANDING_PAGE = page(
  "AP (AI Proxy)",
  "Give a private application a public HTTPS URL that AI clients can call.",
  `<h1>AP (AI Proxy)</h1>
<p class="lead">Give a private application a public HTTPS URL that AI clients can call.</p>
<p>A private application connects <strong>outward</strong> to AP, and AP gives it a public HTTPS endpoint. An AI client, agent or service calls that endpoint like any web API, and AP hands each request to the private app and returns its response. The private app needs no inbound port, no VPN and no tunnel agent.</p>
<p><strong>AP routes intelligence. It does not provide intelligence.</strong></p>
<h2>Get started</h2>
<ul>
<li><a href="${REPO}/blob/main/docs/EXAMPLE.md">Put a tiny app online in five steps</a></li>
<li><a href="${REPO}#readme">README and API overview</a></li>
<li><a href="${REPO}/blob/main/docs/ACCOUNTS.md">Signing in with GitHub or Google to get an AP key</a></li>
</ul>
<h2>Signing in</h2>
<p>An AP key proves who you are. You get one by signing in with a Google or GitHub account through the device flow, which asks for a short code and gives you a key once you approve it. See the <a href="/privacy">privacy policy</a> for what AP keeps.</p>
<p class="muted">AP is open source. Source, issues and documentation are on <a href="${REPO}">GitHub</a>.</p>`,
);

export const PRIVACY_PAGE = page(
  "AP Privacy Policy",
  "What AP collects when you sign in or use a channel, how long it is kept, and who it is shared with.",
  `<h1>Privacy policy</h1>
<p class="muted">AP (AI Proxy) at apchannels.dev. Last updated ${PRIVACY_UPDATED}.</p>
<p>This policy explains what information AP handles, why, and how long it is kept. AP is a small open-source service run by an individual maintainer, and it is built to collect as little as it can.</p>

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
<li><strong>Account record</strong> (account id, email or username, when it was created): kept while your account exists, until you ask for it to be removed.</li>
<li><strong>AP keys</strong> (hashes): kept until you revoke them or the account is disabled.</li>
<li><strong>Sign-in codes in progress:</strong> deleted when you finish or when the code expires, within 30 minutes.</li>
<li><strong>Channel and request data:</strong> expires 15 minutes after a channel goes quiet.</li>
<li><strong>Channel ownership records:</strong> 24 hours. <strong>Daily usage counts:</strong> 8 days.</li>
<li><strong>Rate-limit counters:</strong> up to an hour.</li>
<li><strong>Logs:</strong> kept by the hosting provider for as long as its own policy allows.</li>
</ul>

<h2>Who handles it</h2>
<p>AP runs on infrastructure from service providers that process data on its behalf: Vercel hosts the service, and Upstash provides the Redis database that holds the records above. When you sign in, Google or GitHub receives the sign-in request under their own privacy policies. AP does not share your information with anyone else except where the law requires it.</p>

<h2>Your choices</h2>
<ul>
<li>See and delete your AP keys at any time with <code>GET /keys</code> and <code>DELETE /keys/&lt;keyId&gt;</code>. See <a href="${REPO}/blob/main/docs/ACCOUNTS.md">the accounts guide</a>.</li>
<li>Ask for your account record to be removed, or ask what AP holds about you, by <a href="${REPO}/issues">opening an issue</a>. Don&rsquo;t include any keys or secrets in it. If you would rather not post publicly, say so in the issue and the maintainer will arrange a private way to continue.</li>
<li>You can remove AP&rsquo;s access to your Google account any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, or to your GitHub account in GitHub&rsquo;s Applications settings.</li>
</ul>

<h2>Security</h2>
<p>Keys and secrets are stored only as hashes, traffic uses HTTPS, and access to account data is limited to the operator. To report a vulnerability, follow <a href="${REPO}/blob/main/SECURITY.md">SECURITY.md</a>. No service can promise perfect security, and if a breach affected you, AP will tell affected users.</p>

<h2>Children</h2>
<p>AP is a developer tool and is not directed at children under 13.</p>

<h2>Changes</h2>
<p>When this policy changes, the date at the top changes, and material changes are noted in the <a href="${REPO}/blob/main/CHANGELOG.md">changelog</a>.</p>

<h2>Contact</h2>
<p>Use <a href="${REPO}/issues">GitHub issues</a> for privacy questions and requests.</p>`,
);
