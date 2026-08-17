#!/usr/bin/env python3
"""build_line_pages.py — Build the Lyons product line pages.

One data table drives every page. To add a line, add one LineSpec to LINES
and run the script. The script writes to <repo>/Products/<slug>.html.

Usage:
    python tools/build_line_pages.py            # write pages
    python tools/build_line_pages.py --list     # show the plan only
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import struct
from dataclasses import dataclass, field
from pathlib import Path

from line_models import COLOR_IMAGES, LINE_COLORS, MODELS

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "Products"
# Blender exports, one .glb per part number. The viewer reads whatever is
# here; an empty folder just means every shape is built from its numbers.
MODEL_DIR = REPO / "models"

# Only White and Biscuit appear in a part number. The other three colors are
# ordered by name, so they carry no code.
COLOR_CODES = {"White": "01", "Biscuit": "09"}

# ── Data ────────────────────────────────────────────────────────────────────


# The height of a surround decides its category:
#   74 in. on the Wave line, or 69 in. on the other lines -> Shower Surround
#   59 in. on any line -> Bathtub/Seated Base Surround
# Keep to this rule when you add a line.
SHOWER_SURROUND = "Shower Surround"
BATHTUB_SURROUND = "Bathtub/Seated Base Surround"
# Both surround types sit in one collapsible group. The Type column keeps
# them apart.
SURROUND = "Surround"


@dataclass
class Model:
    number: str
    size: str
    category: str            # shown in the Type column
    description: str
    group: str = ""          # collapsible group. Empty = group by category.
    fits: list[str] = field(default_factory=list)   # other sizes it cuts down to
    fits_note: str = ""      # free text when the fit is not a dimension
    detail: str = ""         # what separates two part numbers for one product
    colors: list[str] = field(default_factory=list)
    pairs: list[str] = field(default_factory=list)  # pairs by name, not size


@dataclass
class Warranty:
    term: str                      # the badge, e.g. "5 year and 2 year"
    summary: str = ""              # one line of plain language
    subheading: str = ""           # the line under the warranty title
    sections: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class Color:
    code: str                # the digits that follow the letter prefix
    name: str
    image: str               # path relative to /Products


@dataclass
class Feature:
    title: str
    body: str


@dataclass
class Row:
    tag: str
    title: str
    paras: list[str]
    image: str = ""          # path relative to /Products, empty = placeholder
    icon: str = "surround"   # placeholder icon key


@dataclass
class LineSpec:
    slug: str                # file name without .html
    name: str                # display name, may hold a trademark mark
    plain: str               # name without a mark, for the <title> tag
    tagline: str
    status: str = "live"     # live | pending
    eyebrow: str = "Product Line"
    hero_video: str = "../videos/hero-video.mp4"   # served from the repo
    intro_head: str = ""
    intro: str = ""
    features: list[Feature] = field(default_factory=list)
    rows: list[Row] = field(default_factory=list)
    models: list[Model] = field(default_factory=list)
    colors: list[Color] = field(default_factory=list)
    model_note: str = ""
    # Which warranty applies. The workbook holds this per product in
    # @Product_Warranty. Every line uses the 10 and 3 year warranty except
    # Glue-Up, whose eight products use the 5 and 2 year warranty.
    # A fresh object per line. Sharing one instance would let an edit to any
    # line rewrite the warranty on every other page.
    warranty: Warranty = field(default_factory=lambda: limited_warranty(10, 3))
    see_it: bool = True      # show the link to the product viewer
    editor_note: str = ""
    pending_body: list[str] = field(default_factory=list)


# ── Warranties ──────────────────────────────────────────────────────────────
# Both statements are the warranty text as supplied. Do not reword them.
# The two differ only in the consumer year and the commercial year, so one
# template builds both and they cannot drift apart.
#
# NOTE: both supplied statements give the claims address as Michigan 49407.
# Every other Lyons record, and the footer of every page, gives 49047, which
# is the Dowagiac ZIP. A claim must be mailed to this address within 30 days,
# so the pages use 49047. Correct the source files and this can be revisited.

def limited_warranty(consumer: int, commercial: int) -> Warranty:
    """Return the Lyons limited warranty for a consumer and commercial term."""
    return Warranty(
        term=f"{consumer} year and {commercial} year",
        summary=(
            f"{consumer} years in a residential owner-occupied building used for "
            f"non-commercial purposes. {commercial} years in any other building, "
            f"including rental, commercial, and business use."
        ),
        subheading=f"{consumer}-year consumer, {commercial}-year commercial",
        sections=[
        ("", (
            "Lyons Industries, Inc. warrants to the original purchaser that this "
            "Lyons fixture will be free of manufacturing defects, which affect its "
            "performance as a bathing or showering fixture, under the following "
            "conditions and subject to the limitations contained in the "
            "&ldquo;Remedies&rdquo; and &ldquo;Warranty Limitations&rdquo; sections. "
            f"The Limited Warranty applies for {consumer} years from the date of "
            "purchase if "
            "the fixture is used in a residential owner-occupied building for "
            f"non-commercial purposes; or for {commercial} years from the date of "
            "purchase if it "
            "is used in any other building, including any building used for rental, "
            "commercial or business purposes. This Limited Warranty is void if the "
            "fixture is not installed in accordance with the installation "
            "instructions supplied by Lyons or local building codes and ordinances "
            "or if the care and cleaning instructions supplied by Lyons are not "
            "followed. This Limited Warranty is also void if the fixture is moved "
            "from the location of its initial installation or is subjected to "
            "accident, abuse or misuse. The Limited Warranty excludes normal wear "
            "and tear and does not cover damage that can be repaired by following "
            "the Scratch Removal Instructions. This Limited Warranty shall be void "
            "unless any failure or non-conformance is discovered before the "
            "expiration of this warranty and is reported to Lyons, in writing, "
            "accompanied by the original proof of purchase, within 30 days of "
            "discovery, to: Lyons Industries, Inc., 30000 M-62 West, Dowagiac, "
            "Michigan 49047"
        )),
        ("Remedies", (
            "The original purchaser&rsquo;s remedy under this Limited Warranty is "
            "limited to the repair, replacement or refund of the purchase price of "
            "the fixture, at Lyons&rsquo; sole option, of any part of the fixture "
            "which has failed or does not conform to the manufacturer&rsquo;s "
            "specifications. In no event shall Lyons be liable for lost profits, "
            "loss of use, incidental, special or consequential damages including, "
            "but not limited to, damage to or loss of use of the building or its "
            "contents, arising out of any defect in the fixture; nor shall Lyons be "
            "liable for any amount in excess of the original purchase price of the "
            "fixture. Lyons reserves the right to require the return, at "
            "purchaser&rsquo;s expense, of the damaged fixture for repair or "
            "exchange before providing services under this Limited Warranty. If "
            "Lyons elects to replace the fixture, its obligation is limited to "
            "supplying a replacement unit or component part of comparable size and "
            "style, and does not include the cost of removal, installation, or "
            "transportation, which must be borne by the purchaser. Replacement "
            "parts provided under this Limited Warranty are warranted for the "
            "remainder of the original warranty period applicable to the fixture, "
            "as if such parts were original components of that fixture."
        )),
        ("Warranty Limitations", (
            "THERE ARE NO WARRANTIES WHICH EXTEND BEYOND THE DESCRIPTION ON THE "
            "FACE HEREOF. IMPLIED WARRANTIES, INCLUDING THOSE OF MERCHANTABILITY "
            "OR FITNESS FOR A PARTICULAR PURPOSE, ARE EXPRESSLY DISCLAIMED. LYONS "
            "DISCLAIMS ANY AND ALL LIABILITY FOR SPECIAL, INCIDENTAL OR "
            "CONSEQUENTIAL DAMAGES. Some states do not allow limitations of "
            "incidental or consequential damages, so the above limitations and "
            "exclusions may not apply to you. In such states, Lyons&rsquo; "
            "liability shall be limited to the extent permitted by state law. ANY "
            "IMPLIED WARRANTIES ARISING BY WAY OF STATE LAW, INCLUDING ANY IMPLIED "
            "WARRANTY OF MERCHANTABILITY OR ANY IMPLIED WARRANTY OF FITNESS FOR A "
            "PARTICULAR PURPOSE, ARE LIMITED IN DURATION AND IN SCOPE OF COVERAGE "
            "TO THE TERMS OF THIS LIMITED WARRANTY, UNLESS A SHORTER PERIOD IS "
            "ALLOWED BY LAW."
        )),
        ],
    )




def from_workbook(slug: str) -> list[Model]:
    """Build the model list for a line from the generated workbook data."""
    return [Model(**m) for m in MODELS.get(slug, [])]


# Colors per part number, so a hand-written Model gets the same colors as a
# generated one. Without this a hand-written model falls back to the whole
# line palette and offers colors that part is not made in.
COLORS_BY_PART: dict[str, list[str]] = {}
for _items in MODELS.values():
    for _m in _items:
        for _n in _m["number"].split(" / "):
            COLORS_BY_PART[_n] = _m["colors"]


def colors_of(m: Model) -> list[str]:
    """The colors one model is made in. The workbook decides, not the line."""
    if m.colors:
        return m.colors
    for n in m.number.split(" / "):
        if n in COLORS_BY_PART:
            return COLORS_BY_PART[n]
    return []


def colors_for(slug: str) -> list[Color]:
    """The colors this line offers, taken from the workbook."""
    return [
        Color(COLOR_CODES.get(c, ""), c, COLOR_IMAGES[c])
        for c in LINE_COLORS.get(slug, ["White"])
    ]


def michigan() -> Feature:
    """A fresh card each time, so one line cannot edit another line's copy."""
    return Feature(
        "Made in Michigan",
        "We mould, spray, and pack every part in our own Dowagiac plant.",
    )


def default_model_note(models: list[Model]) -> str:
    """Explain the drain letter only on a line that actually has drains.

    A grab bar panel also ends in R or L, but that marks the handing of the
    panel, not a drain, so it does not count.
    """
    has_drain = any(
        m.category != "Grab Bar Panel" and re.search(r"[RLC](?:$| /)", m.number)
        for m in models
    )
    drain = (
        "The last letter of a part number gives the drain position. R is right, "
        "L is left, and C is center. "
    ) if has_drain else ""
    return drain + "Call customer service for retailer locations."


def line_page(slug: str, name: str, plain: str, tagline: str, intro_head: str,
              intro: str, features: list[Feature] | None = None,
              rows: list[Row] | None = None, note: str = "") -> LineSpec:
    """A line page with real model data from the workbook.

    Every feature card comes from Product_Features in the workbook. A page
    with no features or no rows still carries an editor note.
    """
    features = features or []
    rows = rows or []
    models = from_workbook(slug)
    return LineSpec(
        slug=slug,
        name=name,
        plain=plain,
        tagline=tagline,
        intro_head=intro_head,
        intro=intro,
        features=features,
        rows=rows,
        models=models,
        colors=colors_for(slug),
        see_it=True,
        model_note=note or default_model_note(models),
        editor_note="" if (features and rows) else (
            "This page still needs feature cards or product rows. Delete this "
            "note before you publish."
        ),
    )


LINES: list[LineSpec] = [
    LineSpec(
        slug="Wave",
        name="Wave&trade;",
        plain="Wave",
        tagline="Direct-to-stud tub and shower systems. No tile, no grout, no guesswork.",
        eyebrow="Product Line",
        hero_video="../videos/Water-drop.mp4",
        intro_head="Built for the One-Visit Remodel",
        intro=(
            "Wave turns a demolition morning into a finished bathroom. The surround "
            "fastens straight to the studs, so you skip the tile, the grout, and the "
            "second trip. Four shelves are already moulded in, and every panel fits "
            "through a standard doorway."
        ),
        features=[
            Feature("One Crew, One Trip",
                    "The surround fastens straight to the studs. A finished wall, "
                    "the same day."),
            Feature("Shelves Already In",
                    "Four moulded shelves come standard. There is nothing extra to "
                    "buy and nothing to mount."),
            Feature("A Finish That Holds Up",
                    "Robotically sprayed fiberglass keeps the same wall thickness "
                    "across every panel."),
            Feature("Made in Michigan",
                    "We mould, spray, and pack every Wave part in our own Dowagiac "
                    "plant."),
        ],
        rows=[
            Row(
                tag="Surrounds",
                title="Seven Sizes, One Clean Wall",
                paras=[
                    "Seven surrounds, a piece for any sized alcove. Five sit over a "
                    "shower base. Two sit over a bathtub or a seated base.",
                    "Four shelves are already moulded in, and every panel clears a "
                    "standard doorway and a stairwell.",
                ],
                icon="surround",
            ),
            Row(
                tag="Shower Bases",
                title="A Low Step and Sure Footing",
                paras=[
                    "Five shower bases with an easy step threshold and a floor that "
                    "grips underfoot.",
                    "The 60 in. bases come with a right or a left drain. The smaller "
                    "bases drain from the center.",
                ],
                icon="base",
            ),
            Row(
                tag="Seated Bases",
                title="A Place to Sit, Moulded In",
                paras=[
                    "The seat is part of the base. There is no add-on bench, no "
                    "bracket to mount, and no seam to seal.",
                    "Seated bases take the same Wave surrounds and the same trim, so "
                    "the finished bathroom still matches.",
                ],
                icon="seat",
            ),
        ],
        models=[
            Model("WS01603274", '60" x 32" x 74"', SHOWER_SURROUND,
                  "Shower wall surround", group=SURROUND),
            Model("WS01306074", '60" x 30" x 74"', SHOWER_SURROUND,
                  "Shower wall surround", group=SURROUND),
            Model("WS01483474", '48" x 34" x 74"', SHOWER_SURROUND,
                  "Shower wall surround", group=SURROUND),
            Model("WS01363674", '36" x 36" x 74"', SHOWER_SURROUND,
                  "Shower wall surround", group=SURROUND),
            Model("WS01323274", '32" x 32" x 74"', SHOWER_SURROUND,
                  "Shower wall surround", group=SURROUND),
            Model("WS01603259", '60" x 32" x 59"', BATHTUB_SURROUND,
                  "Wall surround for a bathtub or a seated base", group=SURROUND),
            Model("WS01483459", '48" x 34" x 59"', BATHTUB_SURROUND,
                  "Wall surround for a bathtub or a seated base", group=SURROUND),
            Model("WB01603235R / WB01603235L", '60" x 32" x 3-1/2"', "Shower Base",
                  "Single threshold shower base, right or left drain"),
            Model("WB01603035R / WB01603035L", '60" x 30" x 3-1/2"', "Shower Base",
                  "Single threshold shower base, right or left drain"),
            Model("WB01483435C", '48" x 34" x 3-1/2"', "Shower Base",
                  "Single threshold shower base, center drain"),
            Model("WB01363635C", '36" x 36" x 3-1/2"', "Shower Base",
                  "Single threshold shower base, center drain"),
            Model("WB01323235C", '32" x 32" x 3-1/2"', "Shower Base",
                  "Single threshold shower base, center drain"),
            Model("WBSL01603219R / WBSR01603219L", '60" x 32" x 19"', "Seated Base",
                  "Seated shower base, right or left drain"),
            Model("WBSL01483419C", '48" x 34" x 19"', "Seated Base",
                  "Seated shower base, center drain"),
        ],
        colors=colors_for("Wave"),
        model_note=(
            "The last letter of a part number gives the drain position. R is "
            "right, L is left, and C is center. Call customer service for retailer "
            "locations."
        ),
    ),
    line_page(
        "Linear", "Linear&trade;", "Linear",
        "Clean-sided bathtubs in three depths, with surrounds to match.",
        "A Bathtub Built for Soaking",
        "Linear pairs a clean-sided 60 in. bathtub with a surround built for it. "
        "Three depths cover 30 in., 32 in., and 36 in., and the deepest holds 74 "
        "gallons. Every bathtub comes with a right or a left drain.",
        features=[
            Feature("Lumbar Support Moulded In",
                    "The bathing area carries moulded lumbar support, so the tub is "
                    "comfortable to lie back in."),
            Feature("Up to 74 Gallons",
                    "The three depths hold 63, 68, and 74 gallons."),
            Feature("Three 4 in. Shelves",
                    "The surround carries three shelves, each 4 in. deep."),
            michigan(),
        ],
        rows=[
            Row(tag="Bathtubs", title="Three Depths, One Footprint",
                paras=[
                    "Every Linear bathtub is 60 in. long. Pick the depth that suits "
                    "the room and the soak you want.",
                    "A reinforced integral apron carries the weight, and the flange "
                    "screws straight to the studs with no predrilling.",
                ], icon="base"),
            Row(tag="Surrounds", title="A Wall Made to Match",
                paras=[
                    "Two Linear II surrounds cover the 30 in. and the 32 in. depth, "
                    "each with three 4 in. shelves.",
                    "They fit most standard bathtubs, so a surround can go over a "
                    "tub that is already in place.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "Elite", "Elite&trade;", "Elite",
        "Our widest line. Bathtubs, bases, and surrounds, ready to schedule.",
        "One Line, the Whole Bathroom",
        "Elite is our widest line, and the Elite II surround is the new flagship. "
        "It covers bathtubs, shower bases, seated bases, and surrounds in both the "
        "59 in. and the 69 in. height. Builders order it to a schedule, and it "
        "suits a single bathroom just as well.",
        features=[
            Feature("The Elite II Flagship",
                    "Our newest surround leads the line in the 60 in. by 32 in. and "
                    "60 in. by 30 in. sizes."),
            Feature("Up to Six Shelves",
                    "Elite surrounds carry as many as six 3 in. shelves, and some "
                    "add a shave shelf."),
            Feature("One Person Installation",
                    "Apply the adhesive and screw to the studs. One installer can "
                    "set the wall."),
            michigan(),
        ],
        rows=[
            Row(tag="Surrounds", title="Two Heights, Nine Sizes",
                paras=[
                    "The 69 in. surrounds go over a shower base. The 59 in. "
                    "surrounds go over a bathtub or a seated base.",
                    "Sizes run from 32 in. by 32 in. up to 60 in. by 34 in., so "
                    "there is a wall for the opening you have.",
                ], icon="surround"),
            Row(tag="Bases", title="Shower Bases and Seated Bases",
                paras=[
                    "Five shower bases cover the common rough-ins, in both standard "
                    "floor and above floor rough.",
                    "Two seated bases add a moulded 18 in. seat for a bathroom that "
                    "needs somewhere to sit.",
                ], icon="seat"),
            Row(tag="Bathtubs", title="Three Bathtubs, Built to Last",
                paras=[
                    "Elite bathtubs come in 60 in. and 54 in. lengths, each with a "
                    "right or a left drain.",
                    "Moulded lumbar support and arm rests make the tub comfortable, "
                    "and a reinforced apron carries the load.",
                ], icon="base"),
        ],
    ),
    line_page(
        "Contour", "Contour&trade;", "Contour",
        "A transfer seat and a curved front, for a shower that is easy to enter.",
        "Built Around a Transfer Seat",
        "Contour moulds an extra large 18 in. transfer seat into the base, and the "
        "curved front opens up the room to shower in while still fitting a standard "
        "alcove. Two surrounds cover the 30 in. and the 32 in. depth.",
        features=[
            Feature("An 18 in. Transfer Seat",
                    "The extra large seat is part of the base and adds safety when "
                    "moving into the shower."),
            Feature("A Curved Front",
                    "The curve gives more room to shower in and still fits a "
                    "standard alcove."),
            Feature("Textured, Slip Resistant",
                    "The floor is textured across a spacious area for safer "
                    "footing."),
            michigan(),
        ],
        rows=[
            Row(tag="Seated Base", title="A Seat You Can Transfer Onto",
                paras=[
                    "The 60 in. by 32 in. seated base carries an extra large 18 in. "
                    "transfer seat, shaped to move onto from the side.",
                    "It comes with a right or a left drain, and the flange screws "
                    "straight to the studs.",
                ], icon="seat"),
            Row(tag="Surrounds", title="Walls That Fit the Base",
                paras=[
                    "Two surrounds cover the 30 in. and the 32 in. depth, each with "
                    "three 4 in. shelves.",
                    "They also fit most standard seated bases and bathtubs already "
                    "in place.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "Arcadia", "Arcadia&trade;", "Arcadia",
        "A bench shower base with a surround made to match.",
        "A Bench, Not an Add-On",
        "Arcadia moulds a comfortable bench seat into the shower base, so there is "
        "no separate bench to buy or mount. The base and the surround are both 60 "
        "in. by 32 in., and the base comes with a right or a left drain.",
        features=[
            Feature("An Integral Bench Seat",
                    "The bench is part of the base. There is nothing to mount and "
                    "no seam to seal."),
            Feature("Three 4 in. Shelves",
                    "The surround carries three shelves, each 4 in. deep."),
            Feature("Slip Resistant Area",
                    "A spacious slip resistant floor gives sure footing."),
            michigan(),
        ],
        rows=[
            Row(tag="Bench Base", title="Sit Down in the Shower",
                paras=[
                    "The 60 in. by 32 in. bench shower base carries a moulded seat "
                    "and a spacious slip resistant floor.",
                    "It comes with a right or a left drain and secures to the "
                    "subfloor with no predrilling.",
                ], icon="seat"),
            Row(tag="Surround", title="A Matching Wall",
                paras=[
                    "The Arcadia surround is built for the same 60 in. by 32 in. "
                    "footprint and carries three 4 in. shelves.",
                    "It also fits most standard bathtubs and seated bases.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "Triumph", "Triumph&trade;", "Triumph",
        "Surrounds reinforced for grab bars, with matching bar panels.",
        "Ready for Grab Bars",
        "Every Triumph surround is reinforced for grab bar installation, so bars "
        "can be fitted where they are needed rather than where a stud happens to "
        "fall. Matching grab bar panels come in back and side sizes.",
        features=[
            Feature("Reinforced for Grab Bars",
                    "The wall is reinforced behind the surface, ready for bars to "
                    "be secured."),
            Feature("ADA Compliant",
                    "Triumph is ADA compliant when the grab bars are installed as "
                    "shown in the panel drawings."),
            Feature("Two 4 in. Shelves",
                    "Each surround carries two shelves, both 4 in. deep."),
            michigan(),
        ],
        rows=[
            Row(tag="Surrounds", title="Four Sizes for a 59 in. Wall",
                paras=[
                    "Triumph surrounds cover 60 in. by 32 in., 60 in. by 30 in., 54 "
                    "in. by 30 in., and 54 in. by 27 in.",
                    "They fit most standard bathtubs and seated bases, so an "
                    "existing tub can stay in place.",
                ], icon="surround"),
            Row(tag="Grab Bar Panels", title="Bars Where They Are Needed",
                paras=[
                    "Back panels come in 54 in. and 60 in. Side panels come in 27 "
                    "in., 30 in., and 32 in.",
                    "Panels are supplied in left and right versions and in several "
                    "bar arrangements. Call customer service for the arrangement "
                    "you need.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "Victory", "Victory&trade;", "Victory",
        "A compact bathtub and seated bases that fit a 54 in. opening.",
        "Made for a 54 in. Opening",
        "Victory suits a bathroom where the opening is 54 in. rather than 60 in. "
        "The bathtub is 16 in. deep with head and lumbar support, and two seated "
        "bases add a moulded 15 in. seat.",
        features=[
            Feature("A 15 in. Integral Seat",
                    "The seated bases carry a comfortable moulded seat, 15 in. "
                    "tall."),
            Feature("Head and Lumbar Support",
                    "The bathtub is moulded with head and lumbar support for "
                    "bathing comfort."),
            Feature("Above Floor Rough",
                    "The seated bases suit an above floor rough, which helps in a "
                    "remodel over a slab."),
            michigan(),
        ],
        rows=[
            Row(tag="Bathtub", title="A Tub That Fits the Room",
                paras=[
                    "The Victory bathtub is 54 in. by 27 in. and 16 in. deep, with "
                    "head and lumbar support moulded in.",
                    "It comes with a right or a left drain and secures to the "
                    "subfloor with no predrilling.",
                ], icon="base"),
            Row(tag="Seated Bases", title="Two Depths, One Seat",
                paras=[
                    "Seated bases cover the 27 in. and the 30 in. depth, each with "
                    "a moulded 15 in. seat.",
                    "A spacious slip resistant floor gives sure footing, and the "
                    "base is reinforced with fiberglass and composite material.",
                ], icon="seat"),
        ],
    ),
    line_page(
        "SelectADA", "Select ADA&trade;", "Select ADA",
        "A 1 in. barrier free threshold, for a shower anyone can roll into.",
        "A Threshold Just 1 in. Tall",
        "Select ADA is built around a 1 in. barrier free threshold, so the shower "
        "can be entered without a step up. The base and the surround are both 60 "
        "in. by 30 in., and the surround stands 74 in. tall.",
        features=[
            Feature("A 1 in. Barrier Free Threshold",
                    "The base enters at 1 in., low enough to cross without a step "
                    "up."),
            Feature("Designated Grab Bar Areas",
                    "The surround has designated areas where grab bars can be "
                    "secured."),
            Feature("Will Not Crack, Chip, or Fade",
                    "The high gloss acrylic surface is scratch and stain "
                    "resistant."),
            michigan(),
        ],
        rows=[
            Row(tag="Shower Base", title="Enter Without a Step",
                paras=[
                    "The 60 in. by 30 in. base carries a 1 in. barrier free "
                    "threshold and a center drain.",
                    "Robotically sprayed fiberglass resin, composite materials, and "
                    "3 in. support feet carry the load. Floor leveling compound and "
                    "drain support are optional.",
                ], icon="base"),
            Row(tag="Surround", title="A 74 in. Wall With Bar Areas",
                paras=[
                    "The Select surround stands 74 in. tall on the same 60 in. by "
                    "30 in. footprint.",
                    "Grab bars secure in the designated areas, and the flange screws "
                    "direct to the studs with no predrilling.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "Garden", "Garden&trade;", "Garden",
        "A deep 54 in. by 42 in. alcove, for a bathroom with room to spare.",
        "Room Enough to Stretch Out",
        "Garden runs 42 in. deep in a 54 in. alcove, which is deeper than a "
        "standard tub opening. The line covers two bathtubs holding up to 65 "
        "gallons, a shower base, and the surround that goes over them.",
        features=[
            Feature("Up to 65 Gallons",
                    "The two Garden bathtubs hold 63 and 65 gallons."),
            Feature("10-1/2 in. Foot Rests",
                    "The shower base carries moulded foot rests for washing and "
                    "shaving."),
            Feature("A Removable Panel",
                    "A removable panel gives access after the bathtub is set."),
            michigan(),
        ],
        rows=[
            Row(tag="Bathtubs", title="A Long Soak in a Wide Tub",
                paras=[
                    "Two Garden bathtubs share the 54 in. by 42 in. footprint and "
                    "hold 63 and 65 gallons.",
                    "Both use a center drain, suit an above floor rough, and are "
                    "reinforced with fiberglass and composite materials.",
                ], icon="base"),
            Row(tag="Base and Surround", title="A Shower on the Same Footprint",
                paras=[
                    "The Garden shower base matches the bathtub footprint and adds "
                    "10-1/2 in. foot rests and a slip resistant floor.",
                    "The surround carries six 3 in. shelves and fits most garden "
                    "bathtubs and bases.",
                ], icon="surround"),
        ],
    ),
    line_page(
        "DropIn", "Drop-In&trade;", "Drop-In",
        "A 60 gallon bathtub that sets into an island or a deck you build.",
        "Set It Into Your Own Deck",
        "The Drop-In bathtub is designed for island installation. It drops into a "
        "deck or a platform you build rather than standing on its own, which leaves "
        "the surround and the finish entirely up to you.",
        features=[
            Feature("Designed for an Island",
                    "The tub is made to drop into a deck or a platform rather than "
                    "stand alone."),
            Feature("60 Gallons",
                    "The bathing well holds 60 gallons."),
            Feature("Reinforced for Support",
                    "Fiberglass and composite materials reinforce the shell for "
                    "maximum support."),
            michigan(),
        ],
        rows=[
            Row(tag="Bathtub", title="The Finish Is Yours to Choose",
                paras=[
                    "The Drop-In bathtub measures 42 in. by 60 in. and stands 19 "
                    "in. deep, with a 60 gallon bathing well.",
                    "Because it sets into a deck you build, the tile, stone, or "
                    "timber around it is your choice.",
                ], icon="base"),
        ],
        note="The Drop-In bathtub is available in White. Call customer service for "
             "retailer locations.",
    ),
    line_page(
        "SeaWave", "Sea Wave&trade;", "Sea Wave",
        "Corner baths that turn a small bathroom into somewhere to soak.",
        "A Soak in the Corner",
        "Sea Wave uses the corner, which is usually the space a small bathroom has "
        "to spare. The X model measures 54 in. across and the V model 48 in. The "
        "General Purpose surround in our Glue-Up line covers both.",
        features=[
            Feature("Up to 71 Gallons",
                    "The X model holds 71 gallons and the V model holds 59."),
            Feature("A Spacious Bathing Well",
                    "The well is shaped for comfort rather than for a straight "
                    "alcove."),
            Feature("A Removable Access Cover",
                    "An access cover lets you reach the plumbing after the bath is "
                    "set."),
            michigan(),
        ],
        rows=[
            Row(tag="Corner Baths", title="Two Sizes for the Corner",
                paras=[
                    "The Sea Wave X is 54 in. across and holds 71 gallons. The Sea "
                    "Wave V is 48 in. across and holds 59 gallons.",
                    "A reinforced integral apron carries the weight, and the flange "
                    "secures to the subfloor with no predrilling.",
                ], icon="base"),
            Row(tag="Matching Wall", title="One Surround Covers Both",
                paras=[
                    "The General Purpose surround in our Glue-Up line is made for "
                    "the Sea Wave X and the Sea Wave V.",
                    "It is the only surround we build for a corner bath, so the "
                    "wall and the bath are made to go together.",
                ], icon="surround"),
        ],
        note="The Sea Wave X is available in White and Biscuit. The Sea Wave V is "
             "available in White. Call customer service for retailer locations.",
    ),
    LineSpec(
        slug="GlueUp",
        name="Glue-Up",
        plain="Glue-Up",
        tagline="Cut to fit the base you already have. One panel, several sizes.",
        eyebrow="Product Line",
        intro_head="One Panel, Whatever Size You Need",
        intro=(
            "Glue-Up panels carry no sprayed fiberglass, so they can be cut on site. "
            "Trim a panel to the base already in the room instead of ordering a new "
            "size and waiting for it. Every panel in this line adjusts, and one panel "
            "covers as many as six sizes."
        ),
        features=[
            Feature("Cut It on Site",
                    "No sprayed fiberglass means you can trim a panel to the base "
                    "you already have."),
            Feature("One Style, Six Sizes",
                    "Monaco Premium alone covers six sizes. Most of the line covers "
                    "four."),
            Feature("The Wall Stays Put",
                    "Panels bond to the wall you already have. No demolition and no "
                    "dumpster."),
            Feature("Made in Michigan",
                    "We mould and pack every Glue-Up panel in our own Dowagiac "
                    "plant."),
        ],
        rows=[
            Row(
                tag="Adjustable",
                title="Stop Ordering a Second Panel",
                paras=[
                    "A stock size that does not match the base means a return and a "
                    "wait. A Glue-Up panel cuts down on site instead.",
                    "Convertible, Pro-Tough, Sedona, and Versatile each cover four "
                    "sizes from one part number.",
                ],
                icon="surround",
            ),
            Row(
                tag="The Widest Reach",
                title="From a Corner Bath to a 78 in. Wall",
                paras=[
                    "Monaco Premium trims from 60 in. by 36 in. down to 32 in. by 32 "
                    "in. Empire Tall carries the same idea up to 78 in. tall.",
                    "General Purpose fits the Sea Wave corner baths, so one panel "
                    "finishes a job most surrounds cannot reach.",
                ],
                icon="surround",
            ),
        ],
        models=[
            Model("MP0172", '60" x 36" x 72"', "Glue-Up Surround",
                  "Monaco Premium&trade; wall surround",
                  fits=['60" x 32" x 72"', '60" x 30" x 72"', '48" x 34" x 72"',
                        '36" x 36" x 72"', '32" x 32" x 72"']),
            Model("ES01603278", '60" x 32" x 78"', "Glue-Up Surround",
                  "Empire Tall wall surround",
                  fits=['60" x 30" x 78"', '54" x 30" x 78"', '54" x 27" x 78"']),
            Model("GP01605458", '60" x 54" x 58"', "Glue-Up Surround",
                  "General Purpose wall surround",
                  fits_note="Fits the Sea Wave X and the Sea Wave V",
                  pairs=["SXT01545419", "SVT01484820"]),
            Model("CP01603259", '60" x 32" x 58"', "Glue-Up Surround",
                  "Cove Pro wall surround",
                  fits=['60" x 30" x 58"', '54" x 30" x 58"', '54" x 27" x 58"']),
            Model("CON01603259", '60" x 32" x 59"', "Glue-Up Surround",
                  "Convertible wall surround",
                  fits=['60" x 30" x 59"', '54" x 30" x 59"', '54" x 27" x 59"']),
            Model("PF01603259", '60" x 32" x 59"', "Glue-Up Surround",
                  "Pro-Tough wall surround",
                  fits=['60" x 30" x 59"', '54" x 30" x 59"', '54" x 27" x 59"']),
            Model("SE01603259", '60" x 32" x 59"', "Glue-Up Surround",
                  "Sedona wall surround",
                  fits=['60" x 30" x 59"', '54" x 30" x 59"', '54" x 27" x 59"']),
            Model("VS01603259", '60" x 32" x 59"', "Glue-Up Surround",
                  "Versatile wall surround",
                  fits=['60" x 30" x 59"', '54" x 30" x 59"', '54" x 27" x 59"']),
        ],
        colors=colors_for("GlueUp"),
        model_note="Call customer service for retailer locations.",
        warranty=limited_warranty(5, 2),
    ),
]

# ── Shared markup ───────────────────────────────────────────────────────────

ICONS = {
    "surround": (
        '<rect x="8" y="8" width="48" height="40" rx="3" stroke="#7a9abf" '
        'stroke-width="2.5" fill="none"/>'
        '<line x1="24" y1="8" x2="24" y2="48" stroke="#7a9abf" stroke-width="2"/>'
        '<line x1="40" y1="8" x2="40" y2="48" stroke="#7a9abf" stroke-width="2"/>'
        '<rect x="8" y="48" width="48" height="8" rx="2" stroke="#7a9abf" '
        'stroke-width="2" fill="none"/>'
    ),
    "base": (
        '<rect x="6" y="34" width="52" height="18" rx="4" stroke="#7a9abf" '
        'stroke-width="2.5" fill="none"/>'
        '<line x1="6" y1="44" x2="58" y2="44" stroke="#7a9abf" stroke-width="2"/>'
        '<circle cx="32" cy="39" r="3" stroke="#7a9abf" stroke-width="2" fill="none"/>'
        '<line x1="32" y1="10" x2="32" y2="28" stroke="#7a9abf" stroke-width="2.5" '
        'stroke-linecap="round"/>'
    ),
    "seat": (
        '<rect x="10" y="8" width="44" height="48" rx="3" stroke="#7a9abf" '
        'stroke-width="2.5" fill="none"/>'
        '<path d="M14 44 H34 V56" stroke="#7a9abf" stroke-width="2.5" fill="none" '
        'stroke-linecap="round"/>'
        '<circle cx="32" cy="18" r="4" stroke="#7a9abf" stroke-width="2.5" fill="none"/>'
    ),
}

DOC_ICON = (
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" '
    'xmlns="http://www.w3.org/2000/svg">'
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" '
    'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
    '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" '
    'stroke-linejoin="round"/></svg>'
)

TOP_BAR = """  <div class="top-bar">
    <div class="container">
      Customer Service: <a href="tel:8004589036">(800) 458-9036</a> &bull;
      HR / Applicants: <a href="tel:2698690161">(269) 869-0161</a> (se habla espa&ntilde;ol)
    </div>
  </div>
"""

FOOTER = """  <footer id="contact">
    <div class="container">
      <h2>Lyons Industries</h2>
      <div class="contact-info">
        30000 M-62 West<br>Dowagiac, MI 49047
      </div>
      <div class="contact-info">
        Customer Service: <a href="tel:2697823404">(269) 782-3404</a> &bull; Toll Free: <a href="tel:8004589036">(800) 458-9036</a><br>
        HR: <a href="tel:2698690161">(269) 869-0161</a> (se habla espa&ntilde;ol)<br>
        Email: <a href="mailto:lyonssupport@lyonsindustries.com">lyonssupport@lyonsindustries.com</a><br>
        Office Hours: Monday &ndash; Friday, 8:00 am &ndash; 4:00 pm EST
      </div>
      <p class="small">&copy; 2026 Lyons Industries, Inc. &bull; Family-owned in Michigan since 1968</p>
    </div>
  </footer>
"""


def nav(active_slug: str) -> str:
    """Return the header block. The Products item carries the line dropdown."""
    items = ['              <li><a href="Products.html">All Products</a></li>']
    for line in LINES:
        cls = ' class="active"' if line.slug == active_slug else ""
        items.append(
            f'              <li><a href="{line.slug}.html"{cls}>{line.name}</a></li>'
        )
    dropdown = "\n".join(items)
    return f"""  <header class="header">
    <div class="container header-inner">
      <a href="../index.html" class="logo-link" aria-label="Lyons Industries Home">
        <div class="logo-wrapper">
          <div class="logo-circle"></div>
          <img src="../images/Lyons_Logo_2025.svg" alt="Lyons Industries Logo" class="logo-img">
        </div>
      </a>

      <button class="hamburger" aria-label="Toggle menu" aria-expanded="false" aria-controls="main-nav">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <nav class="main-nav" id="main-nav">
        <ul>
          <li><a href="../index.html" class="nav-link">Home</a></li>
          <li class="has-dropdown">
            <a href="Products.html" class="nav-link active">Products</a>
            <ul class="dropdown">
{dropdown}
            </ul>
          </li>
          <li class="has-dropdown">
            <a href="../About/Who.html" class="nav-link">About</a>
            <ul class="dropdown">
              <li><a href="../About/Who.html">Who We Are</a></li>
              <li><a href="../About/Team.html">Our Team</a></li>
              <li><a href="../About/Community.html">Community Involvement</a></li>
              <li><a href="../About/News.html">General News</a></li>
            </ul>
          </li>
          <li><a href="../Careers/Careers.html" class="nav-link">Careers</a></li>
          <li><a href="../Support/Contact.html" class="nav-link">Contact</a></li>
        </ul>
      </nav>
    </div>
  </header>
"""


def hero(line: LineSpec) -> str:
    return f"""  <section class="hero">
    <div class="video-wrap">
      <video class="hero-video" autoplay muted loop playsinline poster="../images/Lyons-Industries-1-aspect-ratio-1920-850.jpg">
        <source src="{line.hero_video}" type="video/mp4">
        Your browser does not support video.
      </video>
    </div>
    <div class="hero-content">
      <span class="line-eyebrow">{line.eyebrow}</span>
      <h1>{line.name}</h1>
      <p>{line.tagline}</p>
      <a href="#models" class="btn btn-primary">See the Models</a>
      <a href="../Support/Contact.html" class="btn btn-outline">Find a Retailer</a>
    </div>
  </section>
"""


def hero_pending(line: LineSpec) -> str:
    return f"""  <section class="hero">
    <div class="video-wrap">
      <video class="hero-video" autoplay muted loop playsinline poster="../images/Lyons-Industries-1-aspect-ratio-1920-850.jpg">
        <source src="{line.hero_video}" type="video/mp4">
        Your browser does not support video.
      </video>
    </div>
    <div class="hero-content">
      <span class="line-eyebrow">{line.eyebrow}</span>
      <h1>{line.name}</h1>
      <p>{line.tagline}</p>
      <a href="tel:8004589036" class="btn btn-primary">Call (800) 458-9036</a>
      <a href="Products.html" class="btn btn-outline">All Products</a>
    </div>
  </section>
"""


def switcher(active_slug: str) -> str:
    items = []
    for line in LINES:
        classes = []
        if line.slug == active_slug:
            classes.append("current")
        if line.status == "pending":
            classes.append("pending")
        cls = f' class="{" ".join(classes)}"' if classes else ""
        items.append(f'        <li><a href="{line.slug}.html"{cls}>{line.name}</a></li>')
    body = "\n".join(items)
    return f"""  <div class="line-switch">
    <div class="container">
      <p class="line-switch-label">Product Lines</p>
      <ul>
{body}
      </ul>
    </div>
  </div>
"""


def features_section(line: LineSpec) -> str:
    cards = "\n".join(
        f'        <div class="card"><h3>{f.title}</h3><p>{f.body}</p></div>'
        for f in line.features
    )
    intro = f"""  <section class="line-intro">
    <div class="container">
      <h2>{line.intro_head}</h2>
      <p>{line.intro}</p>
    </div>
  </section>
"""
    if not line.features:
        return intro
    return intro + f"""
  <section class="alt-bg">
    <div class="container">
      <div class="grid">
{cards}
      </div>
    </div>
  </section>
"""


def rows_section(line: LineSpec) -> str:
    if not line.rows:
        return ""
    blocks = []
    for i, row in enumerate(line.rows):
        flip = " image-left" if i % 2 else ""
        paras = "\n".join(f"          <p>{p}</p>" for p in row.paras)
        if row.image:
            media = f'        <img src="{row.image}" alt="{row.title}">'
        else:
            media = f"""        <div class="img-placeholder">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            {ICONS.get(row.icon, ICONS["surround"])}
          </svg>
          Product image &mdash; {row.title}
        </div>"""
        blocks.append(f"""    <div class="product-row{flip}">
      <div class="product-text">
        <div class="product-text-inner">
          <span class="product-tag">{row.tag}</span>
          <h3>{row.title}</h3>
{paras}
        </div>
      </div>
      <div class="product-image">
{media}
      </div>
    </div>""")
    body = "\n\n".join(blocks)
    return f"""  <div class="product-section">
{body}
  </div>
"""


def footprint(size: str) -> tuple[str, str]:
    """Return the (key, label) of the width x depth footprint in a size string.

    '60" x 32" x 74"' gives ('60x32', '60" x 32"'). The height is dropped, so
    a surround, a base, and a seated base of one footprint share one filter.
    """
    # The fraction may be written 3-1/2 or 19 3/4, so allow either separator.
    nums = re.findall(r'(\d+)(?:[- ]\d+/\d+)?"', size)
    if len(nums) < 2:
        return ("", "")
    return (f"{nums[0]}x{nums[1]}", f'{nums[0]}" x {nums[1]}"')


def models_section(line: LineSpec) -> str:
    # Group the models. A model without a group falls back to its category.
    # Hold the order of first appearance.
    groups: dict[str, list[Model]] = {}
    for m in line.models:
        groups.setdefault(m.group or m.category, []).append(m)

    # Collect one filter chip per distinct footprint. Put the widest first.
    # A model that cuts down to other sizes contributes every one of them.
    labels: dict[str, str] = {}
    for m in line.models:
        for size in [m.size, *m.fits]:
            key, label = footprint(size)
            if key and key not in labels:
                labels[key] = label
    ordered = sorted(labels, key=lambda k: tuple(-int(n) for n in k.split("x")))

    chips = ['          <button type="button" class="filter-chip is-active" '
             'data-size="all" aria-pressed="true">All sizes</button>']
    chips += [
        f'          <button type="button" class="filter-chip" data-size="{k}" '
        f'aria-pressed="false">{labels[k]}</button>'
        for k in ordered
    ]
    chips_html = "\n".join(chips)

    def row_html(m: Model) -> str:
        keys = dict.fromkeys(
            footprint(s)[0] for s in [m.size, *m.fits] if footprint(s)[0]
        )
        extra = ""
        if m.fits:
            extra = ('<span class="size-fits">cuts to '
                     + ", ".join(m.fits) + "</span>")
        elif m.fits_note:
            extra = f'<span class="size-fits">{m.fits_note}</span>'
        nominal = footprint(m.size)[0]
        return f"""              <tr data-size="{' '.join(keys)}" data-nominal="{nominal}">
                <td class="model">{m.number}<span class="cut-flag" hidden>Cut to fit</span></td>
                <td class="size">{m.size}{extra}</td>
                <td>{m.category}</td>
                <td>{m.description}{f'<span class="model-detail">{m.detail}</span>' if m.detail else ''}</td>
              </tr>"""

    blocks = []
    for category, items in groups.items():
        rows = "\n".join(row_html(m) for m in items)
        blocks.append(f"""      <details class="model-group" data-type="{category}" open>
        <summary>
          <span class="group-name">{category}s</span>
          <span class="group-count"><span data-count>{len(items)}</span> models</span>
        </summary>
        <div class="spec-table-wrap">
          <table class="spec-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Size (W x D x H)</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
{rows}
            </tbody>
          </table>
        </div>
      </details>""")
    groups_html = "\n".join(blocks)

    colors = ""
    if line.colors:
        swatches = "\n".join(
            f"""          <li class="color-swatch">
            <img src="{c.image}" alt="{c.name} finish">
            <span class="color-code">{c.code or "&mdash;"}</span>
            <span class="color-name">{c.name}</span>
          </li>"""
            for c in line.colors
        )
        coded = [c for c in line.colors if c.code]
        code_note = (
            "White and Biscuit carry a color code in the part number. The other "
            "colors are ordered by name. "
        ) if len(coded) < len(line.colors) else (
            "The color code follows the letter prefix in each part number. "
        )
        colors = f"""      <div class="color-key">
        <p class="color-key-label">Colors</p>
        <ul>
{swatches}
        </ul>
        <p class="color-key-note">{code_note}The color you see here can vary a
          little from the product. Plumbing accessories are not included.</p>
      </div>
"""

    seeit = ""
    # One set decides both halves of this. A line the viewer leaves out must
    # not carry a button to it, or the button is a dead end.
    if line.see_it and line.slug not in SKIP_LINES:
        seeit = ('      <p class="seeit-link"><a class="btn btn-primary" '
                 'href="SeeIt.html">See it in a bathroom</a></p>\n')

    note = f'      <p class="table-note">{line.model_note}</p>\n' if line.model_note else ""
    editor = ""
    if line.editor_note:
        editor = (
            '      <!-- INTERNAL NOTE: delete this block before you publish. -->\n'
            '      <div class="editor-note"><strong>Internal note</strong>'
            f"{line.editor_note}</div>\n"
        )
    return f"""  <section id="models" class="alt-bg models-block">
    <div class="container">
      <h2>{line.plain} Models</h2>
      <div class="model-filters">
        <p class="filter-label" id="{line.slug}-filter-label">Filter by size (width x depth)</p>
        <div class="filter-chips" role="group" aria-labelledby="{line.slug}-filter-label">
{chips_html}
        </div>
        <p class="filter-empty" hidden>No model has this size.</p>
      </div>
      <div class="model-groups">
{groups_html}
      </div>
{colors}{note}{editor}{seeit}    </div>
  </section>
"""


# Taken from Product_Spec_Disclaimer in the master workbook. That field writes
# the ASME standard as "ASME:A1.19.7", which is a dropped digit. The correct
# number is A112.19.7, confirmed, and used here. Fix the workbook to match.
#
# The workbook applies the whole disclaimer to all 88 products. ANSI Z124.1
# covers plastic bathtub units and ASME A112.19.7 covers whirlpool bathtubs,
# so those two lines only go on a page that holds a bathtub. The rest apply
# to every product.
COMPLIANCE_BATHTUB = [
    "Complies with ANSI Z124.1 and CAN/CSA-B45.",
    "Complies with ASME A112.19.7 and CAN/CSA-B45.10.",
]

COMPLIANCE_ALL = [
    "CAN/ULC S102.2 Flame-75 and Smoke Developed-485 code.",
    "All product is subject to a manufacturing tolerance of plus or minus 1/8 in.",
    "Design and features may change without notice.",
]


def compliance_for(line: LineSpec) -> list[str]:
    has_bathtub = any(m.category == "Bathtub" for m in line.models)
    return (COMPLIANCE_BATHTUB if has_bathtub else []) + COMPLIANCE_ALL


def warranty_section(line: LineSpec) -> str:
    w = line.warranty
    points = "\n".join(f"          <li>{c}</li>" for c in compliance_for(line))

    summary = f'        <p class="warranty-summary">{w.summary}</p>\n' if w.summary else ""

    full = ""
    if w.sections:
        blocks = []
        if w.subheading:
            blocks.append(f'            <p class="warranty-sub">{w.subheading}</p>')
        for head, body in w.sections:
            if head:
                blocks.append(f"            <h4>{head}</h4>")
            cls = ' class="warranty-caps"' if head == "Warranty Limitations" else ""
            blocks.append(f"            <p{cls}>{body}</p>")
        inner = "\n".join(blocks)
        full = f"""        <details class="warranty-full">
          <summary>Read the full limited warranty</summary>
          <div class="warranty-text">
            <h3>Lyons Fixture Limited Warranty</h3>
{inner}
          </div>
        </details>
"""
    else:
        full = (f'        <p>Read the warranty statement for the terms that apply.</p>\n'
                f'        <p><a href="#">See the {line.plain} warranty statement '
                f'(PDF)</a></p>\n')

    return f"""  <section id="warranty" class="warranty-block">
    <div class="container">
      <h2>Warranty and Compliance</h2>
      <div class="warranty-card">
        <p class="warranty-term">{w.term} warranty</p>
{summary}{full}      </div>
      <ul class="compliance-list">
{points}
      </ul>
    </div>
  </section>
"""


def docs_section(line: LineSpec) -> str:
    return f"""  <section id="documents">
    <div class="container">
      <h2>Documents</h2>
      <ul class="doc-list">
        <li><a href="#">{DOC_ICON}<span>{line.plain} specification sheets (PDF)</span></a></li>
        <li><a href="#">{DOC_ICON}<span>{line.plain} installation instructions (PDF)</span></a></li>
        <li><a href="#">{DOC_ICON}<span>Care and cleaning guide (PDF)</span></a></li>
        <li><a href="#">{DOC_ICON}<span>Warranty statement (PDF)</span></a></li>
      </ul>
      <!-- Point each href at the PDF once you upload it to /docs. -->
    </div>
  </section>
"""


def pending_section(line: LineSpec) -> str:
    paras = "\n".join(f"        <p>{p}</p>" for p in line.pending_body)
    return f"""  <section>
    <div class="container">
      <div class="card coming-soon">
        <span class="badge-soon">Page in progress</span>
        <h3>{line.plain}</h3>
{paras}
        <p style="margin-top:2rem;">
          <a href="tel:8004589036" class="btn btn-primary">Call (800) 458-9036</a>
          <a href="../Support/Contact.html" class="btn btn-outline" style="background:var(--primary); color:var(--surface); border-color:var(--primary);">Contact Us</a>
        </p>
      </div>
    </div>
  </section>
"""


def retailer_cta() -> str:
    return """  <section class="retailer-cta">
    <div class="container">
      <h2>Looking for a Retailer?</h2>
      <p>Lyons products are sold at hardware stores nationwide. Our customer service team can point you to a dealer near you.</p>
      <a href="tel:8004589036" class="btn btn-primary">Call (800) 458-9036</a>
      <a href="../Support/Contact.html" class="btn btn-outline" style="background:white; color:var(--primary); border-color:var(--primary);">Contact Us</a>
    </div>
  </section>
"""


def head(line: LineSpec) -> str:
    desc = f"{line.plain} from Lyons Industries &mdash; {line.tagline}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{line.plain} &mdash; Lyons Industries</title>
  <meta name="description" content="{desc}">
  <link rel="icon" href="../images/Lyons_Logo_2025.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/styles.css">
  <link rel="stylesheet" href="../css/Products.css">
  <link rel="stylesheet" href="../css/Lines.css">
</head>
<body>
"""


def render(line: LineSpec) -> str:
    parts = [head(line), TOP_BAR, nav(line.slug)]
    if line.status == "pending":
        parts += [hero_pending(line), switcher(line.slug), pending_section(line)]
    else:
        parts += [
            hero(line),
            switcher(line.slug),
            features_section(line),
            rows_section(line),
            models_section(line),
            warranty_section(line),
            docs_section(line),
        ]
    parts += [retailer_cta(), FOOTER]
    parts.append('  <script src="../js/script.js"></script>\n</body>\n</html>\n')
    return "\n".join(parts)


# ── Write ───────────────────────────────────────────────────────────────────




FIXTURE_CATEGORIES = {"Bathtub", "Shower Base", "Seated Base"}

# A corner bath sits across the corner instead of in an alcove. Nothing in
# the workbook names a shape, so the line has to. Sea Wave holds two square
# baths, 54 x 54 and 48 x 48, and no other line holds one.
CORNER_LINES = {"SeaWave"}

# A drop-in bath sets into a deck that a builder frames, not into an alcove,
# and no surround is made to go over one. The viewer starts from an alcove,
# so it leaves the line out. The line still has its own page.
SKIP_LINES = {"DropIn"}

# A wall pairs with a fixture by the step over the rim, not by what the
# fixture is called. Every fixture in the workbook is either 3-1/2 to 5-1/2
# in. tall, which you walk into, or 16 to 20 in., which you step over. Every
# wall is 58 or 59 in., or 69 in. and up. Both gaps are wide, so one number
# splits each of them cleanly.
#
# Calling a fixture low because the workbook types it a Base is what broke
# the Garden line: the Garden Shower Base is 19 in. tall, so the 59 in.
# Elite Garden Surround is exactly the wall that belongs on it.
TALL_PIECE_IN = 10   # a fixture this tall or taller counts as tall
TALL_WALL_IN = 64    # a wall this tall or taller goes over a low base

DRAIN_LABELS = {"R": "Right", "L": "Left", "C": "Center", "": "Standard"}

# The tiles are laid out left to right, so the choices go in that order too.
# A right drain must be the tile on the right.
DRAIN_ORDER = {"L": 0, "C": 1, "R": 2, "": 3}


def whole_inches(size: str) -> list[int]:
    return [int(n) for n in re.findall(r'(\d+)(?:[- ]\d+/\d+)?"', size)]


def exact_inches(size: str) -> list[float]:
    """Every dimension as a number, with the fraction kept.

    whole_inches drops the fraction, which is good enough to match an alcove
    but not to build a model: it turns a 3-1/2 in. base and a 5-1/2 in. base
    into 3 and 5, and the wall that sits on the rim then lands in the air.
    """
    out = []
    for m in re.finditer(r'(\d+)(?:[- ](\d+)/(\d+))?"', size):
        n = float(m.group(1))
        if m.group(2):
            n += int(m.group(2)) / int(m.group(3))
        out.append(n)
    return out


def drain_variants(number: str) -> list[dict]:
    """Split a merged part number into one entry per drain position."""
    out = []
    for part in number.split(" / "):
        m = re.search(r"([RLC])$", part)
        code = m.group(1) if m else ""
        out.append({"drain": code, "label": DRAIN_LABELS[code], "number": part})
    return sorted(out, key=lambda v: DRAIN_ORDER[v["drain"]])


def sits(m: Model, dims: list[int]) -> str:
    """tall = a bathtub, a seat, or a garden base. low = a walk-in base.

    The word has to match the one the wall uses, since the two are compared
    on the page. Both say tall or low.
    """
    if len(dims) > 2:
        return "tall" if dims[2] >= TALL_PIECE_IN else "low"
    # The ADA Select base carries no height in its name. It is a roll-in
    # shower base, so it is low.
    return "tall" if m.category in ("Bathtub", "Seated Base") else "low"


def panel_role(text: str) -> tuple[str, int]:
    """A grab bar panel is a back panel or a side panel, at one width.

    The workbook writes the job into the name: 60" Back Panel, 32" Side
    Panels. The back panel matches the width of the alcove and the side
    panels match its depth, so both can be held to the opening.
    """
    n = whole_inches(text)
    role = "back" if "Back" in text else ("side" if "Side" in text else "")
    return role, (n[0] if n else 0)


# The wizard. Written apart from the page so that the braces need no
# escaping. __DATA__ is replaced with the product data before it is written.
SEEIT_JS = """
  (function () {
    var DATA = __DATA__;

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, html) {
      var n = document.createElement(tag);
      if (cls) { n.className = cls; }
      if (html !== undefined) { n.innerHTML = html; }
      return n;
    }

    function uniq(a) {
      return a.filter(function (v, i) { return a.indexOf(v) === i; });
    }
    function down(a, b) { return b - a; }

    var railBox = $('seeit-rail');
    var panelBox = $('seeit-panel');
    var buildBox = $('build-list');
    var caption = $('scene-caption');
    var viewBox = $('seeit-view');

    // pending until the library answers, then 3d or flat. The wizard runs
    // the same either way; only the picture changes.
    var mode = 'pending';
    var viewer = null;
    var shot = null;

    var TYPES = ['Bathtub', 'Shower Base', 'Seated Base'];

    // A piece is tall or low. That is what sets the height of the wall over
    // it, and the workbook holds the number: 3-1/2 to 5-1/2 in. for a base
    // you walk into, 16 to 20 in. for a bathtub, a seat, or a garden base.
    var STANDS = {
      tall: {label: 'A bathtub or a seat', note: 'you step over a rim'},
      low: {label: 'A low shower base', note: 'you walk straight in'}
    };

    var STEPS = [
      {id: 'alcove', title: 'Alcove', head: 'Your alcove',
       hint: 'Start here. The opening is the one measurement you cannot change.'},
      {id: 'piece', title: 'Bathtub or base', head: 'Bathtub or base',
       hint: 'Everything below fits that opening, whichever line it comes from.'},
      {id: 'drain', title: 'Drain', head: 'Drain location',
       hint: 'Match the drain that is already in the floor.'},
      {id: 'wall', title: 'Wall', head: 'Wall surround',
       hint: 'A wall can come from another line, as long as it suits the opening and the piece under it.'},
      {id: 'panels', title: 'Grab bars', head: 'Grab bar panels',
       hint: 'This wall is reinforced for grab bars. Take the back panel, the side panels, both, or neither.'},
      {id: 'color', title: 'Color', head: 'Colors',
       hint: 'The bathtub or base and the wall are picked apart, so the two can differ.'}
    ];

    // A step that only exists in some builds. It is left out of the rail
    // rather than shown greyed, because a greyed step you can never reach
    // reads as a fault.
    var SOMETIMES = {drain: true, panels: true};

    var S, at;

    function blank() {
      S = {shape: null, width: null, depth: null, type: null, fixKey: null,
           drain: null, over: null, wallKey: null, extras: [],
           baseColor: null, wallColor: null, panelsSet: false,
           colorSet: false};
      at = 'alcove';
    }

    // ── What fits ──────────────────────────────────────────────────────
    function here() {
      if (S.width === null || S.depth === null) { return []; }
      return DATA.fixtures.filter(function (m) {
        return m.shape === S.shape && m.w === S.width && m.d === S.depth;
      });
    }

    function typeList() {
      return TYPES.filter(function (t) {
        return here().some(function (f) { return f.category === t; });
      });
    }

    function ofType() {
      return here().filter(function (f) { return f.category === S.type; });
    }

    function fixture() {
      if (!S.type || S.type === 'none') { return null; }
      return ofType().filter(function (f) {
        return f.number === S.fixKey;
      })[0] || null;
    }

    function variant() {
      var f = fixture();
      if (!f || S.drain === null) { return null; }
      return f.variants.filter(function (v) {
        return v.drain === S.drain;
      })[0] || null;
    }

    // With a piece chosen the height follows from it. With none chosen the
    // customer says what is already there.
    function standing() {
      var f = fixture();
      return f ? f.sits : S.over;
    }

    // A wall suits the opening if it is built for it, cuts down to it, or
    // is named as the partner of a piece that fits it.
    function wallsHere() {
      var key = S.width + 'x' + S.depth;
      var mine = here().map(function (f) { return f.number; });
      return DATA.walls.filter(function (w) {
        if (w.shape === S.shape && w.w === S.width && w.d === S.depth) { return true; }
        if (w.fits.indexOf(key) !== -1) { return true; }
        return w.pairs.some(function (p) { return mine.indexOf(p) !== -1; });
      });
    }

    function wallList() {
      if (S.width === null || S.depth === null) { return []; }
      var want = standing();
      return wallsHere().filter(function (w) { return !want || w.over === want; });
    }

    function wallAt(key) {
      return wallList().filter(function (w) { return w.number === key; })[0] || null;
    }

    function wall() {
      return (!S.wallKey || S.wallKey === 'none') ? null : wallAt(S.wallKey);
    }

    function cutToFit(w) {
      return !(w.w === S.width && w.d === S.depth) &&
             w.fits.indexOf(S.width + 'x' + S.depth) !== -1;
    }

    // A grab bar panel belongs to the line of the wall, and to one face of
    // it. The back panel is as wide as the alcove, the side panels as deep.
    function extraList() {
      var w = wall();
      if (!w) { return []; }
      return DATA.extras.filter(function (e) {
        if (e.line !== w.line) { return false; }
        return e.role === 'back' ? e.inches === S.width : e.inches === S.depth;
      });
    }

    function extrasOn() {
      return extraList().filter(function (e) {
        return S.extras.indexOf(e.number) !== -1;
      });
    }

    function baseColors() { var f = fixture(); return f ? f.colors : []; }
    function wallColors() { var w = wall(); return w ? w.colors : []; }

    // Hold every answer that is still on offer, and drop the ones that are
    // not. Clearing the whole tail on each click threw away answers that
    // were still good. Leaving a stale key made a step look answered when
    // nothing was in fact selected.
    function clamp() {
      var f = fixture();
      if (!f) {
        S.drain = null;
      } else {
        var codes = f.variants.map(function (v) { return v.drain; });
        if (codes.indexOf(S.drain) === -1) {
          // One drain position is not a choice. Take it.
          S.drain = codes.length === 1 ? codes[0] : null;
        }
      }

      if (S.wallKey && S.wallKey !== 'none' && !wallAt(S.wallKey)) {
        S.wallKey = null;
      }

      var offered = extraList().map(function (e) { return e.number; });
      S.extras = S.extras.filter(function (n) { return offered.indexOf(n) !== -1; });
      if (!offered.length) { S.panelsSet = false; }

      var b = baseColors(), c = wallColors();
      if (b.indexOf(S.baseColor) === -1) { S.baseColor = b[0] || null; }
      if (c.indexOf(S.wallColor) === -1) { S.wallColor = c[0] || null; }
      if (!b.length && !c.length) { S.colorSet = false; }
    }

    // ── Which steps are open, and which are answered ───────────────────
    function can(id) {
      var sized = S.width !== null && S.depth !== null;
      var skipping = S.type === 'none' && !!S.over;
      if (id === 'alcove') { return true; }
      if (id === 'piece') { return sized; }
      if (id === 'drain') {
        var f = fixture();
        return !!f && f.variants.length > 1;
      }
      if (id === 'wall') { return sized && (skipping || !!fixture()); }
      if (id === 'panels') { return !!wall() && extraList().length > 0; }
      if (id === 'color') { return !!fixture() || !!wall(); }
      return false;
    }

    function answered(id) {
      if (id === 'alcove') { return S.width !== null && S.depth !== null; }
      if (id === 'piece') {
        return (S.type === 'none' && !!S.over) || !!fixture();
      }
      if (id === 'drain') { return S.drain !== null; }
      if (id === 'wall') { return S.wallKey !== null; }
      if (id === 'panels') { return S.panelsSet; }
      if (id === 'color') { return S.colorSet; }
      return false;
    }

    function open() { return STEPS.filter(function (s) { return can(s.id); }); }

    function railSteps() {
      return STEPS.filter(function (s) { return !SOMETIMES[s.id] || can(s.id); });
    }

    function place(list, id) {
      var i = -1;
      list.forEach(function (s, n) { if (s.id === id) { i = n; } });
      return i;
    }

    function hop(delta) {
      var list = open();
      var t = list[place(list, at) + delta];
      if (t) { at = t.id; draw(); }
    }

    // Go to the first step after this one that has no answer yet. Change an
    // answer that leaves the rest of the build standing and you stay put,
    // so two models can be compared. Change one that knocks the rest out
    // and it carries you to the first gap it made.
    function advance(id) {
      var list = open();
      var i = place(list, id);
      if (i < 0) { return; }
      for (var n = i + 1; n < list.length; n++) {
        if (!answered(list[n].id)) { at = list[n].id; return; }
      }
    }

    // ── Pieces of a panel ──────────────────────────────────────────────
    function group(title, node) {
      var g = el('div', 'seeit-group');
      if (title) { g.appendChild(el('h3', null, title)); }
      g.appendChild(node);
      return g;
    }

    function tiles(items, active, pick) {
      if (!items.length) {
        return el('p', 'seeit-empty', 'Nothing is made in this size.');
      }
      var box = el('div', 'seeit-tiles');
      items.forEach(function (it) {
        var on = String(it.key) === String(active);
        var b = el('button', 'tile' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<strong>' + it.label + '</strong>' +
                      (it.note ? '<span>' + it.note + '</span>' : '');
        b.addEventListener('click', function () { pick(it.key); });
        box.appendChild(b);
      });
      return box;
    }

    function cards(items, isOn, pick) {
      if (!items.length) {
        return el('p', 'seeit-empty', 'Nothing is made in this size.');
      }
      var box = el('div', 'seeit-cards');
      items.forEach(function (it) {
        var on = isOn(it);
        var b = el('button', 'mcard' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<span class="mc-line">' + it.line + '</span>' +
                      '<strong class="mc-name">' + it.name + '</strong>' +
                      (it.size ? '<span class="mc-size">' + it.size + '</span>' : '') +
                      (it.part ? '<span class="mc-part">' + it.part + '</span>' : '') +
                      (it.flag ? '<span class="mc-flag">' + it.flag + '</span>' : '');
        b.addEventListener('click', function () { pick(it.key); });
        box.appendChild(b);
      });
      return box;
    }

    function swatches(names, active, pick) {
      if (!names.length) {
        return el('p', 'seeit-empty', 'Pick a model first.');
      }
      var box = el('div', 'seeit-swatches');
      names.forEach(function (n) {
        var on = n === active;
        var b = el('button', 'swatch' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.title = n;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<img src="' + DATA.colorImages[n] + '" alt="">' +
                      '<span>' + n + '</span>';
        b.addEventListener('click', function () { pick(n); });
        box.appendChild(b);
      });
      return box;
    }

    function note(text) { return el('p', 'seeit-note-inline', text); }

    function byKey(key) { return function (it) { return it.key === key; }; }

    // ── The panels ─────────────────────────────────────────────────────
    function widthItems() {
      var ws = uniq(DATA.fixtures.filter(function (m) {
        return m.shape === 'alcove';
      }).map(function (m) { return m.w; })).sort(down);
      var items = ws.map(function (w) {
        return {key: 'a' + w, label: w + '″', note: 'wide'};
      });
      if (DATA.fixtures.some(function (m) { return m.shape === 'corner'; })) {
        items.push({key: 'corner', label: 'Corner', note: 'across the corner'});
      }
      return items;
    }

    function depthItems() {
      if (S.shape === null) { return []; }
      var list = DATA.fixtures.filter(function (m) {
        return m.shape === S.shape && (S.shape === 'corner' || m.w === S.width);
      });
      return uniq(list.map(function (m) {
        return S.shape === 'corner' ? m.w : m.d;
      })).sort(down).map(function (d) {
        return {key: d, label: d + '″',
                note: S.shape === 'corner' ? 'along each wall' : 'deep'};
      });
    }

    function panelAlcove() {
      panelBox.appendChild(group('Width, or a corner', tiles(
        widthItems(),
        S.shape === 'corner' ? 'corner' : (S.width === null ? '' : 'a' + S.width),
        function (k) {
          var shape = k === 'corner' ? 'corner' : 'alcove';
          var width = k === 'corner' ? null : parseInt(k.slice(1), 10);
          // Clicking the answer you already gave must not wipe the build.
          if (S.shape === shape && (shape === 'corner' || S.width === width)) {
            return;
          }
          S.shape = shape; S.width = width;
          S.depth = null; S.type = null; S.fixKey = null; S.over = null;
          S.wallKey = null;
          draw();
        })));

      if (S.shape !== null) {
        panelBox.appendChild(group(
          S.shape === 'corner' ? 'Along each wall' : 'Depth',
          tiles(depthItems(), S.depth === null ? '' : S.depth, function (k) {
            if (S.depth === k) { return; }
            S.depth = k;
            if (S.shape === 'corner') { S.width = k; }
            S.type = null; S.fixKey = null; S.over = null; S.wallKey = null;
            advance('alcove');
            draw();
          })));
      }
    }

    function panelPiece() {
      var items = typeList().map(function (t) {
        var n = here().filter(function (f) { return f.category === t; }).length;
        return {key: t, label: t, note: n + (n === 1 ? ' model' : ' models')};
      });
      // Replacing only the wall is a real job, so it needs a way through.
      items.push({key: 'none', label: 'None', note: 'wall only'});

      panelBox.appendChild(group('Which piece', tiles(
        items, S.type === null ? '' : S.type, function (k) {
          if (S.type === k) { return; }
          S.type = k; S.fixKey = null; S.over = null; S.wallKey = null;
          draw();
        })));

      if (S.type === 'none') {
        // Skipping the piece still leaves a question: the wall has to be
        // the right height for whatever is staying. Ask it here, next to
        // the choice that raised it, not two steps later.
        panelBox.appendChild(group('What is already there', tiles(
          ['tall', 'low'].map(function (k) {
            return {key: k, label: STANDS[k].label, note: STANDS[k].note};
          }), S.over || '', function (k) {
            S.over = k; S.wallKey = null;
            advance('piece');
            draw();
          })));
      } else if (S.type) {
        panelBox.appendChild(group('Model', cards(
          ofType().map(function (f) {
            return {key: f.number, line: f.lineName, name: f.description,
                    size: f.size, part: f.number};
          }), byKey(S.fixKey), function (k) {
            S.fixKey = k;
            advance('piece');
            draw();
          })));
      }
    }

    function panelDrain() {
      var f = fixture();
      panelBox.appendChild(group(null, tiles(
        (f ? f.variants : []).map(function (v) {
          return {key: v.drain, label: v.label, note: v.number};
        }), S.drain === null ? '' : S.drain, function (k) {
          S.drain = k;
          advance('drain');
          draw();
        })));
    }

    function panelWall() {
      var f = fixture();
      var stands = standing();
      panelBox.appendChild(note(f
        ? 'The ' + f.description.toLowerCase() + ' sets the height, so these ' +
          'are the walls that go over ' + STANDS[stands].label.toLowerCase() + '.'
        : 'These are the walls that go over ' +
          STANDS[stands].label.toLowerCase() + '.'));

      // A few openings have a bathtub or a base but no wall made to match.
      // Say so, rather than leave one lonely card with no explanation.
      if (!wallList().length) {
        panelBox.appendChild(note('No surround is made for a ' + S.width +
          '″ × ' + S.depth + '″ opening at this height. Call us and we will ' +
          'go through what else will work.'));
      }

      var list = wallList().map(function (w) {
        return {key: w.number, line: w.lineName, name: w.description,
                size: w.size, part: w.number,
                flag: cutToFit(w) ? 'Cut to fit' : ''};
      });
      list.push({key: 'none', line: 'No surround',
                 name: 'Keep the walls you have', size: '', part: ''});

      panelBox.appendChild(group('Model', cards(list, byKey(S.wallKey),
        function (k) {
          S.wallKey = k;
          advance('wall');
          draw();
        })));

      var w = wall();
      if (w && f && w.line !== f.line) {
        panelBox.appendChild(note('This puts a ' + w.lineName + ' wall over a ' +
          f.lineName + ' ' + f.category.toLowerCase() +
          '. The sizes match, so the two go together.'));
      }
    }

    function panelPanels() {
      // More than one panel can go on a wall, so this list toggles rather
      // than picks. It does not carry you on by itself: use Next when the
      // wall has what you want on it.
      panelBox.appendChild(group(null, cards(
        extraList().map(function (e) {
          return {key: e.number, line: e.lineName, name: e.description,
                  part: e.number};
        }),
        function (it) { return S.extras.indexOf(it.key) !== -1; },
        function (k) {
          var i = S.extras.indexOf(k);
          if (i === -1) { S.extras.push(k); } else { S.extras.splice(i, 1); }
          S.panelsSet = true;
          draw();
        })));
    }

    function panelColor() {
      var f = fixture(), w = wall();
      if (f) {
        panelBox.appendChild(group(f.category + ', ' + f.description,
          swatches(baseColors(), S.baseColor, function (n) {
            S.baseColor = n; S.colorSet = true; advance('color'); draw();
          })));
      }
      if (w) {
        panelBox.appendChild(group('Wall surround, ' + w.description,
          swatches(wallColors(), S.wallColor, function (n) {
            S.wallColor = n; S.colorSet = true; advance('color'); draw();
          })));
      }
      if (f && w) {
        panelBox.appendChild(note('Each list holds the colors that piece is ' +
          'made in. The two do not have to match.'));
      }
    }

    var PANELS = {alcove: panelAlcove, piece: panelPiece, drain: panelDrain,
                  wall: panelWall, panels: panelPanels, color: panelColor};

    // ── The rail, the build, and the drawing ───────────────────────────
    function rail() {
      railBox.innerHTML = '';
      railSteps().forEach(function (s, i) {
        var open_ = s.id === at;
        var done = answered(s.id);
        var b = el('button', (open_ ? 'is-here' : '') + (done ? ' is-done' : ''));
        b.type = 'button';
        b.disabled = !can(s.id);
        if (open_) { b.setAttribute('aria-current', 'step'); }
        b.innerHTML = '<span class="rail-n">' +
                      (done ? '✓' : (i + 1)) + '</span>' + s.title;
        b.addEventListener('click', function () { at = s.id; draw(); });
        railBox.appendChild(b);
      });
    }

    function navBar() {
      var list = open();
      var i = place(list, at);
      var bar = el('div', 'seeit-nav');

      var back = el('button', 'seeit-btn', '&larr; Back');
      back.type = 'button';
      back.disabled = i <= 0;
      back.addEventListener('click', function () { hop(-1); });

      var again = el('button', 'seeit-btn', 'Start again');
      again.type = 'button';
      again.addEventListener('click', function () { blank(); draw(); });

      var next = el('button', 'seeit-btn seeit-btn-go', 'Next &rarr;');
      next.type = 'button';
      next.disabled = i < 0 || i >= list.length - 1;
      next.addEventListener('click', function () { hop(1); });

      bar.appendChild(back);
      bar.appendChild(again);
      bar.appendChild(el('span', 'spacer'));
      bar.appendChild(next);
      panelBox.appendChild(bar);
    }

    function row(term, main, sub) {
      buildBox.appendChild(el('dt', null, term));
      buildBox.appendChild(el('dd', main ? null : 'is-empty', main
        ? main + (sub ? '<span>' + sub + '</span>' : '')
        : '—'));
    }

    function build() {
      var f = fixture(), w = wall(), v = variant(), x = extrasOn();
      buildBox.innerHTML = '';

      row('Opening', (S.width === null || S.depth === null) ? '' :
        (S.shape === 'corner'
          ? S.width + '″ × ' + S.depth + '″ corner'
          : S.width + '″ × ' + S.depth + '″ alcove'), '');

      if (S.type === 'none') {
        row('Base', 'None', S.over ? 'Wall only, over ' +
            STANDS[S.over].label.toLowerCase() : 'Wall only');
      } else {
        // Until the drain is picked the part number is still the pair, so
        // show the pair. Naming one of them would be a choice nobody made.
        row(f ? f.category : 'Base', f ? (v ? v.number : f.number) : '',
            f ? f.lineName + ' · ' + f.size +
                (v && v.drain ? ' · ' + v.label + ' drain' : '') +
                (S.baseColor ? ' · ' + S.baseColor : '') : '');
      }

      row('Surround', w ? w.number : (S.wallKey === 'none' ? 'None' : ''),
          w ? w.lineName + ' · ' + w.size +
              (S.wallColor ? ' · ' + S.wallColor : '') : '');

      row('Grab bars',
          x.length ? x.map(function (e) { return e.number; }).join('  ')
                   : (S.panelsSet || S.wallKey === 'none' ? 'None' : ''),
          x.length ? x.map(function (e) { return e.description; }).join(', ') : '');
    }

    // ── The viewer ─────────────────────────────────────────────────────
    // Everything above this line is about products. Everything below hands
    // the answer to whatever is drawing it. The whole contract is update()
    // and dispose(), so a hosted configurator could take the same job over
    // without any of the logic above knowing.
    function forViewer() {
      var f = fixture(), w = wall();
      return {
        shape: S.shape || 'alcove',
        opening: {w: S.width || 60, d: S.depth || 32},
        fixture: f ? {part: f.number, box: f.box, category: f.category,
                      sits: f.sits, color: S.baseColor} : null,
        wall: w ? {part: w.number, box: w.box, color: S.wallColor} : null,
        bars: extrasOn().map(function (e) { return e.role; })
      };
    }

    // No WebGL, or the library did not load. Fall back to the still that
    // was rendered for this part.
    function flatShot() {
      var f = fixture(), w = wall(), piece = f || w;
      if (!shot) {
        viewBox.innerHTML = '';
        shot = document.createElement('img');
        shot.className = 'seeit-shot';
        shot.addEventListener('error', function () {
          shot.classList.add('is-blank');
        });
        shot.addEventListener('load', function () {
          shot.classList.remove('is-blank');
        });
        viewBox.appendChild(shot);
      }
      shot.alt = piece ? piece.lineName + ' ' + piece.description : '';
      shot.src = '../images/renders/' +
                 (piece ? piece.number.split(' / ')[0] : 'room') + '.jpg';
    }

    function scene() {
      if (mode === '3d' && viewer) { viewer.update(forViewer()); }
      else if (mode === 'flat') { flatShot(); }

      var f = fixture(), w = wall();
      var say = [];
      if (w) {
        say.push(w.lineName + ' ' + w.description.toLowerCase() +
                 (S.wallColor ? ' in ' + S.wallColor : ''));
      }
      if (f) {
        say.push(f.lineName + ' ' + f.description.toLowerCase() +
                 (S.baseColor ? ' in ' + S.baseColor : ''));
      }
      caption.textContent = say.length
        ? say.join(', over the ') + '.'
        : 'Pick the size of your opening to start.';
    }

    function draw() {
      clamp();
      // A step can close under you when an earlier answer changes. Fall
      // back to the last step that is still open.
      if (!can(at)) {
        var list = open();
        at = list.length ? list[list.length - 1].id : 'alcove';
      }
      rail();
      var s = STEPS.filter(function (x) { return x.id === at; })[0];
      panelBox.innerHTML = '';
      panelBox.appendChild(el('h2', null, s.head));
      panelBox.appendChild(el('p', 'panel-hint', s.hint));
      PANELS[at]();
      navBar();
      build();
      scene();
    }

    // Bring the room up if the browser can hold it. Nothing here can stop
    // the wizard: every path ends with a picture and a part number.
    (function start() {
      var loading = $('seeit-loading');
      function settled(next) {
        mode = next;
        if (loading && loading.parentNode) { loading.parentNode.removeChild(loading); }
        scene();
      }
      import('../js/seeit-3d.js').then(function (lib) {
        if (!lib.supported()) { throw new Error('this browser has no WebGL'); }
        viewBox.innerHTML = '';
        return lib.createViewer(viewBox, {
          modelPath: '../models/',
          models: DATA.models,
          textures: DATA.colorImages
        });
      }).then(function (v) {
        viewer = v;
        settled('3d');
      }).catch(function () {
        settled('flat');
      });
    })();

    blank();
    draw();
  })();
"""


def see_it_page() -> str:
    """Build the page that starts from the alcove and shows what fits it.

    The alcove is the limit a customer cannot change, so it comes first. A
    wall can come from any line, as long as the footprint and the height suit
    the piece under it.
    """
    fixtures, walls, extras = [], [], []

    for line in LINES:
        if line.slug in SKIP_LINES:
            continue
        for m in line.models:
            dims = whole_inches(m.size)
            base = {
                "line": line.slug,
                "lineName": line.plain,
                "number": m.number,
                "description": m.description,
            }

            # A grab bar panel carries one dimension, not a footprint. It is
            # an addition to a surround, so it rides with the wall.
            if m.category == "Grab Bar Panel":
                role, inches = panel_role(m.description)
                if role:
                    extras.append({**base, "role": role, "inches": inches})
                continue

            if len(dims) < 2:
                continue

            # w and d stay whole inches, because that is what the alcove is
            # matched on. box carries the real numbers for the renderer. The
            # third is None when the workbook gives no height, which is only
            # the ADA Select base.
            real = exact_inches(m.size)
            common = {
                **base,
                "size": m.size,
                "colors": colors_of(m),
                "w": dims[0],
                "d": dims[1],
                "box": [real[0], real[1], real[2] if len(real) > 2 else None],
                "shape": "corner" if line.slug in CORNER_LINES else "alcove",
            }
            if m.category in FIXTURE_CATEGORIES:
                fixtures.append({
                    **common,
                    "category": m.category,
                    "variants": drain_variants(m.number),
                    "sits": sits(m, dims),
                })
            elif "Surround" in m.category:
                height = dims[2] if len(dims) > 2 else 0
                walls.append({
                    **common,
                    "fits": [footprint(s)[0] for s in m.fits if footprint(s)[0]],
                    "over": "tall" if height and height < TALL_WALL_IN else "low",
                    "pairs": m.pairs,
                })

    # Which parts have a Blender export. The viewer only asks for a file
    # that is listed here, so an unexported part costs no failed request.
    # Name the .glb after the part number and it is picked up on the next
    # run, with no code change.
    have = sorted(p.stem for p in MODEL_DIR.glob("*.glb")) \
        if MODEL_DIR.exists() else []

    data = {
        "fixtures": fixtures,
        "walls": walls,
        "extras": extras,
        "models": have,
        "colorImages": COLOR_IMAGES,
    }
    blob = json.dumps(data, indent=None, separators=(",", ":"))
    script = SEEIT_JS.replace("__DATA__", blob)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>See It In Your Bathroom &mdash; Lyons Industries</title>
  <meta name="description" content="Measure your alcove, then see every Lyons
    bathtub, base, and wall surround that fits it, drawn in a bathroom.">
  <link rel="icon" href="../images/Lyons_Logo_2025.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/styles.css">
  <link rel="stylesheet" href="../css/Lines.css">
  <link rel="stylesheet" href="../css/SeeIt.css">
  <script type="importmap">
  {{"imports": {{
    "three": "../js/vendor/three.module.min.js",
    "three/addons/": "../js/vendor/addons/"
  }}}}
  </script>
</head>
<body>

{TOP_BAR}
{nav("")}
  <section class="seeit-head">
    <div class="container">
      <span class="line-eyebrow">Product Viewer</span>
      <h1>See It In Your Bathroom</h1>
      <p>Measure the opening you have to work with. The viewer then shows
        every bathtub, base, and wall surround that fits it, drawn as you
        build it up, with the part numbers to take to a dealer.</p>
    </div>
  </section>

  <section class="seeit-block">
    <div class="container seeit-grid">

      <div class="seeit-stage">
        <div class="seeit-sticky">
          <div class="seeit-view" id="seeit-view">
            <p class="seeit-loading" id="seeit-loading">Building the room&hellip;</p>
          </div>
          <p class="seeit-caption" id="scene-caption">Pick the size of your
            opening to start.</p>

          <div class="seeit-build">
            <h2>Your build</h2>
            <dl class="build-list" id="build-list"></dl>
          </div>

          <div class="seeit-foot">
            <p>The drawing is an illustration, not a photograph. A color can
              vary a little from the product. Taps, a shower head, and a drain
              are not included.</p>
            <a class="btn btn-primary" href="tel:8004589036">Call (800)
              458-9036</a>
          </div>
        </div>
      </div>

      <div class="seeit-wizard">
        <div class="seeit-rail" id="seeit-rail" role="group"
             aria-label="Steps"></div>
        <div class="seeit-panel" id="seeit-panel"></div>
      </div>

    </div>
  </section>

{retailer_cta()}{FOOTER}
  <script src="../js/script.js"></script>
  <script>
{script}
  </script>
</body>
</html>
"""


KEEP_BACKUPS = 5

# Backups live outside the repo, in a tree that mirrors it. The repo then
# holds only files the site needs, so it can be pushed without a filter and
# a backup can never reach the host. Change this one path to move them.
#
# This is the one write the script makes outside the repo. It is deliberate.
BACKUP_DIR = REPO.parent / "johnsmith5710-backups"


def backup_dir(path: Path) -> Path:
    """The folder in the backup tree that holds the backups of one file."""
    return BACKUP_DIR / path.relative_to(REPO).parent


def prune(path: Path, keep: int = KEEP_BACKUPS) -> int:
    """Drop all but the newest few backups of one file. Return how many went.

    The name carries the time it was taken, so a plain sort puts the newest
    last. Only files this script made are ever touched.
    """
    folder = backup_dir(path)
    if not folder.exists():
        return 0
    old = sorted(folder.glob(f"{path.name}.bak-*"))
    gone = old[:-keep] if keep else old
    for f in gone:
        f.unlink()
    return len(gone)


def backup(path: Path) -> Path | None:
    """Copy an existing file to its timestamped backup. Return that path."""
    if not path.exists():
        return None
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backup_dir(path) / f"{path.name}.bak-{stamp}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)
    prune(path)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="show the plan, write nothing")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jobs = [(f"{l.slug}.html", l.status, lambda l=l: render(l)) for l in LINES]
    jobs.append(("SeeIt.html", "viewer", see_it_page))

    for name, status, build in jobs:
        target = OUT_DIR / name
        if args.list:
            print(f"{status:8} {target}")
            continue
        bak = backup(target)
        target.write_text(build(), encoding="utf-8", newline="\n")
        if bak:
            print(f"CHANGED  {target}  (backup: {bak})")
        else:
            print(f"CREATED  {target}")

    if not args.list:
        model_report()


# What a visitor can reasonably be asked to download for one part, and how
# much geometry is worth sending for a moulded box. Both are soft: the file
# is still listed and still loads. The build just says so out loud.
GLB_MAX_MB = 8.0
GLB_MAX_TRIS = 250_000


def glb_stats(path: Path) -> dict:
    """Size and triangle count, read from the header alone.

    A GLB puts its JSON chunk first, and that chunk names every accessor's
    length, so the count comes out without reading the geometry. It matters
    here: one of these files is large enough that reading it to count would
    slow the build down on its own.
    """
    out = {"mb": path.stat().st_size / 1e6, "tris": 0, "ok": False}
    try:
        with path.open("rb") as fh:
            magic, _, _ = struct.unpack("<4sII", fh.read(12))
            if magic != b"glTF":
                return out
            clen, ctype = struct.unpack("<II", fh.read(8))
            if ctype != 0x4E4F534A:
                return out
            doc = json.loads(fh.read(clen).decode("utf-8"))
        acc = doc.get("accessors", [])
        for mesh in doc.get("meshes", []):
            for p in mesh.get("primitives", []):
                if "indices" in p:
                    out["tris"] += acc[p["indices"]]["count"] // 3
                elif "POSITION" in p.get("attributes", {}):
                    out["tris"] += acc[p["attributes"]["POSITION"]]["count"] // 3
        out["ok"] = True
    except (OSError, ValueError, KeyError, IndexError, struct.error):
        pass
    return out


def model_report() -> None:
    """Say how far the Blender exports have got, and flag what will hurt.

    The workbook stays the source of truth. A .glb whose name matches no
    part number is a typo or a leftover, and it would never be loaded, so
    it is worth hearing about. A .glb that is far too heavy loads fine on
    the machine that made it and not at all on a phone, which is worse.
    """
    wanted = {
        n
        for line in LINES if line.slug not in SKIP_LINES
        for m in line.models
        for n in [m.number.split(" / ")[0]]
    }
    files = sorted(MODEL_DIR.glob("*.glb")) if MODEL_DIR.exists() else []
    have = {p.stem for p in files}

    print()
    if not files:
        print(f"models   0 of {len(wanted)} parts exported. "
              f"Every shape is built from its numbers.")
        print(f"         Drop <part>.glb into {MODEL_DIR} to take one over.")
        return

    print(f"models   {len(have & wanted)} of {len(wanted)} parts exported")
    heavy = []
    for f in files:
        s = glb_stats(f)
        mark = " " if f.stem in wanted else "?"
        flag = ""
        if s["ok"] and (s["mb"] > GLB_MAX_MB or s["tris"] > GLB_MAX_TRIS):
            flag = "  <-- too heavy for the web"
            heavy.append((f, s))
        print(f"       {mark} {f.stem:<20} {s['mb']:8.1f} MB  "
              f"{s['tris']:10,d} triangles{flag}")

    stray = sorted(have - wanted)
    if stray:
        print(f"         {len(stray)} file(s) marked ? match no part number, "
              f"so they are never loaded.")

    for f, s in heavy:
        print()
        print(f"         {f.name} is {s['mb']:,.0f} MB and "
              f"{s['tris']:,} triangles.")
        print(f"         The guide is under {GLB_MAX_MB:.0f} MB and "
              f"{GLB_MAX_TRIS:,} triangles per part.")
        print(f"         In Blender: apply Decimate, or drop the Subdivision")
        print(f"         level before export. A moulded panel needs very "
              f"little geometry.")


if __name__ == "__main__":
    main()
