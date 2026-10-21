#!/usr/bin/env python3
"""Generate cached Japanese speech with the installed macOS voice; never calls a paid API."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile


def audio_name(text, voice='Kyoko', rate=150):
    return hashlib.sha256(f'{voice}:{rate}:{text}'.encode()).hexdigest()[:20] + '.m4a'


def spoken_text(word):
    return (word.get('audioText') or word.get('kana', '')).strip()


def safe_reading(text):
    return bool(text and len(text) <= 300 and re.fullmatch(r'[\u3041-\u30ffー\s・、。？！!?…]+', text))


def generate(course_path, output, voice, rate, jobs, limit):
    course = json.loads(course_path.read_text())
    output.mkdir(parents=True, exist_ok=True)
    words = course['words'][:limit] if limit else course['words']
    readings = {spoken_text(word) for word in words if safe_reading(spoken_text(word))}
    errors = []

    def render(text):
        destination = output / audio_name(text, voice, rate)
        if destination.exists() and destination.stat().st_size > 100:
            return text
        try:
            with tempfile.TemporaryDirectory(prefix='marugoto-audio-') as temporary:
                aiff = Path(temporary) / 'speech.aiff'
                m4a = Path(temporary) / 'speech.m4a'
                subprocess.run(['/usr/bin/say', '-v', voice, '-r', str(rate), '-o', str(aiff), text], check=True, capture_output=True)
                subprocess.run(['/usr/bin/afconvert', '-f', 'm4af', '-d', 'aac ', '-b', '48000', str(aiff), str(m4a)], check=True, capture_output=True)
                info = subprocess.run(['/usr/bin/afinfo', str(m4a)], check=True, capture_output=True, text=True).stdout
                duration = re.search(r'estimated duration:\s+([0-9.]+)', info)
                if m4a.stat().st_size <= 100 or not duration or float(duration.group(1)) <= 0:
                    raise ValueError('empty audio output')
                staged = destination.with_suffix('.m4a.tmp')
                staged.write_bytes(m4a.read_bytes())
                staged.replace(destination)
            return text
        except (subprocess.CalledProcessError, OSError, ValueError) as error:
            errors.append({'reading': text, 'error': str(error)})
            return None

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        complete = {text for text in pool.map(render, sorted(readings)) if text}
    manifest = {word['id']: '/audio/' + audio_name(spoken_text(word), voice, rate) for word in words if spoken_text(word) in complete}
    manifest_path = output / 'manifest.json'
    temporary_manifest = output / 'manifest.json.tmp'
    temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    temporary_manifest.replace(manifest_path)
    report = {'source': 'macOS speech synthesis', 'voice': voice, 'rate': rate, 'words': len(words), 'audioWords': len(manifest), 'distinctReadings': len(complete), 'missingWordIds': [word['id'] for word in words if word['id'] not in manifest], 'errors': errors, 'pronunciationReview': 'not-human-reviewed'}
    (output / 'generation-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({**{key: value for key, value in report.items() if key not in ('errors', 'missingWordIds')}, 'missingWords': len(report['missingWordIds']), 'errors': errors[:3], 'report': str(output / 'generation-report.json')}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--course', type=Path, default=Path('materials/course.json'))
    parser.add_argument('--output', type=Path, default=Path('public/audio'))
    parser.add_argument('--voice', default='Kyoko')
    parser.add_argument('--rate', type=int, default=150)
    parser.add_argument('--jobs', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    if args.rate < 80 or args.rate > 300 or args.limit < 0:
        parser.error('rate must be 80..300 and limit must be nonnegative')
    raise SystemExit(generate(args.course, args.output, args.voice, args.rate, args.jobs, args.limit))
