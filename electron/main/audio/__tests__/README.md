# audio/**tests**/

Tests for the main-process audio pipeline.

## Files

- `session-manager.test.ts` - Covers session start/stop/cancel transitions and `sessionId` propagation to the HUD flow.
- `processor.test.ts` - Covers chunk ordering, prompt carry-over, delayed earlier chunks, cancellation drops, fail-fast behavior, multiline refinement propagation, and final injection.
- `converter.test.ts` - Covers FFmpeg initialization, audio conversion, and optional gain handling.
