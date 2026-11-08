"""The fixed words of the festival manager's dealings with people, in Chinese and in English.

Everything a townsperson says about a fact is made from a prop (``cognition.lines``). What is left
is the talk around it: a person who will not talk, a person who knows nothing, the line that
introduces a correction, the word that ends a conversation. Each is a short code with its two
texts, so that the state keeps the code and the frame makes the words.

These are the plain words, one text for everyone. Each person of the cast has their own ways of
saying every one of them (``voices``), and the plain words are what the checker holds those ways
apart from, and what anyone says who has no voice of their own.

Nothing here changes what is true. A feigned ignorance and a real one use the same words, so that
the player cannot tell them apart by the sentence.
"""

from __future__ import annotations

PHRASES: dict[str, dict[str, str]] = {
    # a conversation that does not start
    "asleep": {"zh": "呼……呼……（睡熟了）", "en": "Zzz... (fast asleep)"},
    "busy": {
        "zh": "对不住，我正忙着，回头再聊。",
        "en": "Sorry, I am in the middle of something. Another time.",
    },
    # a conversation that ends
    "timeout": {"zh": "我得去干活了。", "en": "I have to get back to work."},
    # an answer that says nothing
    "unknown": {"zh": "这个我不清楚。", "en": "I don't know anything about that."},
    "evade": {"zh": "这事我不想多说。", "en": "I would rather not talk about that."},
    # what comes before an answer that is not quite the one asked for
    "not_said": {"zh": "我可没说过那样的话。", "en": "I never said that."},
    "not_so": {"zh": "不是这样的。", "en": "No, that is not so."},
    # a keeper who will not open the door to a stranger
    "keeper_no": {
        "zh": "这个嘛……咱们还不熟，改天再说吧。",
        "en": "Hmm... we hardly know each other. Not today.",
    },
    # what a person says to something the manager told them
    "took_in": {"zh": "原来是这样，我记下了。", "en": "I see. I will remember that."},
    "knew": {"zh": "这个我早就知道了。", "en": "I knew that already."},
    "doubted": {"zh": "我听到的可不是这样。", "en": "That is not what I have heard."},
    "caught": {
        "zh": "你在撒谎！往后你说的话我不会再信了。",
        "en": "You are lying! I will not believe a word you say again.",
    },
    # what a person says to a promise
    "deal": {"zh": "那就一言为定。", "en": "Then it is a deal."},
    "empty": {"zh": "空口白话，我可不信。", "en": "Empty words. I do not believe them."},
    "kept_thanks": {
        "zh": "总管说话算数，这份情我记着。",
        "en": "The Manager keeps their word. I will remember this.",
    },
    # what a person says to a request
    "will_do": {"zh": "行，这事我应下了。", "en": "All right. I will see to it."},
    "cannot": {"zh": "这个忙我可帮不上。", "en": "I cannot help you with that."},
    "turned_down": {
        "zh": "对不住，这事我不能答应。",
        "en": "I am sorry, I cannot agree to that.",
    },
    "said_already": {"zh": "我说过了。", "en": "I have told you already."},
    "closed": {
        "zh": "这会儿不方便，换个时辰再来。",
        "en": "Not now. Come back at another hour.",
    },
    "needs_nod": {"zh": "这得先过我娘那一关。", "en": "My mother has to agree to that first."},
    "nothing_to_say": {"zh": "这事我没什么好说的。", "en": "I have nothing to say about that."},
    "testified": {
        "zh": "我说的，都是我亲眼看见的。",
        "en": "What I tell you is what I saw with my own eyes.",
    },
    "too_late": {
        "zh": "天色已晚，明早再来说吧。",
        "en": "It is too late. Ask me again in the morning.",
    },
    "will_ask": {"zh": "好，我去跟对方说说。", "en": "All right. I will have a word with them."},
    "will_call": {
        "zh": "好，我这就召集族里的人到祠堂来。",
        "en": "Very well. I will call the clan to the hall.",
    },
    # an answer that says nothing of the matter and points the way: to a person who was heard
    # speaking of it, or to the one the script marks as keeping up with the talk of the town.
    # ``{name}`` is the name of that person (``named``), and these two are the only lines with one
    "point_heard": {
        "zh": "这事我不清楚，不过听{name}说起过，你去问问。",
        "en": "I don't know, but I heard {name} speak of it. Go and ask.",
    },
    "point_hub": {
        "zh": "这事我不清楚，镇上的消息{name}最灵通，你去问问。",
        "en": "I don't know. Ask {name}, who keeps up with the talk of the town.",
    },
    # what a person says when the way is closed (the hard condition of the script)
    "hard_hc_li_bamboo": {
        "zh": "那桩谣言没当众说清楚，我家一根竹子也不借。",
        "en": "Not one pole of bamboo until that slander is cleared in front of everyone.",
    },
    # and when the reason is the rumour that she knows of, and the manager's silence about it
    "hard_hc_li_bamboo_rumour": {
        "zh": "镇上都在说李家毁了桥。你这总管一声不吭，竹料我不借。",
        "en": "The town says the Li family wrecked the bridge. You said nothing, so no bamboo.",
    },
    "hard_other": {"zh": "这事免谈。", "en": "Out of the question."},
    # what the elder says after the manager has spoken in public
    "elder_yes": {
        "zh": "老夫听明白了，这事就这么定了。",
        "en": "I have heard enough. Let that settle it.",
    },
    "elder_no": {
        "zh": "凭这些，老夫还不能下定论。",
        "en": "That is not enough for me to settle it.",
    },
    # the first evening and the morning after: what is said when an objection falls, when someone
    # confirms in public what they saw and no more, when a batch is promised for the morning and
    # when the bamboo is at the bridge
    "objection_withdrawn": {
        "zh": "既然说清楚了，我不再拦着。",
        "en": "Now that it is cleared up, I will no longer stand in the way.",
    },
    "witness_in_public": {
        "zh": "我只说我亲眼看见的。",
        "en": "I only say what I saw with my own eyes.",
    },
    "batch_promised": {
        "zh": "好，第一批明早送到。",
        "en": "Agreed. The first batch will arrive tomorrow morning.",
    },
    "bamboo_arrived": {
        "zh": "竹料已经送到桥边。",
        "en": "The bamboo has arrived at the bridge.",
    },
    # what a person says when asked again for what they have promised, or for what the bridge has
    # enough of. ``{amount}``, ``{item}`` and ``{when}`` are the poles, what they are (bamboo or
    # timber) and the day and hour they fall due, and these two are the lines with slots of goods
    "promise_open": {
        "zh": "我答应过了，{when}把{amount}根{item}送到桥边。",
        "en": "I have promised already: {amount} poles of {item} at the bridge {when}.",
    },
    "goods_enough": {
        "zh": "桥边的{item}已经够了。",
        "en": "There is enough {item} at the bridge already.",
    },
}


# the codes whose texts have a slot for the name of the person they point to
NAMED = ("point_heard", "point_hub")
# the codes whose texts have slots for the goods of the commitments, and which slots (``converse``
# fills them from the promise or the item the state keeps with the line)
GOODS = {"promise_open": ("amount", "item", "when"), "goods_enough": ("item",)}


def phrase(code: str) -> dict[str, str]:
    """The two texts of a code. An unknown code is a mistake in the caller."""
    return dict(PHRASES[code])


def named(text: dict[str, str], who: dict[str, str]) -> dict[str, str]:
    """The two texts of a line of ``NAMED`` with the name of the person it points to filled in."""
    return {lang: text[lang].replace("{name}", who[lang]) for lang in ("zh", "en")}


def joined(first: dict[str, str], second: dict[str, str]) -> dict[str, str]:
    """Two texts one after the other: no space between Chinese sentences, one between English."""
    return {"zh": first["zh"] + second["zh"], "en": first["en"] + " " + second["en"]}
