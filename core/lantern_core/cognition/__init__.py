"""What the townsfolk know and say: typed props, claims, beliefs, and the rules between them.

``props`` holds the closed tables, the entities and the props themselves. ``beliefs`` holds what is
said (``Claim``) and what is held (``Belief``, ``BeliefStore``, and the rival accounts a holder
keeps in mind against a belief, ``Rival``, with the firmness they cost it). ``rules`` holds the
guessing rules and the lie templates a script gives its characters. ``paths`` holds the table of the
four ways a speaker may say something, and ``script`` reads a whole compiled script, with the truth
of each of its variants. ``provenance`` walks a belief back to where it came from, and ``relations``
gives the four notebook markers. Everything here is pure data and functions on it, built from and
written to the canonical values of ``lantern_core.canon``.
"""
