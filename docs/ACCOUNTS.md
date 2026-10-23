# Signing in with GitHub or Google

An **AP key** proves who you are. It looks like `apk_...`.
You get one by signing in with GitHub, or with Google if the operator turned it on. It takes about one minute.

Do you need one? Only if the AP you use says `account_required`.
Without a key, AP works the same as before.

## Get your key

### The easy way: the helper

```bash
git clone https://github.com/krazybean/AP.git
cd AP
npm run login
```

It prints:

```text
1. Open https://github.com/login/device
2. Type this code: WDJB-MJHT
3. Click Authorize. This window waits for you...
```

Do those three things in your browser. Then the helper prints your key:

```text
Signed in as your-name. Your AP key:

  apk_...
```

Copy it somewhere safe. **Anyone with your key can act as you.**

### The long way: by hand

These are the same steps the helper does.

**Step 1.** Ask AP for a code.

```bash
curl -s -X POST https://ap.krazybean.com/auth/device
```

You get:

```json
{"code":"WDJB-MJHT","url":"https://github.com/login/device","deviceId":"apd_...","expiresIn":900,"interval":5}
```

**Step 2.** Open the `url` in your browser. Type the `code`. Click **Authorize**.

**Step 3.** Ask AP for your key. Use the `deviceId` from step 1.

```bash
curl -s -X POST https://ap.krazybean.com/auth/device/token \
  -H 'content-type: application/json' \
  -d '{"deviceId":"apd_..."}'
```

| You get | It means |
| --- | --- |
| `{"status":"waiting"}` | You haven't clicked Authorize yet. Wait 5 seconds and run step 3 again. |
| `{"key":"apk_...","login":"your-name"}` | Done. That's your key. |
| `sign_in_expired` | You took more than 15 minutes, or already got the key. Start again at step 1. |
| `sign_in_denied` | You clicked Cancel on GitHub. Start again at step 1. |

### Signing in with Google

Add `"provider":"google"` to both calls. Without `provider`, AP uses GitHub.

```bash
curl -s -X POST https://ap.krazybean.com/auth/device \
  -H 'content-type: application/json' -d '{"provider":"google"}'
```

The reply has the same shape; its `url` is Google's device page (`https://www.google.com/device`). Then poll with the same `provider`:

```bash
curl -s -X POST https://ap.krazybean.com/auth/device/token \
  -H 'content-type: application/json' \
  -d '{"deviceId":"apd_...","provider":"google"}'
```

AP remembers which provider each sign-in started with. A poll that names a different one gets `400 provider_mismatch`. A Google account whose email Google has not verified gets `sign_in_denied`.

Your Google email is shown as your `login`. GitHub and Google are separate accounts, even for the same person: AP never links them by email, and channels and services made under one are not visible to the other.

## Use your key

Send it as the `X-AP-Key` header on every call your app makes to AP.

```bash
curl -s -X POST https://ap.krazybean.com/channels -H "X-AP-Key: apk_..."
```

The example app reads it from `AP_KEY`:

```bash
export AP_KEY='apk_...'
node examples/hello-app.mjs
```

People who call your app **don't** need a key. Only your app does.

What needs the key, when AP requires accounts:

- creating a channel (`POST /channels`)
- waiting for requests and answering them (`/channels/.../next`, `/channels/.../responses/...`)
- making and revoking client tokens (`/channels/.../access-tokens`)
- creating services and binding channels to them

What never needs it: `/auth/...` (that's how you get it), `/c/...` and isolated hostnames (your app's visitors), `GET /services/:name`, and `/health`.

## Rules

- You can have **10 live channels** at once. A channel stops counting once it closes (15 minutes after its app goes quiet).
- A channel you made with your key belongs to you. Another key can't poll it or answer for it: `403 channel_not_owned`.
- The same goes for services: `403 service_not_owned`.
- Keys don't expire. Sign in again to get another one, for another computer.

## Manage your keys

See your keys (never the secret part):

```bash
curl -s https://ap.krazybean.com/keys -H "X-AP-Key: apk_..."
```

Delete one you lost or leaked, using its `keyId` from that list:

```bash
curl -s -X DELETE https://ap.krazybean.com/keys/<keyId> -H "X-AP-Key: apk_..."
```

## If something goes wrong

| You see | It means | Do this |
| --- | --- | --- |
| `account_required` | This AP needs a key | Get one above, then set `AP_KEY` |
| `account_key_invalid` | The key is wrong, deleted, or the account is turned off | Run `npm run login` again |
| `account_channel_limit` | You already have 10 live channels | Stop one of your apps, or wait 15 minutes |
| `channel_not_owned` | That channel was made with a different key | Use the key that made it |
| `sign_in_not_configured` | This AP doesn't have that provider's sign-in turned on | Ask whoever runs it |
| `unknown_provider` | `provider` was something other than `github` or `google` | Use one of those |
| `provider_mismatch` | You polled with a different provider than you started with | Poll with the same `provider` |
| `github_error` / `google_error` | The provider could not be reached or refused AP's request | Try again in a minute |
| `account_disabled` | The operator turned your account off | Ask whoever runs it |

---

## For operators: turning it on

### 1. Make a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Name: `AP`. Homepage URL: your AP address. Callback URL: the same address (it isn't used).
3. Click **Register application**.
4. Tick **Enable Device Flow** and save.
5. Copy the **Client ID**. You don't need a client secret.

### 1b. Optional: make a Google OAuth client

1. In the Google Cloud console, open **APIs & Services → OAuth consent screen** and configure it (external is fine). The only scopes AP asks for are `openid` and `email`.
2. Go to **Credentials → Create credentials → OAuth client ID**.
3. Set **Application type** to **TVs and Limited Input devices**. Name it `AP`.
4. Copy the **Client ID** and **Client secret**. Unlike GitHub, Google's device flow needs the secret. AP keeps it on the server and never logs or returns it.

Google's consent screen starts in *Testing* mode, where only listed test users can sign in. Publish the app to let anyone in.

### 2. Set the environment variables

In Vercel: **Settings → Environment Variables**, then redeploy.

| Key | Value | What it does |
| --- | --- | --- |
| `AP_GITHUB_CLIENT_ID` | the Client ID | Turns on sign-in. Without it, `/auth/device` answers `503 sign_in_not_configured`. |
| `AP_GOOGLE_CLIENT_ID` | the Google Client ID | Turns on Google sign-in. Needs `AP_GOOGLE_CLIENT_SECRET` too; if either is missing, Google is off and `provider: "google"` answers `503 sign_in_not_configured`. |
| `AP_GOOGLE_CLIENT_SECRET` | the Google Client secret | Server-side only. |
| `AP_REQUIRE_ACCOUNT` | `true` | Requires a key on every management and downstream call. Leave it unset while testing to allow anonymous use. |
| `AP_ADMIN_TOKEN` | a long random string | Turns on the admin endpoints below. |
| `AP_ACCOUNT_CHANNEL_LIMIT` | `10` (default) | Live channels per account. |

Accounts need the Redis broker in production; the memory broker forgets them on restart.

Turn sign-in on first, let people get keys, and only then set `AP_REQUIRE_ACCOUNT=true`.
Channels made before that, without a key, can't be polled with a key once it's on; they close on their own within 15 minutes.

### Who an account is

An account id is the GitHub user id for GitHub sign-ins (`1001`), and `google:` plus Google's stable `sub` for Google sign-ins (`google:110248495921238986420`). Google's email is only the display `login`; it can change and is never used to find or link accounts. The internal field is still called `githubId` in storage, audit events and admin output. Existing GitHub accounts need no migration.

### 3. Watch for anything odd

All admin calls need `Authorization: Bearer <AP_ADMIN_TOKEN>`. Without it they answer `404`.

| Call | What you get |
| --- | --- |
| `GET /admin/accounts` | every account: id (`githubId`), login, when it joined, whether it's turned off |
| `GET /admin/accounts/<id>` | its keys (with last use), its live channels, and channels created per day for the last 8 days |
| `POST /admin/accounts/<id>/disable` | turns the account off and deletes its keys; its apps stop at their next call |
| `POST /admin/accounts/<id>/enable` | lets the person sign in again (they need a new key) |

`/metrics` also counts sign-ins, keys created and revoked, and rejections by reason (`missing`, `invalid`, `not_owned`, `limit`, `disabled`).
The audit log records `account.key_created`, `account.key_revoked`, `account.disabled`, `account.enabled` and `account.rejected`, with the account id but never the key.
