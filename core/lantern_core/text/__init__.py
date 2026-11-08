"""Text helpers ported from auction-night: tolerant JSON reading and amounts as models write them.

Unlike the rest of the core these may return floats, since they read what a model wrote, so the
float and import rules that the core's own modules follow do not apply here. Anything that
reaches the world state goes through a validator first.
"""
