# Landing page hero

The home page (`/`) opens with an interactive 3D demonstration of AP's request flow: drag to orbit, jump between the nine stages with the timeline, pause and replay. It is the same demo that runs full screen at `/demo`.

## What it shows

A request reaches AP and waits in its queue. AP cannot reach the private application, so the application polls outward, and the queued request is delivered as the answer to that poll. The private application runs it locally and the result returns through AP on the same channel. It is the nine-stage lifecycle described in the README.

## How it is built

- **The landing page has no script.** It is still static HTML with inline CSS. The demo sits in an `<object>` that loads `/demo`.
- **`/demo` is a separate page** with its own Content Security Policy: `script-src 'self' blob:` (`blob:` is for the 3D text renderer's worker, which it builds from its own code), nothing from any other origin, and `frame-ancestors 'self'` so only AP's own pages can frame it. It is the only page AP serves that runs a script.
- **Everything is served by AP.** The demo's files (`/demo-assets/<name>-<hash>.js`, `.css`, fonts) and the hero media (`/hero-<hash>.mp4`, `.jpg`) are embedded in the build (`src/demo-assets.ts`, `src/hero-media.ts`), so the page works the same on every host and does not depend on how a platform maps static files. File names carry a content hash, so they are cached for a year. The demo is stored gzipped (about 420 KiB) and sent with `Content-Encoding: gzip`; clients that do not accept gzip get the decoded file. The video route answers `Range` requests, which Safari needs.
- **Behaving inside a page.** The mouse wheel scrolls the page until you click the demo, and only then zooms it. Vertical swipes on a touch screen still scroll the page. Rendering stops while the hero is scrolled out of view or the tab is hidden.

## How it falls back

The hero is a stack of layers, bottom to top: the flow diagram (inline SVG), the still frame from the recorded render, and the demo. Each failure falls to the next layer:

| What goes wrong | What the visitor sees |
| --- | --- |
| `/demo` returns an error, or the network fails | the still frame (an `<object>` that fails renders its empty fallback, where an `<iframe>` would show a browser error page) |
| `/demo` loads but its script does not run | the still frame (the page stays transparent) |
| no WebGL, or the scene throws | the recorded video, played by the demo page itself |
| a phone-sized hero (640 px or narrower) | the recorded video; open `/demo` for the live scene |
| the visitor asks for reduced motion | the still frame only, no animation |
| the still cannot load either | the flow diagram |

The headline and the text below the hero are ordinary HTML in every case. The full-screen `/demo` page behaves the same way, except that phone-sized screens run the live scene.

## Switching it off

- `?hero=video` shows the **video hero** (the recorded render over the still and diagram, no script anywhere on the page). `?hero=static` shows the **static hero**: the AP mark, the headline and the flow diagram, exactly as before any of this, with no video, demo or media in the markup. `?hero=live` is the default. Use them to preview a backout or to link someone who cannot run the demo.
- `AP_HERO=video` or `AP_HERO=static` makes that version the default for every visitor. Set it in the deployment environment and redeploy. Any other value, or none, means `live`. A `?hero=` query still overrides it.

## The video: why it has no controls

The video has no player controls on purpose: browsers paint an opaque control panel over a video that failed to load, which would hide the fallback layers beneath it. Visitors who ask for reduced motion do not get it at all.

## Replacing the demo or the video

The demo is built from a separate project (React Three Fiber, Vite). Build it with the `/demo-assets/` base and embed the result:

```bash
# in the demo project
npm run build
# in AP
node scripts/embed-demo.mjs path/to/demo/dist
```

To replace the recorded video and still frame:

```bash
node scripts/embed-hero.mjs hero.mp4 poster.jpg
```

Both rewrite generated files under `src/`, then run `npm test`. Keep the video small (the current one is 1.6 MiB: H.264 High, `yuv420p`, 1280x720, 24 fps, `+faststart`); it ships inside the serverless bundle.
