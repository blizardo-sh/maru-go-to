# Runtime art for the selected overhead study desk

## New reading-stand proposal

After rejecting the table/background separation, the user suggested a Japanese
reading stand with perches for the cat. `stand-generation.json` records the exact
built-in image_gen prompts, inputs, output paths and hashes for the stand and room.
Originals: `stand/stand.png`, `stand/room.png`. Runtime: `runtime/stand.webp`,
`runtime/room-stand.webp`. No text or interactive controls are baked into the art.
Both were converted to WebP quality 90 method 6, without alpha cropping the stand.
The stand uses nine-slice borders 240/240/180/450 pixels, preserving posts/feet;
its central working surface adapts to the readable layout. The right perch is at
source y=500 and the lower ledge at y=865. Mobile uses a rail from the same texture.
This is a fictional teaching prop inspired by reading stands, not a reconstruction
of a historical kendai. The reference collection is linked in the generation log.
The previous desk-camera refinement below was rejected; its sources are preserved.

## Current desktop refinement (28 October)

The selected desktop composition is the whole room. `refinement-3.json` records
the exact built-in image_gen prompts, references, generated output paths and hashes
for `revision-3/room-study.png` and `revision-3/plain-paper.png`. Both originals are
preserved. Runtime WebP files are `runtime/room-study.webp` (raised desk camera) and
`runtime/plain-paper.webp` (plain handmade paper without floral decoration).
Normalization: alpha > 3 crop for paper only, LANCZOS thumbnail up to 1600×1200
for the scene / 1024×1024 for paper, WebP quality 90 method 6. No text is baked in.
The scene's rear table edge is 0.37 of its height; composition keeps that edge
above the active card instead of covering the viewport with an arbitrary crop.

Russian interface text now uses upright Lora, downloaded unmodified from the
official [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/lora).
`runtime/Lora-OFL.txt` is the SIL OFL license. The prior Marck Script font and
decorated paper below remain historical assets, not the current paper UI.

## Original asset set

Six generated PNG originals are preserved in `source/`. Exact prompts, references
and original image_gen output paths are recorded in `runtime-generation.json`.
The approved visual reference is `../art-direction/mobile-overhead-cards-v2.png`.
The full mockup is never used as a clickable background: Japanese, ruby, Russian
copy, navigation, progress and actions are separate Pixi objects. Only the brand
illustration contains the fixed Japanese wordmark.

`normalize.py` crops transparent margins at alpha > 3, resizes and writes WebP
(quality 90, method 6). Run with Python + Pillow. `runtime-manifest.json` records
source hashes, crops, runtime dimensions, hashes and file sizes. PNGs are retained.
Alpha channels and each resulting sprite were visually inspected. Card and answer
edges use NineSliceSprite; source decoration is intentionally kept at the edges.

The handwritten Cyrillic font is Marck Script Regular from the official
[Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/marckscript).
`runtime/MarckScript-OFL.txt` contains its SIL Open Font License. Downloaded from
the matching `raw.githubusercontent.com/google/fonts/main/ofl/marckscript/` files.
Fonts and runtime graphics are served locally under the existing strict CSP.

`desktop-generation.json` records the new 1586×992 landscape desktop plate.
It recomposes the same desk from directly above instead of cropping the portrait.
Below 900px the portrait plate remains in use. Both are blank backgrounds: all
learning UI and progress are rendered separately in Canvas. Desktop paper texture
scale is capped so its botanical detail does not grow into the text; all UI
rotation and skew remain zero.
