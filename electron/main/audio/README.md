# audio/

Main-process audio pipeline for recording sessions and chunked transcription.

## Files

- `index.ts` - Re-exports the audio module surface.
- `session-manager.ts` - Owns the active recording session lifecycle, `sessionId`, HUD state transitions, and per-session speech-detection state derived from live audio levels; handles streaming mode transitions when enabled.
- `processor.ts` - Accepts audio chunks, writes temp files, pins one ASR provider per recording session, converts audio as needed, merges chunk text in order, promotes the HUD into the refine step when applicable, logs final line-break metadata, skips silent/no-speech sessions, and runs the final refine/history/inject step once; supports streaming mode for real-time transcription with Volcengine.
- `converter.ts` - Initializes FFmpeg and converts captured audio to the upload format (MP3/PCM), with optional low-volume gain.

## Current Flow

**Standard Mode (default):**

1. The renderer records one session for up to 3 minutes and rotates internal chunks every 29 seconds.
2. The main process tracks chunk work by `sessionId + chunkIndex` and can process chunk ASR requests out of order.
3. Finalization only runs after the final chunk has been seen and every chunk from `0..finalChunkIndex` has produced text.
4. Refinement, line-break-aware final text logging, history writes, and text injection happen once per session after the merged transcript is ready, except silent sessions which now complete without injecting placeholder text.
5. Any chunk failure or session cancellation aborts the session and discards late results.

**Streaming Mode (Volcengine only, opt-in):**

1. When streaming mode is enabled and Volcengine is selected, transcription starts immediately when recording begins.
2. The renderer emits audio slices continuously during recording and the main process converts and forwards them to the ASR provider over WebSocket.
3. When the hotkey is released, the renderer sends a final empty packet to end the stream and the main process waits for the provider's terminal response.
4. Refinement, history, and text injection proceed as in standard mode.
