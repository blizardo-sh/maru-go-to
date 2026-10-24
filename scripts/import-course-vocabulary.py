#!/usr/bin/env python3
"""Re-extract the pinned official dictionaries into an existing course, preserving IDs.

Usage: python3 scripts/import-course-vocabulary.py /path/to/pdfs --output /tmp/course.json
Requires pdftotext (Poppler) and pdfplumber; reads local files, never downloads during a build.
"""
import argparse
import collections
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import pdfplumber

NS = {"x": "http://www.w3.org/1999/xhtml"}
PARTS = {
    "katsudoo": {
        "sha256": "a06b46aa8292e4903ec5462836953b43b9c1711cc97779e80d203bb69c5f6352",
        "rows": 546,
        "columns": (45, 178, 278, 353, 548),
        "url": "https://marugoto.jpf.go.jp/assets/docs/download/starter_a/MarugotoStarterActivitiesVocabularyIndex2_RU.pdf",
    },
    "rikai": {
        "sha256": "be450620ac491abeb030d26460cedaa5cda96244a1ce4d2f4e6aa1bf83493a42",
        "rows": 567,
        "columns": (45, 175, 272, 346, 537),
        "url": "https://marugoto.jpf.go.jp/assets/docs/download/starter_c/MarugotoStarterCompetencesVocabularyIndex2_RU.pdf",
    },
}


def extract_rows(pdf, part, config):
    actual_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
    if actual_hash != config["sha256"]:
        raise ValueError(f"Changed source {part}: {actual_hash}; review the edition before import")
    lo, accent, romaji, ru, script = config["columns"]
    result = []
    lesson = None
    with tempfile.TemporaryDirectory(prefix="marugoto-") as folder:
        xml = Path(folder) / "table.xml"
        subprocess.run(["pdftotext", "-bbox-layout", str(pdf), str(xml)], check=True)
        pages = ET.parse(xml).getroot().findall(".//x:page", NS)
        with pdfplumber.open(pdf) as document:
            boundaries = [[edge["top"] for edge in page.edges if edge["orientation"] == "h" and edge["x0"] < (ru + script) / 2 < edge["x1"]] for page in document.pages]
        for page_i, page in enumerate(pages):
            minimum = 126 if page_i == 0 and part == "rikai" else 129 if page_i == 0 else 45
            words = [
                {"x": float(w.get("xMin")), "y": float(w.get("yMin")), "center": (float(w.get("yMin")) + float(w.get("yMax"))) / 2, "text": w.text or ""}
                for w in page.findall(".//x:word", NS)
                if minimum <= float(w.get("yMin")) <= 785
            ]
            lines = collections.defaultdict(list)
            for word in words:
                lines[round(word["y"])].append(word)
            rows = []
            for y, line in sorted(lines.items()):
                entry = "".join(w["text"] for w in sorted(line, key=lambda w: w["x"]) if lo <= w["x"] < accent)
                if entry and entry != "ことば":
                    rows.append({"y": y, "entry": entry})
            for i, row in enumerate(rows):
                # Japanese cells are vertically centered; only real table rules keep wrapped translations together.
                lower = max(y for y in boundaries[page_i] if y < row["y"])
                upper = min(y for y in boundaries[page_i] if y > row["y"])
                cells = [w for w in words if lower <= w["center"] < upper]
                numbers = [w for w in cells if w["x"] < lo and w["text"].isdigit() and abs(w["y"] - row["y"]) < 8]
                if numbers:
                    lesson = int(numbers[0]["text"])
                row.update(part=part, lesson=lesson, page=page_i + 1, row=i + 1)
                for key, left, right in [("accent", accent, romaji), ("meaningRu", ru, script)]:
                    column = sorted([w for w in cells if left <= w["x"] < right], key=lambda w: (round(w["y"]), w["x"]))
                    row[key] = ("" if key == "accent" else " ").join(w["text"] for w in column)
                assert 1 <= row["lesson"] <= 18 and row["accent"] and row["meaningRu"], row
                result.append(row)
    assert len(result) == config["rows"], (part, len(result))
    assert {r["lesson"] for r in result} == set(range(1, 19)), part
    return result


def normalize(row):
    entry = row["entry"]
    kana = re.split("[、／/（(]", row["accent"])[0]
    kana = re.sub("[￢￣～〜 ―]", "", kana)
    if not kana:
        kana = re.split("[／/（(]", entry)[0].replace("～", "")
    assert re.fullmatch("[ぁ-ゖァ-ヺー・]+", kana), (entry, kana)
    variants = [v for v in re.split("[／/（()）]", entry) if v and v != "な"]
    surface = next((v for v in variants if re.search("[一-龯]", v)), variants[0]).lstrip("～〜")
    meaning = row["meaningRu"]
    for old, new in [("предме тах", "предметах"), ("предмет ах", "предметах"), ("пре дметов", "предметов"), ("предме тов", "предметов"), ("нап исания", "написания"), ("написа ния", "написания"), ("напис ания", "написания"), ("многокварти рный", "многоквартирный"), ("японс ких", "японских"), ("изо бражения", "изображения"), ("к акого", "какого"), ("Ток ио", "Токио"), ('дерево "', 'дерево"')]:
        meaning = meaning.replace(old, new)
    if row["part"] == "rikai" and entry.startswith("いつか("):
        meaning = "пятое число"
    elif row["part"] == "rikai" and entry.startswith("はつか("):
        meaning = "двадцатое число"
    elif kana == "まい" and meaning == "каждый":
        meaning = "счётный суффикс для плоских предметов"
    return surface, kana, meaning


def segments(surface, kana):
    if surface == kana:
        return [{"surface": surface}]
    suffix = 0
    while suffix < min(len(surface), len(kana)) and surface[-suffix - 1] == kana[-suffix - 1] and re.match("[ぁ-ゖァ-ヺー]", surface[-suffix - 1]):
        suffix += 1
    if suffix and len(surface) > suffix and len(kana) > suffix:
        return [{"surface": surface[:-suffix], "reading": kana[:-suffix]}, {"surface": surface[-suffix:]}]
    return [{"surface": surface, "reading": kana}]


def reimport(course, rows):
    result = copy.deepcopy(course)
    # Preserve authored same-meaning answers and context independently of vocabulary extraction.
    for exercise in result["exercises"]:
        translation = exercise.get("translationRu")
        assert translation is None or (isinstance(translation, str) and translation.strip() and len(translation) <= 3000), exercise["id"]
        token_ids = {token["id"] for token in exercise["tokens"]}
        assert len(token_ids) == len(exercise["tokens"]), exercise["id"]
        assert any(len(order) == len(token_ids) for order in exercise["acceptedOrders"]), exercise["id"]
        for order in exercise["acceptedOrders"]:
            assert order and len(set(order)) == len(order) and set(order) <= token_ids, exercise["id"]
            if len(order) < len(token_ids):
                assert exercise.get("contextRu", "").strip() and translation and translation.strip(), exercise["id"]
    by_source = {}
    for word in result["words"]:
        for ref in word["sourceRefs"]:
            if "VocabularyIndex" in ref["url"]:
                key = (ref["url"], ref["page"], ref["row"])
                if key in by_source:
                    raise ValueError(f"Source row assigned to multiple senses: {key}")
                by_source[key] = word
    expected = {(PARTS[r["part"]]["url"], r["page"], r["row"]) for r in rows}
    if expected != set(by_source):
        raise ValueError("Source coverage changed; explicit content migration is required")
    for row in rows:
        word = by_source[(PARTS[row["part"]]["url"], row["page"], row["row"])]
        surface, kana, meaning = normalize(row)
        # IDs come from the retained source mapping, never from the edited translation.
        word["meaningRu"] = meaning
        word["kana"] = kana
        if re.search("[一-龯]", surface) or not re.search("[一-龯]", word["surface"]):
            word["surface"] = surface
        word["segments"] = segments(word["surface"], kana)
    # Corrected source cells can reveal duplicate senses; retain a previously correct ID when possible.
    originals = {word["id"]: word for word in course["words"]}
    senses = collections.defaultdict(list)
    for word in result["words"]:
        if any("VocabularyIndex" in ref["url"] for ref in word["sourceRefs"]):
            senses[(word["kana"], word["meaningRu"])].append(word)
    aliases = {}
    for group in senses.values():
        if len(group) < 2:
            continue
        keep = max(group, key=lambda word: (originals[word["id"]]["meaningRu"] == word["meaningRu"], bool(re.search("[一-龯]", word["surface"]))))
        for word in group:
            if word is keep:
                continue
            aliases[word["id"]] = keep["id"]
            for key in ("lessonIds", "sourceRefs"):
                keep[key].extend(item for item in word[key] if item not in keep[key])
    result["words"] = [word for word in result["words"] if word["id"] not in aliases]
    by_form = {}
    form_aliases = {}
    forms = []
    for form in sorted(result["forms"], key=lambda form: form["wordId"] in aliases):
        form["wordId"] = aliases.get(form["wordId"], form["wordId"])
        key = (form["wordId"], form["surface"], form["kana"])
        if key not in by_form:
            by_form[key] = form
            forms.append(form)
        else:
            keep = by_form[key]
            form_aliases[form["id"]] = keep["id"]
            for field in ("lessonIds", "sourceRefs"):
                keep[field].extend(item for item in form[field] if item not in keep[field])
    result["forms"] = forms
    for exercise in result["exercises"]:
        for token in exercise["tokens"]:
            token["formId"] = form_aliases.get(token["formId"], token["formId"])
    for word in result["words"]:
        if any("VocabularyIndex" in ref["url"] for ref in word["sourceRefs"]):
            assert any(form["wordId"] == word["id"] and form["surface"] == word["surface"] and form["kana"] == word["kana"] for form in result["forms"]), word["id"]
    # Pronunciation overrides are authored by expression, not a replacement of every は.
    pronunciations = json.loads((Path(__file__).resolve().parents[1] / 'materials/catalog.json').read_text())['pronunciationOverrides']
    for word in result["words"]:
        if word["kana"] in pronunciations and (word["pos"] == "particle" or word["kind"] == "phrase"):
            word["audioText"] = pronunciations[word["kana"]]
    assert len(rows) == 1113
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("--course", type=Path, default=Path(__file__).resolve().parents[1] / "materials/course.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = [row for part, config in PARTS.items() for row in extract_rows(args.source_dir / f"{part}.pdf", part, config)]
    course = reimport(json.loads(args.course.read_text()), rows)
    # Write only after every source and reference has passed validation.
    args.output.write_text(json.dumps(course, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(rows)} source rows across 18 lessons in both parts; existing canonical IDs retained")


if __name__ == "__main__":
    main()
