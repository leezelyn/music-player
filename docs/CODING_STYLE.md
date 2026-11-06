# 代码风格

本项目优先保证代码可阅读，不将多个操作挤在一行。
格式配置不参与 RPK 运行，也不改变平台能力、通信协议或布局参数。

## JavaScript、模板与样式

- JavaScript、JSON、模板和样式使用两个空格缩进，不使用 Tab。
- 函数体、对象字段、分支和循环按层级展开；独立操作分行书写。
- JavaScript 使用单引号，省略行尾分号，由格式化工具处理必要的语句边界。
- 每行目标宽度为 100 个字符。长文案、URL 和正则等内容不为换行而改写语义。
- `.ux` 属性逐行排列，子节点按结构缩进，CSS 属性分别占行。
- 模板按节点结构排版，并对照格式化前后的模板、脚本与样式，检查文字和表达式未变。
- 少量诊断文字包含有意义的双空格或换行，使用 `prettier-ignore` 原样保留。
- 函数之间、状态声明与逻辑块之间保留空行，不靠连续空行划分层次。

Prettier 固定为 3.6.2。安装根目录依赖后运行：

```sh
npm run format
npm run format:check
```

命令处理三款 RPK、Node 工具、测试、配置和 Markdown 文档。
锁文件、生成的 HTML、审查 JSON、构建缓存、官方许可原文和嵌入许可不交给格式化工具重写。
图片和其他二进制资源也不参与排版。

## Python

Python 使用四个空格缩进，函数体、条件和循环展开书写。
本次素材生成脚本使用 Black 25.1.0、88 字符目标行宽整理。
如需继续统一 Python 排版，可在自己的开发环境中安装该版本后运行：

```sh
python3 -m black scripts/generate-assets.py
python3 -m black --check scripts/generate-assets.py
```

Black 仅为可选开发工具，不是素材生成或 RPK 运行依赖；生成图片仍只使用 Python 标准库。

## 修改后的检查

```sh
npm run format:check
npm run check
npm test
npm run build
```

涉及模板时应额外检查实际编译结果。
格式调整不能作为升级应用版本、重排界面或放宽协议校验的理由。
