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
        "zh": "我这会儿正忙着，等会儿再来吧。",
        "en": "I'm busy just now. Come back a bit later.",
    },
    # a conversation that ends
    "timeout": {"zh": "我得去干活了。", "en": "I have to get back to work."},
    # an answer that says nothing
    "unknown": {"zh": "这事我不知道。", "en": "I don't know anything about that."},
    "evade": {"zh": "这事我不想说。", "en": "I'd rather not talk about that."},
    # what comes before an answer that is not quite the one asked for
    "not_said": {"zh": "我没说过那样的话。", "en": "I never said that."},
    "not_so": {"zh": "不是这样的。", "en": "No, it wasn't like that."},
    # a keeper who will not open the door to a stranger
    "keeper_no": {
        "zh": "咱们还不熟，改天再说吧。",
        "en": "We hardly know each other. Another day.",
    },
    # what a person says to something the manager told them
    "took_in": {"zh": "原来是这样。我记下了。", "en": "I see. I'll remember that."},
    "knew": {"zh": "这个我早就知道了。", "en": "I knew that already."},
    "doubted": {"zh": "我听到的可不是这样。", "en": "That's not what I heard."},
    "caught": {
        "zh": "原来你骗了我。往后你的话，我不信了。",
        "en": "So you lied to me. I won't believe you again.",
    },
    # what a person says to a promise
    "deal": {"zh": "好，就这么说定了。", "en": "All right, it's a deal."},
    "empty": {"zh": "光说不算，我不信。", "en": "Talk is cheap. I don't believe it."},
    "kept_thanks": {
        "zh": "你说到做到，我记着。",
        "en": "You did what you said. I won't forget it.",
    },
    # what a person says to a request
    "will_do": {"zh": "行，这事我来办。", "en": "All right, I'll do it."},
    "cannot": {"zh": "这个忙我帮不上。", "en": "I can't help you with that."},
    "turned_down": {
        "zh": "对不住，这事我不能答应。",
        "en": "Sorry, I can't agree to that.",
    },
    "said_already": {"zh": "我刚才说过了。", "en": "I've told you already."},
    "closed": {
        "zh": "这会儿不行，换个时辰再来。",
        "en": "Not now. Come back at another hour.",
    },
    "needs_nod": {
        "zh": "这事我做不了主，得先问过家里。",
        "en": "It's not mine to decide. I have to ask at home first.",
    },
    "nothing_to_say": {"zh": "这事我没什么可说的。", "en": "I've nothing to say about that."},
    "testified": {
        "zh": "我说的都是我亲眼看见的。",
        "en": "What I tell you is what I saw myself.",
    },
    "too_late": {
        "zh": "太晚了，明天早上再来吧。",
        "en": "It's too late. Come back in the morning.",
    },
    "will_ask": {"zh": "好，我去替你说说。", "en": "All right. I'll go and speak for you."},
    "will_call": {
        "zh": "好，我这就去叫大家到祠堂。",
        "en": "All right. I'll go and call everyone to the hall.",
    },
    # an answer that says nothing of the matter and points the way: to a person who was heard
    # speaking of it, or to the one the script marks as keeping up with the talk of the town (the
    # teahouse keeper, whose name says where the keeper is found). ``{name}`` is the name of that
    # person (``named``), and these two are the only lines with one
    "point_heard": {
        "zh": "这事我说不清。我听{name}提起过，你去问问。",
        "en": "I don't know. I heard {name} talk about it, so go and ask.",
    },
    "point_hub": {
        "zh": "这事我不知道。你去问问{name}，镇上的消息那儿最多。",
        "en": "I don't know. Ask {name}, who hears all the news.",
    },
    # what a person says when the way is closed (the hard condition of the script)
    "hard_hc_li_bamboo": {
        "zh": "那个谣言不当众说清楚，李家一根竹子也不借。",
        "en": "Not one pole of Li bamboo until that rumour is cleared up in public.",
    },
    # and when the reason is the rumour that she knows of, and the manager's silence about it
    "hard_hc_li_bamboo_rumour": {
        "zh": "镇上都在说李家弄坏了桥，你这个总管一句话也不说。竹料不借。",
        "en": "The whole town says the Li family broke the bridge, and you say nothing. No bamboo.",
    },
    "hard_other": {"zh": "这事没得商量。", "en": "That's out of the question."},
    # what the elder says after the manager has spoken in public
    "elder_yes": {
        "zh": "老夫听明白了，这事就这么定了。",
        "en": "I've heard enough. That settles it.",
    },
    "elder_no": {
        "zh": "就凭这些，老夫还定不下来。",
        "en": "That isn't enough for me to settle it.",
    },
    # the first evening and the morning after: what is said when an objection falls, when someone
    # confirms in public what they saw and no more, when a batch is promised for the morning and
    # when the bamboo is at the bridge
    "objection_withdrawn": {
        "zh": "既然说清楚了，我就不拦着了。",
        "en": "Now that it's cleared up, I won't stand in the way.",
    },
    "witness_in_public": {
        "zh": "我只说我亲眼看见的。",
        "en": "I only say what I saw with my own eyes.",
    },
    "batch_promised": {
        "zh": "好，第一批明天早上送到。",
        "en": "All right. The first batch comes tomorrow morning.",
    },
    "bamboo_arrived": {
        "zh": "竹料送到桥边了。",
        "en": "The bamboo is at the bridge now.",
    },
    # what a person says when asked again for what they have promised, or for what the bridge has
    # enough of. ``{amount}``, ``{item}`` and ``{when}`` are the poles, what they are (bamboo or
    # timber) and the day and hour they fall due, and these two are the lines with slots of goods
    "promise_open": {
        "zh": "我答应过了，{when}把{amount}根{item}送到桥边。",
        "en": "I've promised already: {amount} poles of {item} at the bridge {when}.",
    },
    "goods_enough": {
        "zh": "桥边的{item}已经够了。",
        "en": "There is enough {item} at the bridge already.",
    },
    # what a person says to a small thing given them, by how they take it (``gifts``): ``{item}`` is
    # the thing
    "gift_like": {
        "zh": "{item}啊，这个我喜欢。多谢。",
        "en": "Ah, {item}. Just what I like. Thanks.",
    },
    "gift_neutral": {
        "zh": "{item}？好，谢谢你想着我。",
        "en": "Some {item}? Thank you for thinking of me.",
    },
    "gift_dislike": {
        "zh": "{item}啊……这个我不大碰。还是谢谢你。",
        "en": "Ah, {item}... I don't really use these. Thank you all the same.",
    },
}


# the codes whose texts have a slot for the name of the person they point to
NAMED = ("point_heard", "point_hub")
# the codes whose texts have slots for the goods of the commitments, and which slots (``converse``
# fills them from the promise or the item the state keeps with the line)
GOODS = {"promise_open": ("amount", "item", "when"), "goods_enough": ("item",)}
# the codes of the answer to a gift, by how the person takes it, each with the slot of the thing
GIFT = {"like": "gift_like", "neutral": "gift_neutral", "dislike": "gift_dislike"}


def phrase(code: str) -> dict[str, str]:
    """The two texts of a code. An unknown code is a mistake in the caller."""
    return dict(PHRASES[code])


def named(text: dict[str, str], who: dict[str, str]) -> dict[str, str]:
    """The two texts of a line of ``NAMED`` with the name of the person it points to filled in."""
    return {lang: text[lang].replace("{name}", who[lang]) for lang in ("zh", "en")}


def joined(first: dict[str, str], second: dict[str, str]) -> dict[str, str]:
    """Two texts one after the other: no space between Chinese sentences, one between English."""
    return {"zh": first["zh"] + second["zh"], "en": first["en"] + " " + second["en"]}
