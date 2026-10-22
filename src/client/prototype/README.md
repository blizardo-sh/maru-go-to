# Compact study UX — disposable prototype

Question: which compact composition makes grouped learning, mixed practice and real paper-card gestures feel like part of the existing Japanese game world?

Approved scope: Q9–Q12 of the 22 October UX interview, including the confirmed larger playful cat and grounded desk props. This branch is a visual primary source, not production code and not permission to merge the prototype into main. No APIs, accounts, database, persistent state or real progress are used. The footer always says “Демонстрация: данные не сохраняются”. Product implementation follows the user's choice in separate PRs.

## Run and compare

```sh
bun run dev:client --port 5297 --strictPort
```

- [A — tactile cards](http://127.0.0.1:5297/?prototype=compact-ux&variant=A): a compact wooden tray, five word rows, two-by-two answers, and a paper stack for repetition.
- [B — study album](http://127.0.0.1:5297/?prototype=compact-ux&variant=B): an album gutter, illustrated contact sheet, vertical answers beside a question, and a chapter-like lesson index.

The bottom arrows change `variant` without losing in-memory state. The ▤ control opens the screen picker: study, textbook, repetition, reference, settings, access management, sign-in, invitation registration and recovery. On phones the app header keeps a separate 44 px ⋯ menu for sound and settings; the prototype picker is not their only access. Keyboard arrows switch variants only when a field, native select, button or keyboard card does not own the key.

Use Bun 1.4.3 as pinned in package.json. Ensure that version is installed and its executable is first on PATH if your shell uses a version-manager shim. The preview binds only to localhost and uses no API process. Do not stop existing services on 5173 or 3000.

## Art direction — phases 0–2

Concept: the learner studies at a living Japanese desk; a compact paper instrument keeps the material close together while the room and cat provide the game atmosphere.

Register: organic/material. Existing painted room, garden, mountain, river and Tokyo scenes, wooden frame, paper texture, lesson atlas and cat rig are reused. No new rendering or animation dependency. Neucha carries short Russian headings; system text and Japanese type carry explanations and study material. Body text is 16 px, Japanese study words 24–44 px; muted labels are secondary. Spacing follows an 8 px rhythm, with 4 px only for small joins. Green marks actions/correct answers and warm clay marks a retry, both accompanied by text and symbols. Navigation and board share one width axis. The desktop board caps at 1152 px width and 700 px height; short windows use a smaller fixed viewport-dependent height and native inner scroll.

Signature: the whole visible paper card moves while the wooden board, progress and cat stay still. Pointer movement reveals labelled rear zones, an insufficient drag returns, and a released card records only a local demonstration. Mouse, touch, Enter/Space reveal and left/right grading all work. Reduced motion keeps the paper stationary while text/result cues remain.

Learning beats: five-word overview with actual lesson 4 material → mixed reading/listening/reverse questions → result and cat response → automatic next question → full construction example and token practice → optional video library. Incorrect questions return after the rest until answered correctly. Correct feedback stays about 0.8 seconds; incorrect feedback about 1.6 seconds. This timing is for evaluation, not a new preference.

## Grounded scene and playful cat

The user confirmed the second composition pass: a larger cat at the board's lower-right edge, paws on the visible table, more active and playful behavior. One local layout effect uses the existing scene manifest's dimensions/tableBackEdge and the actual bottom-aligned cover crop. Prop alpha bounds and pose-specific lower transparent margins place the visible bases rather than the image boxes. Desktop uses four existing props; narrow phones regroup two, without negative offscreen offsets. The cat never reserves a board column. The development switcher folds into one row so it does not consume the foreground.

`PlayfulCat` wraps the existing neutral tail/body/head rig and existing PNG poses. It adds scoped idle stretching/tail movement/blinks, direction following and a return on card drag, listening movement, a happy wave after a correct answer, surprise/support after a wrong answer and a more pronounced completion gesture. Pose images decode in advance; neutral remains visible while a first uncached pose loads. Lower transparent margins were read from the existing image alpha in Chrome, without modifying artwork. Crossfades are 180 ms. The repeat card can advance at 260 ms while a separate 950 ms cat gesture finishes. Hidden tabs stop idle timers; reduced motion keeps static feedback and disables physical animation. Shared `Cat.tsx` and its assets remain unchanged.

## Real assets and boundaries

The fixture is copied from the existing lesson 4 route, word/audio manifest and its five official video records. Japanese AAC and the existing reveal/move/good/again/complete SFX are played directly; background music and location ambience start when the sound toggle is enabled and pause outside study or in a hidden tab. Videos are not preloaded; choosing a video mounts the existing player with its synchronised captions and source links.

The three painted illustrations are actual samples for family/father/mother. They appear only in the overview, after a quiz answer and in the reference. No image or answer-bearing image alt exists in an unanswered quiz. Other vocabulary remains text-only until curated illustration work in production. Source prompts and semantic mapping live beside the samples in `public/prototype/compact-ux/illustrations/generation.json`.

Admin/auth examples never issue a request. `example.invalid` is intentionally non-functional. Lesson thumbnails, all eighteen lesson titles, reference particles/kana, grouped exercises and forms show the design's density, not a claim about any user's data. The construction demo uses local token editing and a small authored explanation; it does not call an AI provider. A prototype choice does not reset or migrate real progress.

## Verification and handoff

TypeScript and real Chrome smoke checks cover the prototype independently from production. The final scene pass checks both variants across five scene backgrounds and 1280×720, 3000×1500, 1539×1466, 390×844 and 320×720: 50 plane measurements, no page overflow/API calls/JS errors, all visible prop bases on the table, whole revealed repetition cards, stable board/cat anchors during drag, and five-word overview plus start action visible on tall desktop. It also checks transparent cat hover, a repeat wave still present at 500 ms, uncached-pose neutral fallback, and reduced-motion CSS. An earlier interaction pass checks all 15 mixed pairs plus an incorrect retry, actual local AAC loading, touch drag, keyboard grading and all twelve demonstration screens. Browser dimensions are emulated; no physical-device performance is claimed. The only repository-media exceptions are the two approved proof frames: [desktop](../../../docs/ux-prototype/desktop.png) and [mobile](../../../docs/ux-prototype/mobile.png) on this throwaway branch. Other screenshots and geometry reports remain temporary local artifacts. The root coordinator owns publication on the throwaway prototype branch; do not merge this branch into main.

Not measured: physical-device calibration, Core Web Vitals, sustained FPS, screen-reader usability or production network/save behavior. The source illustration PNGs are deliberately unoptimised samples; production needs image sizing/compression and the actual reviewed lesson illustration inventory. No visual choice has been declared the winner.
