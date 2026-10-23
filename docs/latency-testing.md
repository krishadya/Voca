# Dictation latency checks

Quit other running copies of Voca, then run `npm run dev` from the repository.
Development diagnostics contain session IDs, timings, byte counts and lifecycle
metadata, not audio, transcripts, selected-text contents or API keys. They are
disabled in packaged builds and are not persisted by Voca or sent anywhere.

Optionally capture your local terminal output:

```sh
npm run dev 2>&1 | tee /tmp/voca-latency-after.log
```

## Read the timings

Look for single-line `[ptt ...] latency` records with the same `sessionId` and
`mode`. All durations are milliseconds. These stages overlap; do not sum them.

| Stage | Measures |
| --- | --- |
| `native-observed-to-electron-release` | Fn helper observation to Electron handling release; existing native diagnostic timestamp has 1 ms resolution. Not hardware switch latency. |
| `release-to-stop-request` | Electron release handling to renderer stop request. |
| `release-to-recorder-stop` | Electron release handling to MediaRecorder's stop event. |
| `recorder-finalization` | Renderer stop request to stop event. |
| `recorder-stop-to-audio-ready` | Stop event through Blob construction and ArrayBuffer conversion. |
| `audio-ipc` | Ready ArrayBuffer to main-process audio receipt. |
| `groq-prepare` / `gemini-prepare` | Key lookup and request-body preparation. |
| `groq-request` / `gemini-request` | Fetch through response headers: includes networking, upload and provider response wait, not an isolated server inference metric. |
| `groq-decode` / `gemini-decode` | Response-body download and JSON decoding. |
| `groq-total` / `gemini-total` | Entire service call, including preparation and decoding; emitted on failure too. |
| `active-app-capture` / `selected-text-capture` | Dev Prompt context collection during recording; selection includes any clipboard queue wait. |
| `context-wait-after-groq` | Remaining context wait after transcription. Normally near zero for longer recordings. |
| `release-to-final-output` | Final text available, before insertion. |
| `clipboard-queue` | Waiting for another Voca clipboard transaction to finish. |
| `text-insertion` | Insertion request to Command+V dispatch, or completion of manual copy. |
| `release-to-paste-dispatch` / `release-to-copy` | End-to-end delivery endpoint, excluding delayed clipboard restoration. |
| `clipboard-transaction` | Full insertion operation, including the retained 900 ms restoration grace period. |

Main/renderer timestamps use high-resolution, epoch-relative performance clocks;
cross-process spans include IPC/scheduling and can have small clock-origin skew.
Native observations use the helper's existing wall timestamp. Within-process
request durations use a monotonic clock. No timing can confirm when another
application actually paints/accepts a paste; Command+V dispatch is the measurable
endpoint, not an acknowledgment from the target app.

`overlay phase` records identify transitions without logging the displayed text.
The overlay acknowledges paste dispatch without waiting for clipboard cleanup.
The 100 ms clipboard settle and 900 ms restoration delays have not been shortened.
Selection capture and paste share a queue to prevent overlapping restoration.

## Stats interpretation

The existing Stats `Avg total` remains release-to-final-output, **not** time to
paste. Existing aggregate data is preserved; it is not mixed with a new timing
definition. Transcription/Gemini averages measure complete service calls. Raw
has no Gemini request and is excluded from the Gemini average. Stats still count
generated dictations, even if insertion falls back to manual copy.

## Compare runs and check reliability

1. Use a scratch Notes document and the same microphone/network/target app.
2. Test Raw, Clean and Dev Prompt separately: repeat the same short phrase at
   least ten times, then a longer instruction. Keep vocabulary and selected
   context consistent. Separate the first/cold request from subsequent ones.
3. Compare the median and slowest few `release-to-paste-dispatch` values, not
   just one request. Compare provider totals separately from local overhead.
4. For an older build without these diagnostics, use its existing final-output
   metrics for that stage only, or manually time release-to-visible-paste.
   Do not compare old Stats totals with new paste-dispatch measurements.
5. Test Fn then Control and Control then Fn; release either; repeat with F8 and
   a custom shortcut. Test quick taps and repeated sessions while processing.
6. Confirm Raw has no Gemini/context calls, Clean has no context calls, and Dev
   Prompt still incorporates selected text and active-app context.
7. Verify Detailed/Minimal success, Auto Paste off, missing permissions/provider
   errors, and unchanged clipboard contents after restoration. Copy something
   else during restoration and confirm Voca does not replace it. Start a new
   Dev Prompt recording during restoration to exercise the shared queue.

No live provider benchmark was performed as part of the automated tests. Local
tests use fake provider responses, clipboard operations and controlled delays.
They verify ordering and safeguards, not real network or model speed.
