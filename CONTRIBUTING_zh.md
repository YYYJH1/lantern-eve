<p align="center"><a href="CONTRIBUTING.md">English</a> · <b>简体中文</b></p>

# 参与贡献

提 pull request 之前请先开 issue。

## 文档的两种语言

给读者看的文档都有英文版（`X.md`，以它为准）和中文版（`X_zh.md`，放在同一目录）。改英文文档时，同时改中文版。`tests/test_doc_mirrors.py` 核对两份的首行都是语言切换行、标题层级逐个相同、代码块数目相同。

## 检查

命令在 [docs/development_zh.md](docs/development_zh.md) 里。核心只用标准库，状态里没有浮点数。`tests/core/test_core_rules.py` 检查核心里除 `text/`（读取模型输出的辅助函数）以外的每个模块，发现 `/`、浮点数或遍历集合就会失败。
