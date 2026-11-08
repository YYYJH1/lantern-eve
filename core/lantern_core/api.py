"""The single entry point that both hosts drive.

A host keeps one ``Game``. Once per tick it hands over the inputs it has received, as a JSON
list, and gets the outputs of that tick back as JSON. JSON on both sides keeps the boundary to
JavaScript narrow and canonical, and nothing in this package reads a clock, a file or the
network.

Inputs
    ``{"seq": int, "kind": str, "body": {...}}``. The host numbers inputs in the order it
    receives them, starting at 0 and never reusing a number, and the core refuses a list whose
    numbers do not increase. A call applies its inputs in order at the current tick ``t``, and
    then simulates tick ``t`` unless the world is paused or held at that point. A call on a
    stopped world leaves the tick at ``t``, so the next call carries more inputs for the same
    tick. A replay groups the recorded inputs by tick and gets the same world with one call per
    tick.

    The whole list is checked before any of it is applied. A list the core refuses raises
    ``InputError`` (a ``ValueError``) and leaves the game as it was: a number that does not
    increase, a kind that is not listed below, a body of the wrong shape, text that is not
    canonical JSON. Keys the host adds beyond the ones named here are ignored.

    Order within a call: the inputs are applied one by one, so a ``model_result`` lands before
    the tick it arrives with is simulated. Then the world simulates (schedules, walking, chats
    that have ended, meetings, new requests) unless it is paused. Then every request still in
    flight is checked against its conditions and the ones that no longer hold are listed in
    ``"cancels"``. Last, the tick counter moves on and the outputs are assembled.

    Kinds:

    - ``"pause"`` and ``"resume"``, with an empty body.
    - ``"player"``: a player action, with ``"action_id"`` and the action's own fields. An
      action id that was seen before is ignored, so a resend after a reconnect acts once. The
      actions of the m0 scenario are ``{"type": "summon", "npc": "npc03", "x": 31, "y": 10}``:
      the NPC walks to that cell and stays for ``summon_hold`` ticks. A well-formed action that
      cannot be carried out (the cell is blocked or unreachable) is not an error. It draws a
      ``"rejected"`` acknowledgement. The player of the bridge scenario is the festival
      manager. They act with ``{"type": "move", "place": id}`` (or ``"x"`` and ``"y"``),
      ``{"type": "talk", "npc": id}``, ``{"type": "leave"}``, ``{"type": "ask", "topic": id}``,
      ``{"type": "ask_source", "entry": id}``, ``{"type": "listen"}`` and ``{"type": "look",
      "at": id}``, each answered by an ``"action_ack"`` that says ``"applied"`` or ``"rejected"``
      and why (``lantern_core.world.bridge.player`` has the bodies and the reasons). The manager
      also calls for helpers for the bridge with ``{"type": "rally"}`` (once; the town answers
      by its thresholds, see ``lantern_core.world.bridge.goals``), and deals with people:
      ``{"type": "tell", "entry": id, "how": "faithful" | "as_seen" | "sharpen" | "hide_source"}``
      (or ``"how": "fabricate"`` with ``"pred"``, ``"subject"`` and ``"object"``) tells someone
      something, ``{"type": "entrust", "kind": kind, "target"?: id, "cite"?: [ids]}`` asks them to
      do something (the kinds are ``material``, ``lane``, ``testify``, ``lend``, ``join``,
      ``persuade`` and ``convene``), ``{"type": "promise", "what": ..., ...}`` promises what the
      manager holds and ``{"type": "promise", "op": "keep", "id": id}`` keeps a promise, all in a
      conversation, and ``{"type": "speak", "kind"?: "evidence" | "meal" | "clarify" | "statement",
      "evidence"?: [ids]}`` (also named ``speak_publicly``) speaks to the town, outside one, at
      the teahouse in the evening or at the hall when the clan is called: with the kind
      ``"clarify"`` and ``"claim"``, ``"basis"`` (entries of the notebook) and ``"judgment"?`` it
      says that a claim goes beyond what a witness saw (see ``lantern_core.world.bridge.clarify``),
      and with the kind ``"statement"`` it makes the full statement of the card that
      ``{"type": "statement", "op": "choose" | "clear", "part", "option"?}`` fills in, which takes
      no time (see ``lantern_core.world.bridge.statement``). A speech takes half an hour when it is
      made and not when it is turned down.
      Each answers with an ``"action_ack"``, and
      what came of it is in the events (``lantern_core.world.bridge.player`` lists them). The
      manager also picks the task to follow with ``{"type": "track", "task": id}``, which costs no
      time (see ``lantern_core.world.bridge.agenda``). It says how two notes of the notebook
      stand with ``{"type": "judge", "a": id, "b": id, "relation": ...}`` and has a pair worth
      comparing lit with ``{"type": "hint"}``, both at no cost in time (see
      ``lantern_core.world.bridge.judge``). ``ask``, ``ask_source``, ``tell``, ``entrust`` and
      ``promise`` may carry the ``"version"`` of the state they were previewed on (see
      ``Game.preview_json``): the core rejects an action whose version is not the state's as
      ``"stale"`` and does nothing. There are also test actions,
      which exist only when the config has ``dev_actions`` set to 1: ``{"type": "assign", "npc":
      id, "task": {...}}``, which posts an errand, and ``{"type": "dev_goal", "op": op, ...}``,
      which stands in for the persuasion that comes later (the ops are ``join``, ``material``,
      ``lane``, ``truth``, ``reconcile`` and ``grudge``, see ``goals``).
    - ``"model_result"``: ``{"request_id", "status", "text", "usage", "latency_ms"}``, where
      ``status`` is one of ``"ok"``, ``"timeout"``, ``"cancelled"`` and ``"error"``, and
      ``usage`` is ``{"input_tokens": int, "output_tokens": int}`` or ``null`` when the host
      cannot know it (after a timeout, say). ``text``, ``usage`` and ``latency_ms`` may be left
      out. A host sends exactly one result per request, except that it may still report a late
      answer after a ``"timeout"``. The core voids such a result and still books its tokens. A
      host with no model can answer every request with ``"error"``, which gives the scenario's
      template line.
    - ``"host"``: ``{"event": ...}``, something about the host that the core cannot see for
      itself. The events are ``"cloud_down"`` and ``"cloud_up"`` (whether the model service
      can be reached) and ``"local_up"`` and ``"local_down"`` (whether a local model can take
      requests). A game starts with the cloud up and no local model. The bridge scenario keeps
      its budget by them (see ``lantern_core.world.bridge.budget``): while the cloud is down it
      sends requests to the local model, if there is one, and otherwise answers them with
      template lines. A host that limits what a key may spend in a day sends ``"cloud_down"``
      when the day's money is gone. The events are inputs like any other, so a replay makes the
      same choices at the same ticks and never probes anything. The m0 scenario ignores them.

Model replies
    In a talk with the festival manager, the rules of the town answer every action first (an
    answer, a refusal, an agreement), and the answer is acknowledged and shown at once. Then a
    request goes out under the category ``"reply"``, on the tier the talk was opened with (the
    rule of ``lantern_core.world.bridge.tiers``), good only while that talk is open, to word the
    same answer in the person's own voice; the frame says the person is thinking (``"thinking"``
    in ``"player"``) until the result lands. An action that carries ``"words"`` (a text of at most
    200 characters; ``ask``, ``ask_source``, ``tell``, ``entrust`` and ``promise`` take it) puts
    them in the request as quoted data. An ``entrust`` with words is held for a judge of them,
    first: a request under ``"reply"`` on the cheap tier whose result is one JSON object
    ``{"score": N}`` with a whole number from -10 to 10 (a number past the limit is held to it, and
    anything else counts for nothing), added to the score of the request; the action is
    acknowledged when the answer is made. When the text of a result for a reply passes the gate,
    its line replaces the one on show and what the person said is written down; when it is an
    error or a timeout, or does not pass after one repair, the answer of the rules stays. The
    event ``"answered"`` says which, and a signal ``"replied"`` comes with the line.

    What a model writes for a townsperson is never shown as it comes. The ``"text"`` of the
    ``"model_result"`` for a request of the category ``"reply"`` or ``"prefetch"`` must be one JSON
    object, the reply. The core reads the first object in the text forgivingly (a fenced block,
    single quotes, a trailing comma) and judges what it holds strictly: no other key, every id
    in lower case, no float. The contract is documented in ``lantern_core.cognition.contract``.
    In short::

        {"acts": [act, ...],                  up to 3 acts, or none
         "line": {"zh": str, "en": str},      the sentence, when the model writes it
         "mood": "plain" | "warm" | "wary" | "sad" | "curt" | "eager",     "plain" if left out
         "address": "none" | "manager" | "friend"}                         "none" if left out

        act = {"path": "belief" | "speculation" | "mutation" | "lie",
               "prop": prop id | {"pred", "args", "span", "neg", "motive", "parent", "op"},
               "modality": "assert" | "speculate" | "deny" | "lie",
               "source": "self_seen" | "unknown" | person id,
               "rule": rule id, "premises": [prop id], "op": operator, "template": lie id}

    An act is one thing said and its basis: the belief it repeats, the rule and the premises of a
    guess, the operator of a mutation, the template of a lie (without a ``"prop"``, a feigned
    ignorance). A prop that the book does not have yet is given as an object, for a guess or a
    mutation. Step 1: every act goes through ``paths.authorize``, which is what keeps a person
    from saying what they have no right to say, and an act on something the speaker keeps back is
    refused. Then the core writes the sentence itself, from the acts, in the speaker's own words,
    when any act is plot-critical, causal, negative, modal or names a source (that is where
    "A went by the bridge, so the rail fell" would hide a claim in a connective). The model adds
    only its mood, as an interjection at the start, and its form of address, at the end. Otherwise
    the model's line is kept, if it passes three more steps in both languages: 2, every name and
    every word that says an act or a motive is covered by an act; 3, every connective, negation,
    hedge, certain, hearsay or seen word (closed lists, ``content/tables/speech.yaml``) has an act
    that carries it; 4, the words the speaker keeps back do not appear. The errors come in five
    types: ``format``, ``path``, ``entity``, ``connective`` and ``private``.

    If a reply fails, one repair goes out through the same door as any request: the same
    interaction, category, tier, ``max_tokens`` and conditions, with the messages followed by the
    failed reply and the list of errors. If that fails too, or a result is not ``"ok"``, the
    speaker says their fixed line for not knowing (in a talk, the answer of the rules stays).
    Nothing a model wrote reaches a frame before it has passed. The counts, by type of error, are
    kept in ``state["world"]["speech"]`` (``lantern_core.world.bridge.speech``), a section every
    game has from its first tick.

Outputs
    A JSON object with these keys:

    - ``"tick"``: the tick the inputs were applied at, and ``"advanced"``: whether that tick
      was simulated.
    - ``"frame"``: what the client draws. It always has ``"npcs"``, a list that holds
      ``{"id": str, "x": int, "y": int}`` for each NPC, in grid cells. The m0 scenario adds
      ``"time"``, ``{"day": int, "hour": int, "minute": int}`` on a 24-hour clock that runs
      from 06:00. The bridge scenario has the frame of contract v1: the keys ``"npcs"`` (each
      NPC also with ``"activity"``, ``"carrying"`` and an optional ``"status"`` icon),
      ``"time"`` (also with ``"phase"``, ``"day"`` or ``"night"``), ``"weather"``,
      ``"bubbles"``, ``"dots"``, ``"lanterns"`` and ``"hud"``, all present in every frame.
      ``"bubbles"`` and ``"dots"`` are empty until something is said or told. A telling that the
      manager is too far away to hear is a bubble without words, ``"text": null`` and
      ``"talking": true``. ``"lanterns"``
      lists the households that promised to come, ``{"household", "place", "x", "y"}`` each, the
      cell being the door where the lantern hangs. The frame has three keys more for the festival
      manager and the end of the game: ``"player"``, ``{"x", "y", "activity", "talk", "costs",
      "look", "offers", "topics", "thinking"}``, where they stand, what they are doing, the
      conversation they are in (``{"npc", "costs", "leaves_at"}``, else null: the game minutes of
      each act of a conversation, and the time at which the other person has to go), the game
      minutes of all six acts, speaking in public included, in every frame (``"costs"``), the
      person of the conversation while a model is asked for their words (``"thinking"``, an id,
      else null), what they stand close enough to look at, for
      each of the
      verbs ``tell``, ``entrust``, ``promise`` and ``speak`` the choices to put forward now
      (``"offers"``, each ``{"id", "label": {"zh", "en"}, "body": {...}}``, the body being the
      fields of the action to send), and what they can ask about (``"topics"``, each ``{"id",
      "kind", "label": {"zh", "en"}}`` with ``kind`` one of ``entry``, ``thing``, ``place`` and
      ``person``; in a conversation only, and empty otherwise; they are the entries of the
      notebook, the things of the story, the bridge and the people the script names, and the
      action ``ask`` answers every one of them); ``"notebook"``, their entries, each ``{"id",
      "text": {"zh", "en"}, "source", "marks", "chain"}``; and ``"ending"``, null until the last
      night. In the frame of the call that made the ending it is the ending as the ``"ending"``
      event carries it (below), reveal and epilogue included. In every frame after that it is
      the compact form, the same object without ``"reveal"`` and ``"epilogue"``: ``{"kind",
      "tick", "ending", "label", "hidden", "inputs", "passage", "promised", "turnout"}``, which
      says how the night went. The reveal is most of the ending and a host sends ten frames a
      second, so ``Game.ending_json()`` gives the whole ending at any time, to a host that loads
      a game or comes back to one that is over. A page tells the two forms apart by the key
      ``"reveal"``. Three keys more are for
      the tasks of the manager: ``"tasks"`` (what they are told to do, and where each stands),
      ``"tracked"`` (the id of the one they follow, or null) and ``"cards"`` (a card for each
      person they have met or heard of). Two more are for the notebook: ``"judgments"`` (what the
      manager judged right) and ``"hint"`` (the pair a hint lit, or null). Three more are for what
      people promised them: ``"commitments"`` (the promises made to the manager and where each
      stands), ``"site"`` (what lies at the bridge) and ``"recap"`` (the sheet of the morning, in
      one frame, else null). Two more are the morning's Town Gazette and the night's summary:
      ``"gazette"`` (the Town Gazette of the morning, the recap grown, in the same frame) and
      ``"night"`` (the summary of the night, in the frame of the first tick of each night but
      the last), both else null. The shape of every key, and
      what each package may put in it, is documented in the docstring of
      ``lantern_core.world.bridge`` (which also marks every key as known to the player, public on
      the map, or for tools only), of ``lantern_core.world.bridge.player``, of
      ``lantern_core.world.bridge.agenda``, of ``lantern_core.world.bridge.commitments`` and of
      ``lantern_core.world.bridge.gazette``.
      The ``"hud"`` holds ``"keen"`` (the townsfolk without names who are keen for the
      festival), the money of the game: ``"spent"``, ``"held"`` and ``"cap"`` in micro-yuan, the
      ``"stage"`` of the budget (0, 1 or 2) and ``"cloud"`` and ``"local"``, what the host last
      said, ``"verbs"``, the ids of what the player can do now, and the festival's numbers:
      ``"reputation"`` (0 to 3 stars), ``"resources"`` (what the manager still has to promise),
      ``"pledges"`` (the promises still open), ``"promised"`` (the households that promised),
      ``"turnout"`` (the people expected, from the households, the keen townsfolk, the way across
      and the weather), ``"bridge"`` (``{"done", "need", "percent", "hours", "hours_need",
      "state", "lacking"?}``, the helpers who joined and the work done, with ``"state"`` one of
      ``"broken"``, ``"repairing"``, ``"mended"`` and ``"detour"``) and ``"ending"`` (the id of
      the ending, or ``""`` before the last night; the whole ending is the key of the frame). A
      client reads a frame by its keys and ignores the ones it does not know.
    - ``"events"``: a list of ``{"kind": str, "tick": int, ...}``. The m0 kinds are
      ``"encounter"`` (two NPCs met), ``"chatter"`` (a line of talk, from the ``"model"`` or a
      ``"template"``), ``"interaction_end"``, ``"action_ack"`` (``"applied"``, ``"duplicate"``
      or ``"rejected"``) and ``"void"`` (a result that was not applied, with the reason). The
      bridge kinds are ``"dawn"`` and ``"dusk"``, ``"weather"``, the errand events
      ``"task_start"``, ``"task_done"``, ``"task_fail"``, ``"taken"`` and ``"delivered"``,
      ``"action_ack"``, the player's (``"arrived"``, ``"talk_start"``, ``"talk_end"``,
      ``"declined"``, ``"asked"``, ``"heard"``, ``"look_start"``, ``"look_refused"`` and
      ``"inspected"``, and, for the dealings with people, ``"told"``, ``"lie_caught"``,
      ``"entrusted"``, ``"entrust_done"``, ``"entrust_withdrawn"``, ``"testified"``,
      ``"convened"``, ``"pledged"`` (``"npc"``, ``"pledge"``, ``"what"``, ``"item"``, ``"amount"``,
      the coins of a wage and 0 for any other promise, and ``"due"``), ``"pledge_empty"``,
      ``"pledge_kept"``, ``"pledge_broken"``, ``"spoke"``, ``"feast"``, ``"clarified"`` (what each
      person there made of a clarification), ``"objection_withdrawn"`` (Granny Li no longer
      objects to lending the bamboo) and ``"judged"`` (a judgement of the notes that holds)),
      ``"answered"`` (the
      words a model wrote for a person in a talk landed or did not: ``"npc"``, ``"verb"``,
      ``"result"`` ``"line"`` or ``"template"``, ``"by"``, ``"cause"``, ``"claims"`` and
      ``"entries"``), the festival's
      (``"rally"``, ``"joined"``, ``"promised"``, ``"agreed"``, ``"flag"``, ``"goal"`` and, on the
      night of the last day, ``"ending"`` with the result and the reveal, which the frame of that
      call carries too and ``Game.ending_json()`` keeps; the labels of the reveal are in both
      languages, see ``lantern_core.world.bridge.goals_ending``), the promises' (``"commitment"``,
      a promise made to the manager, broken or taken back, and ``"recap"``, the sheet of the
      morning was made; in a game made with the config ``goods`` set to ``promised`` the
      ``"delivered"`` of an errand that keeps a promise also has its ``"id"`` and the
      ``"amount"``, see ``lantern_core.world.bridge.commitments``), and the budget's:
      ``"downgrade"`` (a request that did not go out on the tier it asked for, with ``"asked"``,
      ``"tier"``, which may be ``"template"``, and the ``"reason"``, one of ``"budget"``,
      ``"cloud_down"`` and ``"local_down"``) and ``"budget_stage"`` (the budget crossed a limit,
      with ``"stage"``, ``"previous"``, ``"spent"``, ``"held"`` and ``"cap"``). One more kind is a
      *signal*, which the state does not count (``state["version"]`` counts the other events, so a
      signal moves no state hash): ``"replied"``, ``{"kind", "tick", "npc"}``. It comes when the
      person the manager talks to has said the line that answers an action of the manager (an
      answer, a refusal, an agreement), in the call that sets the line, before the event that says
      what came of the action and before its ``"action_ack"``. A page that is waiting for that
      line, and shows that the person is thinking, stops waiting on it, whether or not the line is
      the one they said before. Nothing in the world depends on a signal.
    - ``"requests"``: model calls to make, each ``{"request_id", "tier", "messages",
      "max_tokens"}`` plus fields the core keeps for itself: ``"interaction_id"``,
      ``"issued_tick"``, ``"state_version"``, ``"category"``, the ``"valid_if"`` conditions,
      ``"reserve"``, the most tokens the call can cost, and ``"hold"``, the money reserved for
      it in micro-yuan (0 in m0). The host may ignore them. ``"category"`` says what the answer
      is for, and a host that queues its calls puts a request in a class (1 first, 4 last) by it.
      The m0 scenario asks under ``"chatter"``. The bridge scenario has the categories of
      ``lantern_core.world.bridge.categories``, with the class each is meant for (``QUEUE_CLASS``):
      ``"reply"`` (1, a reply the player is waiting for), ``"prefetch"`` (2, a reply made ahead
      for someone near the player), ``"director"`` and ``"paper"`` (3, the director's choices and
      the Town Gazette) and ``"reflection"`` (4, the nightly reflection of the townsfolk). It asks
      under ``"reply"`` in a talk (see Model replies above), and the other names have their classes
      ready for a host. The table
      that gives a host those classes is ``reply = 1``, ``prefetch = 2``, ``director = 3``,
      ``paper = 3`` and ``reflection = 4``. ``"tier"`` is ``"cheap"``, ``"strong"`` or
      ``"local"``. A scenario with a budget (bridge) may send a request out on a
      lower tier than the one the world asked for, and a request that gets a template line is
      not sent at all: the world is given its outcome in the same call, as if the host had
      answered ``"error"`` (the ``"downgrade"`` event says so). A host must send a ``"local"``
      request to its local model and nowhere else, and only ever gets one after it has said
      ``"local_up"``.
    - ``"cancels"``: request ids whose calls the host should abort. The host then reports each
      of them as a ``"model_result"`` with status ``"cancelled"``. An id appears here once. A
      result that the host sends instead, because the abort came too late, is voided.
    - ``"clock"``: ``{"paused": bool, "rate": [num, den]}``. The host runs ``10 * num / den``
      ticks per second of real time while the world is not paused. Both are the world's answer,
      read from its state after the call (``World.rate``, and ``World.halted`` for ``paused``,
      besides the pause of the host), so that they are the same in every replay of the game: the
      bridge scenario keeps the rate at ``[1, 1]``, and holds the clock (``paused`` is true, whether
      or not the host paused) while the player is in a conversation. An act of the player in a
      conversation, and speaking in public, take game minutes: the world is not held until it has
      run that long, at ``[20, 1]``. A host steps a held world only to bring it inputs, which is
      what it does for a paused one. A tick keeps its length in game time whatever the rate is.
    - ``"hash"``: the state hash, present on every tick that is a multiple of 100 and was
      simulated. It is taken after the tick, so it covers the state at tick ``t + 1``.

A game is made from a seed, a scenario and a config (keys of the scenario's own, whose values are
ints, and for the bridge three that are texts: see ``lantern_core.world.bridge``). ``preset(name)``
gives the three for a named game, such as ``slice``, the game the opening page starts, and
``preset(name, seed=..., variant=...)`` gives its rules at another seed and with another story
true.

Beyond ``step`` a game offers:

- ``tick``, ``paused``, ``next_seq`` and ``ticks_per_hour`` (the length of a game hour in ticks,
  which is also the interval of snapshots in a recording; for the bridge scenario, whose night
  hours are shorter, it is the 120 ticks of a daytime hour). A host that restores a game
  numbers its next input ``next_seq``.
- ``hash()``, ``snapshot_json()`` and ``Game.from_snapshot_json(text)``. The snapshot is the
  whole state, and a game restored from it continues bit for bit.
- ``header()``: what a replay needs to rebuild the game from tick 0.
- ``ending_json()``: the whole ending of the game, reveal included, as the ``"ending"`` event
  carried it, or ``null`` before the last night (and always for a scenario without endings). Its
  shape is that of the ``"ending"`` of the frame above, with the keys ``"reveal"`` and
  ``"epilogue"``.
- ``scene_json()``: the static content a client draws once (terrain rows, places, the cast).
  Its keys depend on the scenario. The bridge scene has ``name``, ``width``, ``height``,
  ``layers`` (``terrain`` with ``rows`` and ``legend``, ``buildings``, ``barriers``),
  ``places``, ``cast``, ``families``, ``items``, ``activities``, ``weather``, ``phases``,
  ``time`` and ``player`` (the festival manager: a token like those of the cast, the cell they
  start on, and the names of the things of the story), with Chinese and English names throughout
  (see ``lantern_core.world.bridge``).
- ``ledger_json()``: model usage per tier (``cheap``, ``strong`` and ``local``), in tokens, and
  ``in_flight()``: the ids of the requests that have gone out and not come back. The money is in
  the world's state and in the ``hud`` of every frame, and the prices and the cap of a game are
  in its config and so in its header.
- ``last_inputs`` and ``last_hash``: the normalized records that the last successful ``step``
  applied, which is what ``replay.Recorder`` logs, and the hash it put in its outputs, if any.

``lantern_core.replay`` records a game and rebuilds it from the record.
"""

from __future__ import annotations

from typing import Any

from lantern_core import __version__, canon
from lantern_core.inputs import InputError
from lantern_core.kernel import FORMAT, HASH_EVERY, Kernel
from lantern_core.world.bridge.world import preset as bridge_preset

__all__ = ["FORMAT", "HASH_EVERY", "Game", "InputError", "preset"]


def preset(name: str, seed: int | None = None, variant: str | None = None) -> dict[str, Any]:
    """A named game of the bridge scenario as ``{"scenario", "seed", "config"}``, the three things
    ``Game(seed, scenario, config)`` is made from. A name that is not one is a ``ValueError``.

    ``seed`` and ``variant`` give the rules of the named game at another seed and with another
    story true (a ``variant`` that is not one of the script's, or a seed that is not an int in
    ``[0, 2**53 - 1]``, is a ``ValueError``). The game keeps the name's config in every other key,
    so it is a game of the same rules with a case of its own."""
    seed, config = bridge_preset(name, seed, variant)
    return {"scenario": "bridge", "seed": seed, "config": config}


class Game:
    def __init__(
        self, seed: int, scenario: str = "m0", config: dict[str, int | str] | None = None
    ) -> None:
        """A new game at tick 0. ``config`` overrides the scenario's defaults key by key."""
        self._kernel = Kernel.create(seed, scenario, config)

    @property
    def tick(self) -> int:
        """The tick the next call will apply its inputs at."""
        return self._kernel.state["tick"]

    @property
    def paused(self) -> bool:
        """Whether the world is stopped, which is to say whether a call would not simulate: the host
        paused it, or the world holds its own clock (the bridge does in a conversation)."""
        return self._kernel.stopped()

    @property
    def ticks_per_hour(self) -> int:
        """Ticks in one game hour, which is how often a recording keeps a snapshot."""
        return self._kernel.world.ticks_per_hour

    @property
    def next_seq(self) -> int:
        """The smallest ``seq`` the next input may carry."""
        return self._kernel.state["next_seq"]

    @property
    def last_inputs(self) -> list[dict[str, Any]]:
        """The normalized records that the last successful ``step`` applied."""
        return self._kernel.last_applied

    @property
    def last_hash(self) -> str | None:
        """The hash that the last ``step`` put in its outputs, or None if it put none."""
        return self._kernel.last_hash

    def step(self, inputs_json: str = "[]") -> str:
        """Apply a JSON list of inputs, simulate the tick, and return the outputs as JSON."""
        try:
            records = canon.loads(inputs_json)
        except (ValueError, RecursionError, canon.CanonError) as exc:
            raise InputError(f"inputs are not canonical JSON: {exc}") from exc
        return canon.dumps_str(self._kernel.step(records))

    def hash(self) -> str:
        """SHA-256 of the canonical state, the same under CPython and Pyodide."""
        return self._kernel.hash()

    def snapshot_json(self) -> str:
        """The whole state as canonical JSON. A game restored from it continues bit for bit."""
        return self._kernel.snapshot()

    @classmethod
    def from_snapshot_json(cls, data: str) -> Game:
        """Continue from a snapshot. A snapshot of another format or content is refused."""
        game = cls.__new__(cls)
        game._kernel = Kernel.restore(canon.loads(data))
        return game

    def header(self) -> dict[str, Any]:
        """What a replay needs to rebuild this game from tick 0."""
        return self._kernel.header(__version__)

    def scene_json(self) -> str:
        """The static content a client draws once: terrain rows, places and the cast."""
        return canon.dumps_str(self._kernel.world.scene())

    def ending_json(self) -> str:
        """The whole ending of the game, reveal included, as canonical JSON, or ``null``.

        It is ``null`` before the last night (and always for a scenario without endings), and
        from then on it is the ``"ending"`` event as it was emitted, at any time. The frames
        after the ending carry it without its ``"reveal"``, so a host that loads a game or
        comes back to one that is over gets the reveal from here.
        """
        return canon.dumps_str(self._kernel.ending())

    def preview_json(self, action_json: str) -> str:
        """What an action would ask, give and cost, and what stands in its way, as canonical JSON.

        ``action_json`` is the action a page is about to send, ``{"verb", "npc", ...}`` with the
        fields it will have, and the answer is ``{"version", "cost", "asks", "gives", "blockers",
        "odds", "reasons"}`` (``lantern_core.world.bridge.preview`` has the shapes). ``cost`` is the
        game minutes that the act takes (``lantern_core.world.bridge.pace``), and a request for
        goods says in ``asks`` when they would come, counted from the end of the act. It only reads:
        the state, its hash and the RNG are the same after as before. The ``version`` goes along
        with the action as ``"version"``, and the core rejects an action whose version is not the
        state's as ``stale``. A scenario without previews answers ``null``. An action that is not
        well formed is an ``InputError``.
        """
        try:
            action = canon.loads(action_json)
        except (ValueError, RecursionError, canon.CanonError) as exc:
            raise InputError(f"the action is not canonical JSON: {exc}") from exc
        return canon.dumps_str(self._kernel.preview(action))

    def ledger_json(self) -> str:
        """Model usage per tier, in tokens, as booked from the results received."""
        return canon.dumps_str(self._kernel.state["ledger"])

    def in_flight(self) -> list[str]:
        """Ids of the requests that went out and have not been answered, in issue order."""
        return [r["request_id"] for r in self._kernel.state["requests"]]
