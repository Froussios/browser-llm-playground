# Browser LLM Playground

A single static page for raw testing of Chrome's built-in **Prompt API** (`LanguageModel`, backed by
Gemini Nano running on your machine). Type a prompt, read the reply, keep the conversation going.
No server, no build step, no dependencies: just `index.html`, `style.css` and `app.js`.

**Live page:** https://froussios.github.io/browser-llm-playground/ (once GitHub Pages is enabled, see below)

## Features

- Multi-turn chat against one `LanguageModel` session, created automatically on the first send.
- Streaming (`promptStreaming`) or one-shot (`prompt`), with an Abort button.
- Settings as plain form controls with defaults you can ignore: system prompt, sampling
  (temperature/top-K sliders when the browser exposes `LanguageModel.params()`, otherwise a
  `samplingMode` dropdown), and expected language.
- Several sessions side by side: **New session**, **Clone** (forks the current context), **Destroy**,
  and a dropdown to switch between them. Each session keeps its own transcript.
- Per reply: total time, time to first chunk, chunk count, characters, and tokens consumed.
- Session token usage and quota, plus a warning when the context window overflows.
- A raw log of every API call with the exact options passed, the result or error, and timing.
- Feature detection throughout, because property and option names have changed between Chrome
  versions (`inputUsage`/`contextUsage`, `temperature`/`samplingMode`, delta vs cumulative streaming).

## Enabling the Prompt API in Chrome

The page reports what your browser exposes, so open it first and read the status bar. If
**LanguageModel** says `present` and **Availability** says `available`, there is nothing to set up.

1. Use desktop Google Chrome 148 or newer on Windows, macOS, Linux or ChromeOS. The Prompt API
   shipped to stable in Chrome 148. Other Chromium-based browsers may not include it. Update
   Chrome at `chrome://settings/help`.
2. On Chrome 148 or newer the API is normally on without flags. If `LanguageModel` is still
   missing, open `chrome://flags`, search for "Prompt API" and "on device", enable any matching
   entries that exist, and relaunch. Flag names change between versions and some builds have
   none. Older builds used `#prompt-api-for-gemini-nano` and
   `#optimization-guide-on-device-model` (set to "Enabled BypassPerfRequirement").
3. If **Availability** says `downloadable`, send a prompt. That starts the model download and the
   progress bar fills in.
4. If **Availability** says `unavailable`, the device or profile can't run the model. Typical
   causes are too little free disk space, an unsupported GPU or CPU, or an enterprise policy.
   `chrome://on-device-internals` shows the model status and the exact reason. If that page is
   blocked, enable internal debug pages at `chrome://chrome-urls` first.

If your Chrome version only exposes the API to web pages through an origin trial, register the
origin `https://froussios.github.io` for the Prompt API trial and paste the token into the
commented-out `<meta http-equiv="origin-trial">` tag in `index.html`.

## Hosting

The page is hosted on **GitHub Pages**, which is free for public repositories. There is no build,
so Pages serves the files straight from the branch.

One-time setup by the repository owner:

1. Go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the branch (for example `main`) and the folder `/ (root)`, then **Save**.

After a minute the page is live at https://froussios.github.io/browser-llm-playground/.
Every push to that branch redeploys it. The empty `.nojekyll` file tells Pages to serve the
files as they are.

### Running locally

Open `index.html` directly in Chrome, or serve the folder with any static server:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Both `file://` and `http://localhost` work.
