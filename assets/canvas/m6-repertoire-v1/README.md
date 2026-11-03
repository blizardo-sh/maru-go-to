# M6 whole-character families

Calm whole-character direction accepted in `../m6-v4/approval.json`. The approved 68-frame walk remains unchanged. New source `source/repertoire.png` was generated with the original neutral/standing kitten references; exact prompt and source hash are in `generation.json`. Original sheet retained.

`m6-repertoire-assets.py` normalizes feet to y=244/256, removes disconnected alpha debris, builds complete RGBA cels with local Apple Vision revision 1 and premultiplied warps. At occlusions it selects a single warped whole cel rather than crossfading faces/paws. No runtime head/limb rig. Sources for blink/listen/think/point/support/nod are the original public/mascot whole PNGs. Tiny idle displacement is baked into whole cels and played sparsely, one action at a time; stretch appears after roughly one quiet minute. No movement of the exercise paper.

Atlas frames are 192 px, shared source per family; lazy loading keeps only the active family, with a brief overlap while replacing it. Frame textures never own their shared source. Manifest records dimensions, compressed and decoded bytes and hashes. Generated artwork for this project; no third-party character source.
