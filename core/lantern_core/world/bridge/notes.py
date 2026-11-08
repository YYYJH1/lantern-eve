"""The notes the social section keeps: what each person believes, what was said, what was made up.

A belief, a claim and a prop made on the way are each one short string in the state, so that the
state stays small (the state hash walks all of it, and a snapshot carries all of it) and still
reads back into the types of ``lantern_core.cognition`` without loss. A note is its fields
joined with ``|``, and none of the fields can hold that character: ids are lower-case words with
underscores. An absent field is the empty string.

    belief  "modality|confidence|source|teller|claimed source|hop|tick|claim id"
    claim   "speaker|listener|prop|modality|claimed source|tick|path|rule|premises|op|template"
    prop    "predicate|slot:entity,slot:entity|start,end|neg|motive|parent|op"
    rival   "prop|against|teller|tick|claim id"

The holder and the prop of a belief are the keys it is kept under, a claim has one listener, the
premises of a claim are joined with commas, ``neg`` is 0 or 1 and the span is empty when the prop
has none. The rivals of a holder are a list of notes in the order they were kept (see
``keep_rival``), under the holder in the section's ``rivals``, which a game has only once someone
holds one. Decoding is cached on the text, which is safe because the types are immutable and the
text decides them.

``PropView`` is the book that ``paths.authorize`` is given: the props of the script and the props
made on the way, as one read-only mapping in id order.
"""

from __future__ import annotations

import functools
from collections.abc import Iterator, Mapping
from typing import Any

from lantern_core.cognition.beliefs import RIVALS_MAX, Belief, BeliefStore, Claim, Rival
from lantern_core.cognition.props import Prop

SEP = "|"


# ----------------------------------------------------------------------------- beliefs


def encode_belief(belief: Belief) -> str:
    return SEP.join(
        (
            belief.modality,
            str(belief.confidence),
            belief.source,
            belief.teller or "",
            belief.claimed_source or "",
            str(belief.hop),
            str(belief.tick),
            belief.claim or "",
        )
    )


@functools.lru_cache(maxsize=16384)
def decode_belief(holder: str, prop: str, note: str) -> Belief:
    modality, confidence, source, teller, claimed, hop, tick, claim = note.split(SEP)
    return Belief(
        holder,
        prop,
        modality,
        int(confidence),
        source,
        teller or None,
        claimed or None,
        int(hop),
        int(tick),
        claim or None,
    )


def with_confidence(note: str, confidence: int) -> str:
    """The note of a belief held with another confidence, the rest as it was."""
    modality, _, rest = note.split(SEP, 2)
    return SEP.join((modality, str(confidence), rest))


def confidence_of(note: str) -> int:
    return int(note.split(SEP, 2)[1])


# ----------------------------------------------------------------------------- claims


def encode_claim(claim: Claim) -> str:
    (listener,) = claim.listeners
    return SEP.join(
        (
            claim.speaker,
            listener,
            claim.prop,
            claim.modality,
            claim.claimed_source,
            str(claim.tick),
            claim.path,
            claim.rule_id or "",
            ",".join(claim.premises),
            claim.op or "",
            claim.template_id or "",
        )
    )


@functools.lru_cache(maxsize=16384)
def decode_claim(claim_id: str, note: str) -> Claim:
    speaker, listener, prop, modality, claimed, tick, path, rule, premises, op, template = (
        note.split(SEP)
    )
    return Claim(
        claim_id,
        speaker,
        (listener,),
        prop,
        modality,
        claimed,
        int(tick),
        path,
        rule or None,
        tuple(premises.split(",")) if premises else (),
        op or None,
        template or None,
    )


# ----------------------------------------------------------------------------- rivals


def encode_rival(rival: Rival) -> str:
    return SEP.join((rival.prop, rival.against, rival.teller, str(rival.tick), rival.claim or ""))


@functools.lru_cache(maxsize=4096)
def decode_rival(note: str) -> Rival:
    prop, against, teller, tick, claim = note.split(SEP)
    return Rival(prop, against, teller, int(tick), claim or None)


def rivals_of(social: Mapping[str, Any], holder: str) -> list[Rival]:
    """The rival accounts ``holder`` keeps in mind, oldest first. A game that never had one has no
    section ``rivals`` at all."""
    return [decode_rival(note) for note in social.get("rivals", {}).get(holder, ())]


def keep_rival(social: dict[str, Any], holder: str, rival: Rival) -> None:
    """Write ``rival`` into the memory of ``holder``: the same account is kept once, as the newest,
    and the oldest are forgotten past ``RIVALS_MAX``."""
    mine = social.setdefault("rivals", {}).setdefault(holder, [])
    mine[:] = [note for note in mine if decode_rival(note).prop != rival.prop]
    mine.append(encode_rival(rival))
    del mine[:-RIVALS_MAX]


def forget_rivals(
    social: dict[str, Any], holder: str, *, prop: str | None = None, against: str | None = None
) -> None:
    """Forget the rivals of ``holder`` that are the account ``prop``, or were set against the belief
    ``against``. A holder left with none has no entry."""
    mine = social.get("rivals", {}).get(holder)
    if not mine:
        return
    mine[:] = [
        note
        for note in mine
        if (prop is None or decode_rival(note).prop != prop)
        and (against is None or decode_rival(note).against != against)
    ]
    if not mine:
        del social["rivals"][holder]
        if not social["rivals"]:
            del social["rivals"]


# ----------------------------------------------------------------------------- props


def encode_prop(prop: Prop) -> str:
    span = "" if prop.span is None else f"{prop.span[0]},{prop.span[1]}"
    return SEP.join(
        (
            prop.pred,
            ",".join(f"{slot}:{entity}" for slot, entity in prop.args),
            span,
            "1" if prop.neg else "0",
            prop.motive or "",
            prop.parent or "",
            prop.op or "",
        )
    )


@functools.lru_cache(maxsize=4096)
def decode_prop(prop_id: str, note: str) -> Prop:
    pred, args, span, neg, motive, parent, op = note.split(SEP)
    start, _, end = span.partition(",")
    return Prop.of(
        prop_id,
        pred,
        dict(pair.split(":") for pair in args.split(",")),
        (int(start), int(end)) if span else None,
        neg == "1",
        motive or None,
        parent or None,
        op or None,
    )


class PropView(Mapping[str, Prop]):
    """Several books of props read as one, the first that has an id answering for it."""

    __slots__ = ("_layers",)

    def __init__(self, *layers: Mapping[str, Prop]) -> None:
        self._layers = layers

    def __getitem__(self, prop_id: str) -> Prop:
        for layer in self._layers:
            if prop_id in layer:
                return layer[prop_id]
        raise KeyError(prop_id)

    def __iter__(self) -> Iterator[str]:
        seen: set[str] = set()
        for layer in self._layers:
            seen.update(layer)
        return iter(sorted(seen))

    def __len__(self) -> int:
        return sum(1 for _ in self)

    def __contains__(self, prop_id: object) -> bool:
        return any(prop_id in layer for layer in self._layers)


# ----------------------------------------------------------------------------- the section


def made_props(social: Mapping[str, Any]) -> dict[str, Prop]:
    """The props made on the way, by id."""
    notes = social["props"]
    return {pid: decode_prop(pid, notes[pid]) for pid in sorted(notes)}


def claims(social: Mapping[str, Any]) -> dict[str, Claim]:
    """Every claim made so far, by id, in the order they were made."""
    notes = social["claims"]
    order = sorted(notes, key=lambda cid: int(cid[1:]))
    return {cid: decode_claim(cid, notes[cid]) for cid in order}


def store(social: Mapping[str, Any], holder: str) -> BeliefStore:
    """What ``holder`` believes, as the store that ``paths`` and ``provenance`` read."""
    notes = social["beliefs"][holder]
    return BeliefStore(
        holder,
        [decode_belief(holder, pid, notes[pid]) for pid in sorted(notes)],
        rivals=rivals_of(social, holder),
    )


def stores(social: Mapping[str, Any]) -> dict[str, BeliefStore]:
    return {holder: store(social, holder) for holder in sorted(social["beliefs"])}


def hold(social: dict[str, Any], belief: Belief) -> None:
    """Write ``belief`` into its holder's notes, replacing what they held about that prop."""
    social["beliefs"][belief.holder][belief.prop] = encode_belief(belief)
