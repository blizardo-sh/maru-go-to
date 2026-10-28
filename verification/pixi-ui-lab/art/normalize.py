"""Rebuild runtime art from preserved image_gen PNGs; requires Pillow."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
records = []
for source in sorted((root / 'source').glob('*.png')):
    image = Image.open(source).convert('RGBA')
    original_size = image.size
    crop = image.getchannel('A').point(lambda v: 255 if v > 3 else 0).getbbox()
    assert crop, f'Empty image: {source}'
    background = source.stem.startswith('desk')
    if not background:
        assert image.getchannel('A').getextrema()[0] == 0, f'Missing transparency: {source}'
        image = image.crop(crop)
    bounds = (1920, 1280) if source.stem == 'desk-landscape' else (1280, 1920) if background else (1024, 1024)
    image.thumbnail(bounds, Image.Resampling.LANCZOS)
    target = root / 'runtime' / (source.stem + '.webp')
    image.save(target, 'WEBP', quality=90, method=6)
    records.append({'source': str(source.relative_to(root)), 'sourceSize': original_size,
                    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'alphaCrop': crop, 'runtime': str(target.relative_to(root)), 'runtimeSize': image.size,
                    'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
assert len(records) == 6
(root / 'runtime-manifest.json').write_text(json.dumps(records, indent=2) + '\n')
print(f'Normalized {len(records)} images; source PNGs preserved.')
