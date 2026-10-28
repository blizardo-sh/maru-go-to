# Runtime art for the selected overhead study desk

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
