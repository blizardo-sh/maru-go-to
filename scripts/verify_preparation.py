"""Check the prepared documents, source maps and sample data; no app/AI tests."""

import json
import re
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_json(relative):
    return json.loads((ROOT / relative).read_text())


def verify_forms(forms):
    assert len({item["id"] for item in forms}) == len(forms)
    for item in forms:
        parts = item["segments"]
        assert "".join(part["surface"] for part in parts) == item["surface"], item["id"]
        assert "".join(part.get("reading", part["surface"]) for part in parts) == item["kana"], item["id"]


outline = read_json("materials/marugoto-starter-a1/curriculum-outline.json")
lessons = outline["lessons"]
assert [lesson["number"] for lesson in lessons] == list(range(1, 19))
assert len({lesson["id"] for lesson in lessons}) == 18
assert sorted({lesson["topic_number"] for lesson in lessons}) == list(range(1, 10))
assert [goal for lesson in lessons for goal in lesson["katsudoo_can_do_ids"]] == list(range(1, 51))
assert all(not lesson["content_ready"] for lesson in lessons), "An outline is not a completed course."

sources = read_json("materials/marugoto-starter-a1/source-manifest.json")
assert len(sources["notes"]) == len({note["url"] for note in sources["notes"]}) == 52
assert sorted({note["lesson_number"] for note in sources["notes"]}) == list(range(3, 19))

verify_forms(read_json("materials/examples/orthography.json")["examples"])
sample = read_json("materials/examples/lesson04.sample.json")
assert sample["production_ready"] is False
verify_forms(sample["forms"])
form_ids = {item["id"] for item in sample["forms"]}
skill_ids = {item["id"] for item in sample["skills"]}
assert len({item["id"] for item in sample["exercises"]}) == len(sample["exercises"]) == 6
for exercise in sample["exercises"]:
    assert exercise["skill_id"] in skill_ids
    assert set(exercise["can_do_ids"]) <= {7, 8}
    tokens = exercise["tokens"]
    assert all(token["form_id"] in form_ids for token in tokens)
    ids = [token["instance_id"] for token in tokens]
    assert len(ids) == len(set(ids))
    assert len({tuple(order) for order in exercise["accepted_orders"]}) == len(exercise["accepted_orders"])
    assert all(sorted(order) == sorted(ids) for order in exercise["accepted_orders"])

mascot = read_json("assets/mascot/manifest.json")
assert len(mascot["states"]) == len({state["id"] for state in mascot["states"]}) == 9
for state in mascot["states"]:
    header = (ROOT / "assets/mascot" / state["filename"]).read_bytes()[:33]
    assert header[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, depth, color = struct.unpack(">IIBB", header[16:26])
    assert (width, height) == (state["width"], state["height"])
    assert depth == 8 and color in (4, 6), "Expected a PNG alpha channel."

for file in ROOT.rglob("*.md"):
    if any(part in {"node_modules", ".git", "dist"} for part in file.relative_to(ROOT).parts):
        continue
    text = file.read_text()
    headings = re.findall(r"^## (.+)$", text, re.M)
    assert len(headings) == len(set(headings)), f"Duplicate heading: {file.relative_to(ROOT)}"
    for link in re.findall(r"\]\(([^)]+)\)", text):
        target = link.strip("<>").split("#", 1)[0]
        if not target or "://" in target or target.startswith("mailto:"):
            continue
        assert (file.parent / target).exists(), f"Broken local link: {file.name}: {target}"

print("PASS: 18 lessons / 50 Can-do; 52 source notes; orthography; 6 sample exercises; 9 PNG states; local links.")
print("Not checked: full course content, linguistic approval, live AI, VPS runtime or application behavior.")
