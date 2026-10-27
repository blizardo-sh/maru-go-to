# Study-card comparison — throwaway, not for main

Question: which composition makes a short Japanese exercise clear and comfortable while retaining a recognisable cat and learning world?

```sh
bun run prototype:study-cards
```

Requires existing dependencies. Prints `PROTOTYPE_URL` with a local ephemeral port. No database, account or API credentials. Keep the process running while reviewing.

On that URL:

- `?prototype=study-cards&variant=A`: compact wooden board, a single question above a 2×2 answer grid.
- `?prototype=study-cards&variant=B`: facing pages, question left and answers right; one column on a phone.
- `?prototype=study-cards&variant=C`: quieter focus workspace, neutral controls, room and cat as a separate window.

Bottom arrows or ←/→ switch variants. Use the screen selector for word introduction, translation, listening, recall and sentence assembly. “Как сейчас” renders the current `WordQuiz` for comparison; its surrounding shell is the prototype host, not a reproduction of every production layout calculation. State and orthography selectors let a reviewer pause on an outcome and compare it. The comparison toolbar is not proposed product UI.

Real course words, examples, audio and illustration mappings come from `loadCourse`. The four-word demo counter, chosen answers, phrase tokens and viewing preferences live in memory; variant/screen/state/orthography are reflected in the URL. Arrow switching retains the current example. A click in a quiz shows feedback and moves to the next demo word. The real saved retry queue and server grading remain outside this prototype.

The server rejects `/api/*` with 405 and exposes only read-only course data under `/__study-card-data`. Cat/static asset requests are local. The entry is gated by `import.meta.env.DEV`; the production build contains neither the comparison UI nor its CSS. The branch must not be merged to ship a design. After selection, implement the chosen composition in the real components with their existing saving/error behaviour.

Checks: TypeScript and production build; design-taste lint and 1440/768/390 inspections; a browser assertion pass across 48 layouts at 1440/768/390/320, including answer feedback, auto-advance, recall keyboard actions, phrase assembly, native rule dialog, listening unlock and blocked learner mutations. Physical devices and production persistence are not tested by this preview.

Limits visible for selection: A/B keep full explanations, so the introduction needs inner scrolling. C lets the learner select a word for detail on desktop and uses an expanded item on smaller screens. These are candidate layouts; more work on dense introductions may be warranted after selecting the direction.

Decision record: [docs/study-card-directions.md](../../docs/study-card-directions.md). Verdict is pending user review. Preserve this branch as the primary source; production integration belongs in another PR.

## Familiar C materials (26 October)

The user selected C's composition and requested more familiar styling. Three skins are now available on the same route:

- `variant=C&skin=paper` — C1, warm paper.
- `variant=C&skin=wood` — C2, the classic wooden board and full room.
- `variant=C&skin=shoji` — C3, a lighter timber frame.
- `variant=C&skin=original` — C0, the earlier neutral style for comparison.

For C, the bottom arrows cycle these skins; the first selector also chooses them directly. The current screen, example, answer and sentence draft remain in place. Add `screen=workspace`, `screen=intro` or `screen=review` to compare other learning screens. The restored labelled wooden navigation is shared by all three familiar skins. The inner composition is unchanged across those skins; they are visual alternatives, not new learning modes.


## C2: daily companion (27 October)

The user selected C2 and asked the cat to share the room instead of occupying a separate window. Add `variant=C&skin=wood&cat=daily&daypart=morning|day|evening|auto`. The first selector and arrows compare morning/day/evening; “Место” demonstrates travel to the other side. Screen, answer, orthography and phrase draft stay in place. “По местному времени” samples device time on entry (06–12 morning, 12–18 day, otherwise evening); it does not change the scene during an answer.

The desk uses the existing room illustration. Morning is more active, day is quieter, evening rests with subtle breathing. Real learning audio wakes the evening cat. Review dragging turns the companion toward the card. Reduced motion skips travel. The original C2 without `cat=daily` remains available. Existing art demonstrates the route; finished walking frames and automatic movement between actual learning parts are outside this visual prototype.

Reproduce the browser checks after starting the read-only preview server:

```sh
bun verification/study-card-prototype/check-daily-cat.ts http://127.0.0.1:PORT
```

Requires installed Chrome and existing Playwright dependency. The check writes `artifacts/daily-cat/verification.json`. It covers 48 layouts, seven local-time boundaries, draft retention, auto-advance, travel visibility and reduced motion. Screenshots and inspector reports are in `artifacts/daily-cat/{morning,day,evening}`. No physical-device or production performance claim is made.
