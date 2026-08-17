#!/usr/bin/env python3
"""gen_line_models.py — Build tools/line_models.py from the master workbook.

The workbook is the source of truth for every part number. Run this script
when the workbook changes, then run build_line_pages.py.

Usage:
    python tools/gen_line_models.py
    python tools/gen_line_models.py --workbook "P:\\...\\Book3.xlsm"
"""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

import openpyxl

DEFAULT_WORKBOOK = r"P:\EngineeringDept\Adobe Documents\Refactor\Test\Book3.xlsm"
OUT = Path(__file__).resolve().parent / "line_models.py"

CURLY = "\u201d"

# Product_Name prefix -> line slug. Order matters: Sea Wave before Wave.
LINE_PREFIXES = [
    ("Sea Wave", "SeaWave"),
    ("Wave", "Wave"),
    ("Linear", "Linear"),
    # The Elite Garden Surround is the only 54 x 42 surround, which is the
    # Garden footprint, so it goes to Garden. This entry must stay above the
    # plain Elite entry, which would otherwise claim it.
    ("Elite Garden", "Garden"),
    ("Elite", "Elite"),
    ("Contour", "Contour"),
    ("Arcadia", "Arcadia"),
    ("Triumph", "Triumph"),
    ("Victory", "Victory"),
    ("Select", "SelectADA"),
    ("Classic Garden", "Garden"),
    ("Garden", "Garden"),
    ("Drop-in", "DropIn"),
]

SHOWER_SURROUND = "Shower Surround"
BATHTUB_SURROUND = "Bathtub/Seated Base Surround"

# Workbook column -> the color name shown on the site. The workbook spells the
# column Grey. The tile image file spells it Gray.
COLOR_COLUMNS = [
    ("Product_White", "White"),
    ("Product_Biscuit", "Biscuit"),
    ("Product_Glacier_Marble", "Glacier Marble"),
    ("Product_Luna_Grey", "Luna Grey"),
    ("Product_Luna_Pearl", "Luna Pearl"),
]

# Some products carry more than one part number for the same wall. The note
# explains what separates them.
PART_DETAIL: dict[str, str] = {}

# Part numbers held back from the public pages for now. Naming either color
# holds back both, because 01 and 09 are the same part in two colors.
# ESS01305459 is the same wall as LESCS01305459 with the seal strip already
# applied, a contractor option that is not marketed yet.
EXCLUDE_PARTS = {"ESS01305459"}


def colorless(part: str) -> str:
    """Drop the color code so 01 and 09 of one part compare equal."""
    return re.sub(r"^([A-Z]+)0[19]", r"\1", part)


EXCLUDE_KEYS = {colorless(p) for p in EXCLUDE_PARTS}

# Flagship products. These sort to the top of their line, above the usual
# category order. The value is a tuple of Product_Name prefixes.
FEATURED = {
    "Elite": ("Elite II",),
}

# A wall that pairs with a fixture by name instead of by dimension. The
# General Purpose surround is 60 x 54, but it is built for the two Sea Wave
# corner baths, which are 54 x 54 and 48 x 48.
EXTRA_PAIRS = {
    "GP01605458": ["SXT01545419", "SVT01484820"],
}


def line_of(name: str, ptype: str) -> str:
    if ptype == "Glue up":
        return "GlueUp"
    for prefix, slug in LINE_PREFIXES:
        if name.startswith(prefix):
            return slug
    return ""


def sizes_in(text: str) -> list[str]:
    """Return the whole-inch part of each dimension. Used to sort and to group."""
    return re.findall(r'(\d+)(?:[- ]\d+/\d+)?["\u201d]', text)


def display_sizes_in(text: str) -> list[str]:
    """Return each dimension with its fraction kept: 3-1/2 and 19 3/4 survive."""
    return re.findall(r'(\d+(?:[- ]\d+/\d+)?)["\u201d]', text)


def category_of(name: str, ptype: str) -> str:
    # Glue up comes first. Every product in that line also has "Surround" in
    # its name, so a later check would classify it by height instead.
    if ptype == "Glue up":
        return "Glue-Up Surround"
    if ptype == "Grab Bar Panels":
        return "Grab Bar Panel"
    if ptype == "Seated Base":
        return "Seated Base"
    if ptype == "Base":
        return "Shower Base"
    if ptype.startswith("Bathtub") and "Surround" not in ptype:
        return "Bathtub"
    if ptype == "ADA Select":
        return "Shower Base" if "Base" in name else surround_by_height(name)
    if "Surround" in ptype or "Surround" in name:
        return surround_by_height(name)
    return "Bathtub"


def surround_by_height(name: str) -> str:
    nums = sizes_in(name)
    height = nums[2] if len(nums) > 2 else ""
    return BATHTUB_SURROUND if height == "59" else SHOWER_SURROUND


def describe(name: str, parts: list[str], category: str) -> str:
    """Short description: the product name without its size, plus drain info."""
    base = name.split(" - ")[0].strip()

    # On a grab bar panel the trailing R and L mark which hand the panel is,
    # not a drain position. A panel has no drain. The part of the name after
    # the dash is the job it does, 60" Back Panel or 32" Side Panels, and
    # that is what a customer has to match to the alcove.
    if category == "Grab Bar Panel":
        role = name.split(" - ")[-1].strip() if " - " in name else base
        hands = {p[-1] for p in parts if p and p[-1] in "RL"}
        return f"{role}, left and right" if hands >= {"R", "L"} else role

    drains = {p[-1] for p in parts if p and p[-1] in "RLC"}
    if drains >= {"R", "L"}:
        return f"{base}, right or left drain"
    if drains == {"C"}:
        return f"{base}, center drain"
    return base


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    args = ap.parse_args()

    ws = openpyxl.load_workbook(args.workbook, data_only=True, read_only=True)["Book1"]
    rows = [
        [("" if c is None else str(c)).strip() for c in r]
        for r in ws.iter_rows(values_only=True)
    ]
    ix = {n: i for i, n in enumerate(rows[0])}

    buckets: dict[str, list[dict]] = defaultdict(list)
    # One product can appear on several workbook rows, once per Product_Type,
    # and can carry more than one part number. Merge on the product name.
    index: dict[tuple[str, str], dict] = {}

    for r in rows[1:]:
        name = r[ix["Product_Name"]].replace(CURLY, '"')
        if not name:
            continue
        ptype = r[ix["Product_Type"]]
        slug = line_of(name, ptype)
        if not slug:
            continue

        parts = [
            r[ix[k]]
            for k in ("Lyons_Part", "Product_Part_#1", "Product_Part_#2",
                      "Product_Part_#3", "Product_Part_#4")
        ]
        parts = list(dict.fromkeys(
            p for p in parts if p and colorless(p) not in EXCLUDE_KEYS
        ))
        white = [p for p in parts if not re.match(r"^[A-Z]+09", p)]
        # Fall back to the raw parts only when this part number scheme carries
        # no color code at all. Never promote a 09 part into the White slot.
        if not white and not any(re.match(r"^[A-Z]+0[19]", p) for p in parts):
            white = parts
        if not white:
            continue

        shown = display_sizes_in(name)
        size = " x ".join(f'{n}"' for n in shown) if shown else name.split(" - ")[-1]

        adj = r[ix["Product_Adjustable"]].replace(CURLY, '"')
        fits, fits_note = [], ""
        if adj and '"' in adj:
            fits = [a.strip() for a in adj.split("|") if a.strip() and a.strip() != size]
        elif adj:
            fits_note = "Fits the " + " and the ".join(
                a.strip().replace("Seawave", "Sea Wave") for a in adj.split("|")
            )

        category = category_of(name, ptype)
        key = (slug, name)
        entry = index.get(key)
        if entry is None:
            entry = {
                "numbers": [],
                "size": size,
                "category": category,
                "description": describe(name, parts, category),
                "group": "Surround" if "Surround" in category else "",
                "fits": fits,
                "fits_note": fits_note,
                "colors": [],
                "details": [],
                "_featured": any(
                    name.startswith(p) for p in FEATURED.get(slug, ())
                ),
            }
            index[key] = entry
            buckets[slug].append(entry)

        for p in white:
            if p not in entry["numbers"]:
                entry["numbers"].append(p)
                if p in PART_DETAIL:
                    entry["details"].append(PART_DETAIL[p])
        for col, label in COLOR_COLUMNS:
            if r[ix[col]] and label not in entry["colors"]:
                entry["colors"].append(label)

    # Sort: surrounds first, then bases, then bathtubs; widest first inside each.
    rank = {"Shower Surround": 0, BATHTUB_SURROUND: 1, "Glue-Up Surround": 0,
            "Shower Base": 2, "Seated Base": 3, "Bathtub": 4, "Grab Bar Panel": 5}

    def key(m: dict):
        nums = sizes_in(m["size"]) or ["0", "0", "0"]
        pad = [int(n) for n in nums] + [0, 0, 0]
        return (0 if m["_featured"] else 1,
                rank.get(m["category"], 9), -pad[2], -pad[0], -pad[1])

    lines = ["# Generated by tools/gen_line_models.py. Do not edit by hand.",
             "# Source: the master product workbook.",
             "",
             "MODELS = {"]
    for slug in sorted(buckets):
        items = sorted(buckets[slug], key=key)
        lines.append(f"    {slug!r}: [")
        for m in items:
            lines.append("        {")
            lines.append(f"            'number': {' / '.join(m['numbers'])!r},")
            for field in ("size", "category", "description", "group"):
                lines.append(f"            {field!r}: {m[field]!r},")
            lines.append(f"            'colors': {m['colors']!r},")
            pairs = EXTRA_PAIRS.get(m["numbers"][0], [])
            if pairs:
                lines.append(f"            'pairs': {pairs!r},")
            if m["details"]:
                lines.append(f"            'detail': {' '.join(m['details'])!r},")
            if m["fits"]:
                lines.append(f"            'fits': {m['fits']!r},")
            if m["fits_note"]:
                lines.append(f"            'fits_note': {m['fits_note']!r},")
            lines.append("        },")
        lines.append("    ],")
    lines.append("}")
    lines.append("")
    lines.append("# The tile image for each color, relative to /Products.")
    lines.append("COLOR_IMAGES = {")
    for _, label in COLOR_COLUMNS:
        stem = label.replace(" ", "_").replace("Grey", "Gray")
        lines.append(f"    {label!r}: '../images/Lyons_{stem}"
                     f"{'-N' if label in ('White', 'Biscuit') else ''}.jpg',")
    lines.append("}")
    lines.append("")
    lines.append("# The colors each line offers, in the order above.")
    order = [label for _, label in COLOR_COLUMNS]
    lines.append("LINE_COLORS = {")
    for slug in sorted(buckets):
        got = {c for m in buckets[slug] for c in m["colors"]}
        lines.append(f"    {slug!r}: {[c for c in order if c in got]!r},")
    lines.append("}")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    total = sum(len(v) for v in buckets.values())
    print(f"wrote {OUT}  ({len(buckets)} lines, {total} models)")
    for slug in sorted(buckets):
        print(f"  {slug:<12} {len(buckets[slug]):>3} models")


if __name__ == "__main__":
    main()
