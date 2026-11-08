"""What is said and what is held: claims, beliefs, and the store of one holder.

A **claim** is one thing said by one speaker to some listeners: the prop, how it is said
(``assert``, ``speculate``, ``deny`` or ``lie``), the source the speaker names for it, and which
of the four ways of saying it (``path``, see ``paths.py``) the speaker used. The pair of the
speaker and a listener is the real edge along which the prop travelled, whatever source the
speaker named. The claimed source is a person id, ``"self_seen"`` or ``"unknown"``.

A **belief** is what a holder keeps from seeing, hearing or working something out: the prop, its
modality (``assert`` or ``speculate``), a confidence from 0 to 100, the kind of source, who told
it directly and whom that person named, how many hands it has passed through (``hop``, 0 for
what the holder knows first-hand) and the claim it came from. A ``deny`` or a ``lie`` is stored
by the hearer as an assertion, because the hearer cannot tell a lie from the truth.

A **store** holds the beliefs of one person, one per prop, and a note of every lie that person
has told. Iteration is in prop id order so that a store replays and hashes the same everywhere.

A person who takes in an account that excludes one they hold keeps the firmer of the two as their
belief and remembers the other as a **rival**: the account, the belief it was set against, who told
it and when. The memory is short (``RIVALS_MAX``, the oldest going first) and it costs the belief it
was set against a little firmness (``RIVAL_DENT`` for each, ``RIVAL_DENT_CAP`` at most), so that a
person who is torn gives way to proof more easily than one who is not. Firmness is the confidence
less that cost, and it is worked out when it is read: nothing about it is kept but the rivals.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from lantern_core.cognition._fields import (
    ShapeError,
    as_choice,
    as_dict,
    as_int,
    as_list,
    as_opt_str,
    as_str,
    as_str_tuple,
)

MODALITIES = ("assert", "speculate")
CLAIM_MODALITIES = ("assert", "speculate", "deny", "lie")
SOURCES = ("saw", "heard", "inferred", "paper", "street")
PATHS = ("belief", "speculation", "mutation", "lie")
SELF_SEEN = "self_seen"
UNKNOWN = "unknown"
RIVALS_MAX = 4  # the rival accounts one person keeps in mind, the oldest going first
RIVAL_DENT = 4  # the firmness a belief loses for each rival account held against it
RIVAL_DENT_CAP = 12  # and the most it can lose, however many there are


_CLAIM_KEYS = (
    "id",
    "speaker",
    "listeners",
    "prop",
    "modality",
    "claimed_source",
    "tick",
    "path",
    "rule_id",
    "premises",
    "op",
    "template_id",
)
_BELIEF_KEYS = (
    "holder",
    "prop",
    "modality",
    "confidence",
    "source",
    "teller",
    "claimed_source",
    "hop",
    "tick",
    "claim",
)


class BeliefError(ValueError):
    """A belief put where it does not belong."""


@dataclass(frozen=True, slots=True)
class Claim:
    """One thing said by ``speaker`` to ``listeners`` at ``tick``.

    ``rule_id`` and ``premises`` go with the ``speculation`` path, ``op`` with ``mutation`` and
    ``template_id`` with ``lie``. Whether the speaker was allowed to say it is not decided here
    but by ``paths.authorize``.
    """

    id: str
    speaker: str
    listeners: tuple[str, ...]
    prop: str
    modality: str
    claimed_source: str
    tick: int
    path: str
    rule_id: str | None = None
    premises: tuple[str, ...] = ()
    op: str | None = None
    template_id: str | None = None

    def __post_init__(self) -> None:
        as_str(self.id, "claim.id")
        as_str(self.speaker, f"{self.id}.speaker")
        if not isinstance(self.listeners, tuple) or not self.listeners:
            raise ShapeError(f"{self.id}.listeners: expected a non-empty tuple")
        for who in self.listeners:
            as_str(who, f"{self.id}.listeners")
        if len(set(self.listeners)) != len(self.listeners) or self.speaker in self.listeners:
            raise ShapeError(f"{self.id}.listeners: must be distinct and not the speaker")
        as_str(self.prop, f"{self.id}.prop")
        as_choice(self.modality, CLAIM_MODALITIES, f"{self.id}.modality")
        as_str(self.claimed_source, f"{self.id}.claimed_source")
        as_int(self.tick, f"{self.id}.tick")
        as_choice(self.path, PATHS, f"{self.id}.path")
        as_opt_str(self.rule_id, f"{self.id}.rule_id")
        if not isinstance(self.premises, tuple):
            raise ShapeError(f"{self.id}.premises: expected a tuple")
        for premise in self.premises:
            as_str(premise, f"{self.id}.premises")
        as_opt_str(self.op, f"{self.id}.op")
        as_opt_str(self.template_id, f"{self.id}.template_id")

    @property
    def edges(self) -> tuple[tuple[str, str], ...]:
        """The real teller-to-hearer edges this claim travelled along."""
        return tuple((self.speaker, listener) for listener in self.listeners)

    def to_canon(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "speaker": self.speaker,
            "listeners": list(self.listeners),
            "prop": self.prop,
            "modality": self.modality,
            "claimed_source": self.claimed_source,
            "tick": self.tick,
            "path": self.path,
            "rule_id": self.rule_id,
            "premises": list(self.premises),
            "op": self.op,
            "template_id": self.template_id,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "claim") -> Claim:
        d = as_dict(value, where, _CLAIM_KEYS)
        return cls(
            as_str(d["id"], f"{where}.id"),
            as_str(d["speaker"], f"{where}.speaker"),
            as_str_tuple(d["listeners"], f"{where}.listeners"),
            as_str(d["prop"], f"{where}.prop"),
            as_choice(d["modality"], CLAIM_MODALITIES, f"{where}.modality"),
            as_str(d["claimed_source"], f"{where}.claimed_source"),
            as_int(d["tick"], f"{where}.tick"),
            as_choice(d["path"], PATHS, f"{where}.path"),
            as_opt_str(d["rule_id"], f"{where}.rule_id"),
            as_str_tuple(d["premises"], f"{where}.premises"),
            as_opt_str(d["op"], f"{where}.op"),
            as_opt_str(d["template_id"], f"{where}.template_id"),
        )


@dataclass(frozen=True, slots=True)
class Belief:
    """What ``holder`` holds about ``prop``, and where it came from."""

    holder: str
    prop: str
    modality: str
    confidence: int
    source: str
    teller: str | None
    claimed_source: str | None
    hop: int
    tick: int
    claim: str | None = None

    def __post_init__(self) -> None:
        as_str(self.holder, "belief.holder")
        as_str(self.prop, f"{self.holder}.prop")
        where = f"belief {self.holder}/{self.prop}"
        as_choice(self.modality, MODALITIES, f"{where}.modality")
        as_int(self.confidence, f"{where}.confidence", 0, 100)
        as_choice(self.source, SOURCES, f"{where}.source")
        as_opt_str(self.teller, f"{where}.teller")
        as_opt_str(self.claimed_source, f"{where}.claimed_source")
        as_int(self.hop, f"{where}.hop", 0)
        as_int(self.tick, f"{where}.tick")
        as_opt_str(self.claim, f"{where}.claim")
        if self.source == "heard":
            if self.teller is None or self.claimed_source is None or self.hop < 1:
                raise ShapeError(
                    f"{where}: a heard belief needs a teller, a claimed source, hop >= 1"
                )
        else:
            if self.teller is not None or self.claimed_source is not None:
                raise ShapeError(f"{where}: only a heard belief has a teller and a claimed source")
            if self.source == "saw" and (self.hop != 0 or self.claim is not None):
                raise ShapeError(f"{where}: what was seen is first-hand and has no claim")
            if self.source in ("paper", "street") and self.claim is not None:
                raise ShapeError(f"{where}: a {self.source} belief has no claim")

    def honest_source(self) -> str:
        """The source named when passing this belief on without hiding or inventing one.

        What the holder saw is ``"self_seen"``. What was heard is the person who told it. A
        conclusion of the holder's own is named as the holder's. A newspaper or street talk has
        no one to name, so it is ``"unknown"``.
        """
        if self.source == "saw":
            return SELF_SEEN
        if self.source == "heard":
            assert self.teller is not None
            return self.teller
        if self.source == "inferred":
            return self.holder
        return UNKNOWN

    def to_canon(self) -> dict[str, Any]:
        return {
            "holder": self.holder,
            "prop": self.prop,
            "modality": self.modality,
            "confidence": self.confidence,
            "source": self.source,
            "teller": self.teller,
            "claimed_source": self.claimed_source,
            "hop": self.hop,
            "tick": self.tick,
            "claim": self.claim,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "belief") -> Belief:
        d = as_dict(value, where, _BELIEF_KEYS)
        return cls(
            as_str(d["holder"], f"{where}.holder"),
            as_str(d["prop"], f"{where}.prop"),
            as_choice(d["modality"], MODALITIES, f"{where}.modality"),
            as_int(d["confidence"], f"{where}.confidence", 0, 100),
            as_choice(d["source"], SOURCES, f"{where}.source"),
            as_opt_str(d["teller"], f"{where}.teller"),
            as_opt_str(d["claimed_source"], f"{where}.claimed_source"),
            as_int(d["hop"], f"{where}.hop", 0),
            as_int(d["tick"], f"{where}.tick"),
            as_opt_str(d["claim"], f"{where}.claim"),
        )


@dataclass(frozen=True, slots=True)
class LieNote:
    """A liar's own record that they told ``listener`` this lie, so that they remember it."""

    prop: str
    listener: str
    claim: str
    tick: int

    def to_canon(self) -> dict[str, Any]:
        return {
            "prop": self.prop,
            "listener": self.listener,
            "claim": self.claim,
            "tick": self.tick,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "lie") -> LieNote:
        d = as_dict(value, where, ("prop", "listener", "claim", "tick"))
        return cls(
            as_str(d["prop"], f"{where}.prop"),
            as_str(d["listener"], f"{where}.listener"),
            as_str(d["claim"], f"{where}.claim"),
            as_int(d["tick"], f"{where}.tick"),
        )


@dataclass(frozen=True, slots=True)
class Rival:
    """An account the holder did not take in, kept in mind against the one they hold.

    ``prop`` is the rival account, ``against`` the belief it was set against (the one the holder
    kept), ``teller`` the person who told it to the holder and ``tick`` when, and ``claim`` the
    claim it came with, if the town has it on record.
    """

    prop: str
    against: str
    teller: str
    tick: int
    claim: str | None = None

    def __post_init__(self) -> None:
        as_str(self.prop, "rival.prop")
        where = f"rival {self.prop}"
        as_str(self.against, f"{where}.against")
        as_str(self.teller, f"{where}.teller")
        as_int(self.tick, f"{where}.tick")
        as_opt_str(self.claim, f"{where}.claim")
        if self.prop == self.against:
            raise ShapeError(f"{where}: an account is not its own rival")

    def to_canon(self) -> dict[str, Any]:
        return {
            "prop": self.prop,
            "against": self.against,
            "teller": self.teller,
            "tick": self.tick,
            "claim": self.claim,
        }

    @classmethod
    def from_canon(cls, value: Any, where: str = "rival") -> Rival:
        d = as_dict(value, where, _RIVAL_KEYS)
        return cls(
            as_str(d["prop"], f"{where}.prop"),
            as_str(d["against"], f"{where}.against"),
            as_str(d["teller"], f"{where}.teller"),
            as_int(d["tick"], f"{where}.tick"),
            as_opt_str(d["claim"], f"{where}.claim"),
        )


_RIVAL_KEYS = ("prop", "against", "teller", "tick", "claim")


class BeliefStore:
    """The beliefs of one holder, one per prop, the lies that holder has told, and the rival
    accounts they keep in mind (oldest first)."""

    __slots__ = ("_beliefs", "_lies", "_rivals", "holder")

    def __init__(
        self,
        holder: str,
        beliefs: tuple[Belief, ...] | list[Belief] = (),
        lies: tuple[LieNote, ...] | list[LieNote] = (),
        rivals: tuple[Rival, ...] | list[Rival] = (),
    ) -> None:
        self.holder = as_str(holder, "store.holder")
        self._beliefs: dict[str, Belief] = {}
        self._lies: list[LieNote] = list(lies)
        self._rivals: list[Rival] = []
        for belief in beliefs:
            self.put(belief)
        for rival in rivals:
            self.note_rival(rival)

    def put(self, belief: Belief) -> None:
        """Hold ``belief``, replacing what the holder held about that prop."""
        if belief.holder != self.holder:
            raise BeliefError(f"{belief.holder}'s belief put in {self.holder}'s store")
        self._beliefs[belief.prop] = belief

    def get(self, prop_id: str) -> Belief | None:
        return self._beliefs.get(prop_id)

    def note_lie(self, note: LieNote) -> None:
        self._lies.append(note)

    @property
    def lies(self) -> tuple[LieNote, ...]:
        return tuple(self._lies)

    def __contains__(self, prop_id: object) -> bool:
        return prop_id in self._beliefs

    def __len__(self) -> int:
        return len(self._beliefs)

    def __iter__(self) -> Iterator[Belief]:
        return (self._beliefs[pid] for pid in sorted(self._beliefs))

    def heard_from(self, teller: str) -> list[Belief]:
        """The beliefs this holder got directly from ``teller``, in prop id order."""
        return [b for b in self if b.teller == teller]

    # -- rival accounts ------------------------------------------------------------------------

    @property
    def rivals(self) -> tuple[Rival, ...]:
        """The accounts the holder keeps in mind against what they hold, oldest first."""
        return tuple(self._rivals)

    def note_rival(self, rival: Rival) -> None:
        """Remember ``rival``. The same account is remembered once, as the newest, and when there
        are more than ``RIVALS_MAX`` the oldest are forgotten."""
        self._rivals = [r for r in self._rivals if r.prop != rival.prop]
        self._rivals.append(rival)
        del self._rivals[:-RIVALS_MAX]

    def forget_rivals(self, *, prop: str | None = None, against: str | None = None) -> None:
        """Forget the rivals that are the account ``prop``, or were set against the belief
        ``against``."""
        self._rivals = [
            r
            for r in self._rivals
            if (prop is None or r.prop != prop) and (against is None or r.against != against)
        ]

    def rivals_against(self, prop_id: str) -> tuple[Rival, ...]:
        """The rival accounts held against the belief in ``prop_id``, oldest first."""
        return tuple(r for r in self._rivals if r.against == prop_id)

    def firmness(self, prop_id: str) -> int:
        """How firmly the holder holds ``prop_id``, from 0 to 100: its confidence less
        ``RIVAL_DENT`` for each rival account held against it, ``RIVAL_DENT_CAP`` at most. Nothing
        held is not held at all."""
        held = self._beliefs.get(prop_id)
        if held is None:
            return 0
        dent = min(RIVAL_DENT_CAP, RIVAL_DENT * len(self.rivals_against(prop_id)))
        return max(0, held.confidence - dent)

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, BeliefStore)
            and self.holder == other.holder
            and self._beliefs == other._beliefs
            and self._lies == other._lies
            and self._rivals == other._rivals
        )

    def to_canon(self) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "holder": self.holder,
            "beliefs": [b.to_canon() for b in self],
            "lies": [n.to_canon() for n in self._lies],
        }
        if self._rivals:  # a store with none has no "rivals" key
            doc["rivals"] = [r.to_canon() for r in self._rivals]
        return doc

    @classmethod
    def from_canon(cls, value: Any) -> BeliefStore:
        d = as_dict(value, "store", ("holder", "beliefs", "lies"), ("rivals",))
        return cls(
            as_str(d["holder"], "store.holder"),
            [
                Belief.from_canon(b, f"store.beliefs[{i}]")
                for i, b in enumerate(as_list(d["beliefs"], "store.beliefs"))
            ],
            [
                LieNote.from_canon(n, f"store.lies[{i}]")
                for i, n in enumerate(as_list(d["lies"], "store.lies"))
            ],
            [
                Rival.from_canon(r, f"store.rivals[{i}]")
                for i, r in enumerate(as_list(d.get("rivals", []), "store.rivals"))
            ],
        )
