<p align="center"><b>English</b> · <a href="CONTRIBUTING_zh.md">简体中文</a></p>

# Contributing

Please open an issue before a pull request.

## Documents in two languages

Every document for readers exists in English (`X.md`, the source) and in Chinese (`X_zh.md`, in the same folder). When you change an English document, change its Chinese version with it. `tests/test_doc_mirrors.py` checks that the two carry the language switch on the first line, have the same heading levels in the same order and have the same number of code blocks.

## Checks

The commands are in [docs/development.md](docs/development.md). The core uses the standard library only and keeps floats out of its state. `tests/core/test_core_rules.py` reads every module of the core except `text/`, the helpers that read what a model wrote. It fails on `/`, on floats, on walking a set, on calls such as `open`, `hash` and `print`, and on an import from outside a short list.
