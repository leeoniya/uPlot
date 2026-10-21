# Manual Chrome profiling

The recorder attaches to an existing, visible Chrome browser. It does not download or launch a browser.
It requires Node.js 22.4 or later and uses built-in `fetch` and `WebSocket`. No installs are necessary for the recorder.

## Safety and limits

- Never expose the debugging endpoint publicly. The endpoint gives clients control of the browser.
- Use a new, dedicated browser profile. Do not log in to personal accounts in this profile.
- Protect trace files before you share them. Traces can contain sensitive URLs and scripts.
- Keep only the target tab open. Tracing covers the entire browser, not only the target tab.
- Keep recordings short. The recorder uses `recordUntilFull` with a 64 MiB buffer and warns about data loss.
- Close DevTools before recording. This avoids debugger overhead from asynchronous stack tracking.
- Do not run a normal Performance recording at the same time.

The temporary profile has different extensions from your everyday profile. These differences can affect performance comparisons.
CPU sampling remains enabled. The recorder does not tune the sampling rate.

## Start the browser and demo

1. In a terminal at the repository root, start the demo server:

   ```sh
   npm run demos
   ```

2. In a separate terminal, launch your installed Chrome browser.

   CAUTION: Before launch, make sure that `/tmp/uplot-manual-profile` is a new directory dedicated to this task.
   Do not use your everyday profile directory.

   ```sh
   google-chrome \
     --remote-debugging-address=127.0.0.1 \
     --remote-debugging-port=9222 \
     --user-data-dir=/tmp/uplot-manual-profile \
     http://127.0.0.1:3030/demos/legend-selection.html
   ```

   This Linux example uses `google-chrome`. Chromium or the full path to a compatible browser executable can replace it.
   Modern Chrome requires a nondefault profile for remote debugging.

   Do not add `--no-sandbox` or wildcard origin flags.

## Record the interaction

1. In another terminal at the repository root, start the recorder:

   ```sh
   node scripts/profile-manual.mjs --output trace.json
   ```

2. At the start prompt, press Enter to start recording.
3. In the browser, perform the interaction that you want to measure.
4. In the recorder terminal, press Enter again to stop recording.
5. Wait for the recorder to finish saving the trace.

Before recording starts, Ctrl+C cancels. During recording, Ctrl+C stops recording and saves the trace.
The recorder reads the trace through `IO.read` in bounded chunks.
It refuses to overwrite an existing output file. On error, it removes only the partial output file that it created.

## CLI and stack comparison

```text
node scripts/profile-manual.mjs [--endpoint http://127.0.0.1:9222] [--output trace.json] [--stacks] [--help]
```

The default endpoint is `http://127.0.0.1:9222`.
The recorder gets the browser WebSocket URL from `/json/version` at that endpoint.
Without `--output`, it saves `manual-profile-<timestamp>.json` in the current directory.
`--help` shows usage information.

By default, the recorder omits `disabled-by-default-devtools.timeline.stack`.
`--stacks` adds this category for an A/B comparison. CPU sampling remains enabled in both recordings.

After the first recording, repeat the same interaction with the same browser state:

```sh
node scripts/profile-manual.mjs --stacks --output trace-stacks.json
```

## Inspect the trace

1. After recording ends, open Chrome DevTools.
2. Open the **Performance** panel.
3. Use **Load profile** to import the output JSON file.
4. If necessary, select the target renderer or thread.

Validation limit: automated tests use a mock CDP connection. A live Chrome recording and Performance import still need verification.

## Cleanup

1. Close the dedicated browser completely.
2. In the demo server terminal, press Ctrl+C to stop the server.
3. After the browser and server stop, remove only the dedicated profile directory:

   ```sh
   rm -rf -- /tmp/uplot-manual-profile
   ```

The recorder does not remove browser profiles automatically.

4. Keep the trace files until you no longer need them.
5. When you no longer need the example trace files, remove them from the output directory:

   ```sh
   rm -- trace.json trace-stacks.json
   ```
