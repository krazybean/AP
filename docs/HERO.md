# Landing page hero

The home page (`/`) opens with a looping video of AP's request flow, rendered from a three-dimensional model of the system. The video is muted, loops and plays inline. It has no player controls on purpose: browsers paint an opaque control panel over a video that failed to load, which would hide the fallbacks below. Visitors who ask for reduced motion do not get the video at all.

## What the video shows

A request reaches AP and waits in its queue. AP cannot reach the private application, so the application polls outward, and the queued request is delivered as the answer to that poll. The private application runs it locally and the result returns through AP on the same channel. It is the nine-stage lifecycle described in the README.

## How it falls back

The hero is a stack of layers, so a failure drops to the next one without any scripts:

1. **The video**, when the browser can decode it (H.264 in MP4) and the file arrives.
2. **The still frame** from the same render, painted underneath the video. It shows if the video cannot play, in browsers without `<video>` support, and for visitors who ask for reduced motion.
3. **The flow diagram** (inline SVG), underneath the still. It shows if the still cannot load either.

The headline and the text below the hero are ordinary HTML in every case.

## Switching the video off

- `AP_HERO_VIDEO=off` (also `false` or `0`) serves the **static hero** to every visitor: the AP mark, the headline and the flow diagram, exactly as before the video. There is no video, source or poster in the markup. Set it in the deployment environment and redeploy.
- `/?hero=static` shows the static hero on demand, whatever the variable says. Use it to preview the backout or to link someone who cannot play the video.

## How the media is served

The video and still are embedded in the build (`src/hero-media.ts`) and served by AP at `/hero-<hash>.mp4` and `/hero-<hash>.jpg`. Embedding means the page works the same on every host and does not depend on how a platform maps static files. The names carry a hash of the content, so they are cached for a year and a new render gets a new URL automatically. The video route answers `Range` requests (Safari will not play a video without them) and, like the pages, is never served on isolated channel hostnames.

The landing page's Content Security Policy adds `media-src 'self'` and `img-src 'self'`. It still has `default-src 'none'`, no scripts and no external requests.

## Replacing the video

Render a new loop and a poster frame, then regenerate the module:

```bash
node scripts/embed-hero.mjs hero.mp4 poster.jpg
npm test
```

Keep the video small. It is shipped inside the serverless bundle and every kilobyte is sent to every first-time visitor; the current one is well under 2 MiB. The encoding that works well is H.264 High profile, `yuv420p`, 1280x720, 24 fps, with `+faststart` so playback can begin before the whole file has arrived.
