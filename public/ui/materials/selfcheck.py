"""Check the three generated UI materials without modifying any file."""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'generation.json').read_text())
expected = {'wood-frame-v1.webp', 'paper-v1.webp', 'wood-plank-v1.webp'}
assert {asset['file'] for asset in manifest['assets']} == expected
assert manifest['overwritePolicy'].startswith('New versioned files only;')
for asset in manifest['assets']:
    path = root / asset['file']
    data = path.read_bytes()
    assert len(data) == asset['bytes'] <= asset['budgetBytes'], path
    assert hashlib.sha256(data).hexdigest() == asset['sha256'], path
    with Image.open(path) as image:
        image.load()
        assert image.format == 'WEBP' and list(image.size) == asset['dimensions'], path
        if asset['transparentBackgroundRequested']:
            assert image.mode == 'RGBA', path
            alpha = image.getchannel('A')
            w, h = image.size
            assert alpha.getextrema() == (0, 255), path
            assert alpha.crop((w//4, h//4, 3*w//4, 3*h//4)).getextrema()[1] <= 2, path
            assert all(alpha.getpixel(point) == 0 for point in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]), path
            assert all(alpha.getpixel(point) >= 250 for point in [(w//2, h//16),(w//16, h//2),(15*w//16, h//2),(w//2, 15*h//16)]), path
print('PASS: 3 WebP assets decode; dimensions, budgets, hashes and frame alpha match generation.json. Read-only check; no overwrites.')
