# Illustrated study system — implementation brief

Status: implemented and verified locally, 23 October 2026. The user chose **A, «Иллюстрированная карточка»**, after reviewing the two live prototypes and supplied further corrections. This authorizes the production implementation described here. Prototype PR18 remains a separate disposable design capture; it is not merged into the app.

## Source and accepted layout

The implementation starts from main `d0b972eb63e19d3a807b2fc266387cdd0b3973a9`, which includes Album learning, the video library, counters, FlipCard and decks. The initial reviewed prototype capture was PR18 at `d3cf94c92140f3e89c15dbbfba2be48d57af374a`. Later corrections are requirements for real components rather than a reason to copy its simulated queue, saves or generic video routing.

Use the selected A composition throughout the real card families: large illustration on the left and text on the right on desktop, illustration above text on phones. Keep readable text, reachable actions and the stable study surface. Explanations start with a short explanation and example; the complete rule opens on demand. The textbook keeps its natural document height and ordinary page scrolling through all 18 lessons.

The follow-up screenshot audit established these shared corrections:

- Clip atlas images to the authored source rectangle inside each SVG. Preserve proportions without exposing neighboring artwork in letterbox space.
- Render structured Japanese with the selected writing mode and complete reviewed forms/segments. Preserve task stems that deliberately test reading, and the teaching symbols in kana tables.
- Keep Russian text in Russian typography; split mixed-language nodes instead of marking an entire button, caption fallback or personal-word summary Japanese.
- Keep decoded cat artwork visible through pose transitions, including neutral, hidden and reduced-motion paths.
- Preserve actual lesson/goal/video IDs and optional video navigation. The real route already appends each goal's related videos after its material; the generic prototype route is not a production model.

These facts come from the local follow-up screenshot audit of the selected [prototype PR18](https://github.com/blizardo-sh/maru-go-to/pull/18). They diagnose source behavior and do not constitute a browser verification of the final implementation.

## Reference drills

**Kana:** select actual rows from the existing basic, voiced, yoon and small-kana tables, then practice reading or listen and identify a character. The queue and practice progress are local to the frontend. Kana never creates a review state, a review attempt or an SRS material type.

Use the existing offline Japanese voice/cache to supply static, whitelisted recordings. Katakana and equivalent hiragana readings share a sound key and recording. Homophones must not be competing answers in a listening question. Small `っ/ッ` has no standalone phoneme: offer recognition with an explicit explanation instead of inventing audio. Audio load/playback failure must remain visible and must not grade an unheard question. The generation record distinguishes automated decoding/duration checks from human pronunciation review.

**Learned constructions:** offer text, listening and assembly practice from the learned reference entry. Use actual reviewed exercises and their exact authored examples/recordings. A skill without a recording can use text/assembly; its listening entry reports the unavailable recording clearly. All formats share the existing grammar review ID, target skill, version, attempt protocol and scheduler. Practicing an item before its due time is additional practice, not a schedule reset. A reference drill never advances or rewrites the guided lesson's current step.

## Repeat selection and API seam

The repeat start screen has checkboxes for the actual material families: words, counters and constructions. All are selected by default. Persist the selection per learner as `settings.repeatTypes`; old JSON settings normalize to all three without a migration or read-time write. An empty selection stays empty. Wait for a successful settings ACK before starting the queue.

`GET /api/reviews?mode=mixed` applies this saved selection before interleaving and limiting the queue. It includes only introduced material whose existing due semantics say it is due. It never calls the training queue to introduce new counters or words. Concrete-mode progress counts retain their existing meaning, so choosing filters does not erase progress or modify the calendar.

`GET /api/training?skillId=…&constructionMode=ja-ru|listening|grammar` accepts one introduced skill (default mode: text/`ja-ru`). It returns existing grammar review items with optional `construction` metadata: the chosen mode, exercise ID, explanation, segmented example and breakdown. `POST /api/reviews` retains its existing grammar payload and idempotent ACK contract. Analysis of this learned exercise uses its exercise ID and existing introduced-material access; training-only query parameters do not broaden analysis access.

No new SRS modes, generic training engine, database table, migration, external speech provider or dependency is required. Existing owner guards, pending outbox payloads, retries and prior ACK replays remain authoritative.

## Verification before publication

First run focused authenticated integration tests on the dedicated local `japanese_app_test` database with UUID fixture users and cleanup. Cover old/default settings, owner isolation, invalid/empty selections, due-only type filtering without state writes, learned-only drill access, exact examples/audio, all three formats sharing one schedule, idempotent attempts and unchanged guided state.

After client/source freeze, run the complete existing suite once, typecheck/build and the release checks. Use a separate built preview on `localhost:5302` with isolated API `3102` and fresh synthetic accounts/secrets. Keep the existing primary services and previews intact. Browser verification covers actual turn changes, server ACK failure/retry/outbox/owner boundaries, kana row selection and real playback without SRS POSTs, construction formats, filter persistence, responsive action reachability, Japanese mode rendering, crop boundaries and cat transitions. Preserve meaningful existing regression guards.

The implementation PR is created only after reviewable code and verification are ready. Publication does not merge or deploy the feature. Final results and any device/audio-review limits belong in the verification record after the checks run.

## Completed milestone evidence

On 23 October, focused authenticated HTTP tests passed: 4 tests / 109 assertions. Static audio and client helper checks passed: 6 tests / 1,802 assertions. All 101 canonical audio files decoded, with durations 0.320–0.550 seconds and 679,492 bytes total. Existing vocabulary/counter manifests were preserved.

A real Chrome source-preview check passed the new reference flows: failed settings save prevents Start, retry persists selections, empty selection stays empty; a selected vowel row completes both formats with actual playback, unique sound choices and zero SRS POSTs; construction text/listening/assembly share one schedule and replay an ambiguously saved ACK without an extra grade. Guided state remains unchanged and no page errors occurred. The same flows subsequently passed on the built app without HMR. The complete suite passed156tests/26,847assertions,0fail/0skip. Existing guided, Album owner/feedback, paper flight, counter and eight-viewport scene gates passed. Final scene evidence contains281measurements with0px frame/cat delta;54target hit checks and320normal/reduced cat frames passed. Visual review accepted the built desktop/group, phone navigation/CTA, kana trainer and corrected long counter reading. Exact results, hashes and limits are in [VERIFICATION](VERIFICATION.md) and the portable verification summary. Publication uses a separate production PR; no merge or deployment was performed.
