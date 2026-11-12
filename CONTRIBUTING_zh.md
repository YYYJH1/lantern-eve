<p align="center"><a href="CONTRIBUTING.md">English</a> · <b>简体中文</b></p>

# 参与贡献

提 pull request 之前，请先开一个 issue。

## 两种语言的文档

给读者看的文档都有两份，英文的 `X.md` 和中文的 `X_zh.md`，放在同一个目录里，以英文版为准。改了英文文档，就要一起改中文版。`tests/test_doc_mirrors.py` 会核对这两份。第一行都得是语言切换，标题的层级和先后要一样，代码块的数目也要一样。

## 检查

命令都在 [docs/development_zh.md](docs/development_zh.md) 里。核心只用标准库，状态里不放浮点数。`tests/core/test_core_rules.py` 会逐个读核心的模块，`text/` 除外，那里是读模型回话的辅助函数。模块里只要用了 `/` 或浮点数，遍历了集合，调用了 `open`、`hash`、`print` 这类函数，或者导入了一小张清单以外的模块，测试就会失败。
