# Your first AP app, step by step

You will put a tiny app on your computer onto the internet, then call it.
It takes about five minutes. You need Node.js 24 and a terminal.

## The idea in one picture

```text
someone on the internet  →  AP  →  your app on your computer
someone on the internet  ←  AP  ←  your app's answer
```

Your app calls AP first. That is why it works without opening any ports.

## Step 1: Get the code

```bash
git clone https://github.com/krazybean/AP.git
cd AP
```

## Step 2: Start your app

```bash
node examples/hello-app.mjs
```

You will see something like this:

```text
Your app is live at: https://ap.krazybean.com/c/5f3dd3e2-0486-4210-b9f1-24a871bd7e3c
Try it: curl "https://ap.krazybean.com/c/5f3dd3e2-0486-4210-b9f1-24a871bd7e3c/hello?name=Sam"
```

Leave this terminal open. Your app is running in it.

## Step 3: Call your app

Open a **second** terminal. Copy the `Try it` line from step 2 and run it:

```bash
curl "https://ap.krazybean.com/c/<your-channel>/hello?name=Sam"
```

You get:

```json
{"message":"Hello, Sam!"}
```

Look at the first terminal. It printed:

```text
Someone asked for GET /hello?name=Sam
```

That was your app answering. 🎉

## Step 4: Change the answer

Open [examples/hello-app.mjs](../examples/hello-app.mjs) and find this line:

```js
? { statusCode: 200, body: { message: `Hello, ${name}!` } }
```

Change `Hello` to `Hi there`. Save the file.

In the first terminal, press **Ctrl+C** to stop the app, then start it again:

```bash
node examples/hello-app.mjs
```

You get a **new** address. Run the new `Try it` line. Now it says `Hi there, Sam!`.

## Step 5: Stop

Press **Ctrl+C** in the first terminal. Your address stops working.
If you leave the app idle for 15 minutes, AP closes the address on its own.

## If something goes wrong

| You see | It means | Do this |
| --- | --- | --- |
| `downstream_timeout` | Your app wasn't running | Start step 2 again |
| `channel_not_found` | The address is old | Use the new address from step 2 |
| `Could not get an address: channel_rate_limited` | You made more than 10 addresses this hour | Wait an hour, then start step 2 again |
| `Could not get an address: account_required` | This AP needs a key | Get one with `npm run login` ([ACCOUNTS.md](ACCOUNTS.md)), run `export AP_KEY='apk_...'`, then start step 2 again |

## What next

- Connect a real app, in any language: [INTEGRATION.md](INTEGRATION.md).
- Give each app its own web address: [SETUP.md](SETUP.md).
