"""What the town knows before anyone speaks: the script read once, and who saw what.

``lore()`` builds, once per process, the things the talk between neighbours reads and never
changes: the tables, the script of the cast, the lines, the names, the people's traits and
families, and the three kinds of knowledge a game starts with.

Public knowledge is what every townsperson has: the facts of the place and of ownership
(``located``, ``owns``), and what the opening of the story shows to all (a ``broken``,
``missing`` or ``flooded`` thing). A prop is public only if the script holds it true in every
variant. The incident is the thing that broke and the place it stands in. What touches it is
what people talk about first.

Sightings are what a person saw with their own eyes before the first day, for the variant the
game drew. The script does not list them in one place, so they are read from four:

- an observation of the opening: its holder saw what it shows, and when it has no holder
  everyone did;
- an act of a person that is true in the variant: the person who did it, or who was there, saw it;
- a testimony the player can collect from a person, in a variant where it is real: that person
  saw the props it supports that are true;
- a rumour chain: the first to pass it on saw its root.

What a person guards is what they would not volunteer, whether they saw it or only heard it: what
a lie of their own contradicts, any act they may pretend not to know of, and whatever blames them.
"""

from __future__ import annotations

import functools
from typing import Any

from lantern_core.cognition.lines import Lines
from lantern_core.cognition.props import Prop, Tables, lineage
from lantern_core.cognition.relations import mutually_exclusive
from lantern_core.cognition.script import ScriptBook, Variant
from lantern_core.world.bridge.data import CAST, SCRIPT, TABLES
from lantern_core.world.bridge.sentences import SENTENCES

STATIC_PREDS = ("located", "owns")
HEADLINE_PREDS = ("broken", "missing", "flooded")
BLAME_PREDS = ("damaged", "took", "stole", "hid")
CAUSE_PREDS = ("flood_damaged",)  # a cause that no one is to blame for
PUBLIC_PREDS = (*STATIC_PREDS, *HEADLINE_PREDS)
PLAYER = "player"  # the id of the festival manager, who is named in what the town says of them
PUBLIC_CONFIDENCE = 95
FIRST_HAND_CONFIDENCE = 90
SEEN_BY_ALL_CONFIDENCE = 85


class Lore:
    """The static knowledge of the bridge town. Build it with ``lore()``."""

    def __init__(self) -> None:
        self.tables = Tables.from_canon(TABLES)
        self.book = ScriptBook.from_canon(SCRIPT)
        self.lines = Lines(SENTENCES)
        self.names = self.lines.names(self.book.registry)
        people = CAST["people"]
        self.people: tuple[str, ...] = tuple(p["id"] for p in people)
        self.lines.homes = {p["id"]: p["home"] for p in people}
        self.index: dict[str, int] = {pid: i for i, pid in enumerate(self.people)}
        # a person the script does not cast (Shitou) still has a name to be told by
        for p in people:
            self.names.setdefault(p["id"], {"zh": p["zh"], "en": p["en"]})
        # the festival manager is no one of the cast, and the town can name them in what it says
        self.names.setdefault(PLAYER, {"zh": "总管", "en": "the Festival Manager"})
        self.traits: dict[str, dict[str, int]] = {p["id"]: dict(p["traits"]) for p in people}
        self.ops: dict[str, dict[str, int]] = {p["id"]: dict(p["ops"]) for p in people}
        self.tags: dict[str, frozenset[str]] = {p["id"]: frozenset(p["tags"]) for p in people}
        self.family: dict[str, str | None] = {p["id"]: p["family"] for p in people}
        self.home: dict[str, str] = {p["id"]: p["home"] for p in people}
        self.work: dict[str, str] = {p["id"]: p["work"] for p in people}
        self.kin: dict[str, frozenset[str]] = {}
        for pid in self.people:
            family = self.family[pid]
            members = [q for q in self.people if family is not None and self.family[q] == family]
            self.kin[pid] = frozenset([pid, *members, *([family] if family else [])])
        self.public: tuple[str, ...] = self._public()
        self.incident: frozenset[str] = self._incident()
        self.authored: dict[tuple[str, str], tuple[str, ...]] = self._authored()
        twins: dict[tuple[str, tuple[tuple[str, str], ...], bool], list[str]] = {}
        for pid in self.book.props:
            prop = self.book.props[pid]
            twins.setdefault((prop.pred, prop.args, prop.neg), []).append(pid)
        self._twins = {key: tuple(ids) for key, ids in twins.items()}
        self.claim_props: dict[str, tuple[Prop, ...]] = {
            env.holder: tuple(
                self.book.props[t.prop]
                for t in env.templates
                if t.kind == "claim" and t.prop in self.book.props
            )
            for env in self.book.lies
        }
        self.ignorance: dict[str, frozenset[str]] = {
            env.holder: frozenset(env.ignorance) for env in self.book.lies
        }
        self.variants: dict[str, Variant] = {v.id: v for v in self.book.variants}
        # the openings of the script by id (see ``opening``), and for each the roots of the stories
        # its hops are about: the props at the end of the lineage of a prop a hop tells
        self.openings: dict[str, dict[str, Any]] = {o["id"]: o for o in SCRIPT["openings"]}
        self.story_roots: dict[str, frozenset[str]] = {
            oid: frozenset(lineage(hop["prop"], self.book.props)[-1] for hop in o["hops"])
            for oid, o in self.openings.items()
        }
        self.sightings: dict[str, tuple[tuple[str, str, int], ...]] = {
            v.id: self._sightings(v) for v in self.book.variants
        }

    # -- what is public ----------------------------------------------------------------------

    def _public(self) -> tuple[str, ...]:
        out = []
        for pid in SCRIPT["shared"]:
            prop = self.book.props[pid]
            if not prop.neg and prop.pred in PUBLIC_PREDS:
                out.append(pid)
        return tuple(sorted(out))

    def _incident(self) -> frozenset[str]:
        """The things that broke or went missing, and the places they stand in."""
        props = [self.book.props[pid] for pid in self.public]
        things = [p.arg("what") for p in props if p.pred in ("broken", "missing")]
        places = [p.arg("where") for p in props if p.pred == "located" and p.arg("what") in things]
        return frozenset(x for x in (*things, *places) if x)

    def is_headline(self, prop_id: str) -> bool:
        """Whether a public prop is what the opening shows, which people read rather than see."""
        return self.book.props[prop_id].pred in HEADLINE_PREDS

    def _authored(self) -> dict[tuple[str, str], tuple[str, ...]]:
        found: dict[tuple[str, str], list[str]] = {}
        for pid in self.book.props:
            prop = self.book.props[pid]
            if prop.parent is not None and prop.op is not None:
                found.setdefault((prop.parent, prop.op), []).append(pid)
        return {key: tuple(ids) for key, ids in found.items()}

    # -- what was seen -----------------------------------------------------------------------

    def _sightings(self, variant: Variant) -> tuple[tuple[str, str, int], ...]:
        book = self.book
        true = set(variant.true_props)
        seen: dict[tuple[str, str], int] = {}

        def see(holder: str, prop_id: str, confidence: int) -> None:
            if holder in self.index and prop_id in book.props:
                key = (holder, prop_id)
                seen[key] = max(seen.get(key, 0), confidence)

        for ob in SCRIPT["observations"]:
            if ob["in"] != "all" and variant.id not in ob["in"]:
                continue
            for prop_id in ob["shows"]:
                if ob["holder"] is None:
                    for holder in self.people:
                        see(holder, prop_id, SEEN_BY_ALL_CONFIDENCE)
                else:
                    see(ob["holder"], prop_id, FIRST_HAND_CONFIDENCE)
        for prop_id in sorted(true):
            prop = book.props[prop_id]
            who = prop.arg("who")
            if who is not None and not prop.neg and prop.pred not in STATIC_PREDS:
                see(who, prop_id, FIRST_HAND_CONFIDENCE)
        for ev in SCRIPT["evidence"]:
            if variant.id in ev["real_in"]:
                for prop_id in ev["supports"]:
                    if prop_id in true:
                        see(ev["acquire"]["from"], prop_id, FIRST_HAND_CONFIDENCE)
        for chain in SCRIPT["chains"]:
            root, first = chain["hops"][0]["prop"], chain["hops"][1]["speaker"]
            if root in true and first is not None:
                see(first, root, FIRST_HAND_CONFIDENCE)
        return tuple(
            (holder, prop_id, seen[(holder, prop_id)])
            for holder, prop_id in sorted(seen, key=lambda k: (self.index[k[0]], k[1]))
        )

    # -- what excludes what, what is guarded, and the colour of a telling ----------------------

    def excludes(self, one: Prop, other: Prop) -> bool:
        """Whether the two cannot both be true.

        The script says which of its own props exclude each other (its groups). A prop made on
        the way says the same as the script's props that have its predicate and arguments, perhaps
        less about when or why, so it excludes what they exclude, and never what they themselves
        say. The core's other rules (a denial and its statement, one person in two places) apply
        to all.
        """
        key, other_key = (one.pred, one.args, one.neg), (other.pred, other.args, other.neg)
        if one.id == other.id or key == other_key:
            return False
        if mutually_exclusive(one, other, self.book.groups, self.tables):
            return True
        groups = self.book.groups
        return any(
            groups.together(a, b)
            for a in self._twins.get(key, ())
            for b in self._twins.get(other_key, ())
        )

    def guards(self, holder: str, prop: Prop) -> bool:
        """Whether ``holder`` would keep a belief in ``prop`` to themselves, however they got it."""
        if not prop.neg and prop.pred in BLAME_PREDS and prop.arg("who") == holder:
            return True
        if prop.pred in self.ignorance.get(holder, ()):
            return True
        return any(self.excludes(prop, said) for said in self.claim_props.get(holder, ()))

    def topic(self, prop: Prop) -> str:
        """The colour of a rumour on the move: blame, clear or other.

        It is made from what saying the prop does and from nothing else, so it is the same
        whichever story is true. Blame is the claim that someone broke or took something. Clear is
        a denial, or a cause that is nobody's doing (the flood). Anything else is other.
        """
        if prop.neg:
            return "clear"
        if prop.pred in BLAME_PREDS:
            return "blame"
        if prop.pred in CAUSE_PREDS:
            return "clear"
        return "other"


@functools.cache
def lore() -> Lore:
    """The static knowledge of the bridge town, built once per process and shared by every game."""
    return Lore()
