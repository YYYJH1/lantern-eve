"""The server host of lantern-eve: asyncio, model transports, WebSocket frames, batch runs.

- ``session``   one game and the loop that drives it (inputs, pause, model calls, the record)
- ``clock``     the fixed-timestep accumulator that makes game time independent of the event loop
- ``transport`` the interface to a model, and a deterministic mock
- ``openai_transport`` the transport for OpenAI-compatible services: queue, timeouts, host events
- ``chat``      one call to such a service: the request body, the exchange and its outcome
- ``providers`` the provider file: which model answers each tier, and its price
- ``scrub``     keeps API keys out of logs, errors and replays
- ``server``    the aiohttp application: the built web client and the WebSocket on one port
- ``protocol``  the WebSocket messages (documented there)
- ``static``    the built client's files and its Content-Security-Policy
- ``batch``     headless lockstep games
- ``cli``       the ``lantern-eve`` command (``play`` and ``batch``)
"""

__version__ = "0.2.0"
