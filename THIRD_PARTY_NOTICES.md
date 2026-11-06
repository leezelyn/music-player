# 第三方组件与许可

GPL-3.0-only 适用于本目录的自有内容，第三方组件保留原许可。
RPK 运行时代码仅使用本目录模块和 `@system.*` 平台接口，没有第三方运行时 JS 库。
本目录不附平台实现、SDK、Canopus、私有模块、npm 安装包或签名材料。

构建依赖固定为 `aiot-toolkit` 2.0.5、`@aiot-toolkit/jsc` 1.0.9，包元数据声明 ISC，包内未附独立许可正文；不自行补造声明。
Prettier 3.6.2 采用 MIT，原文保存在 `licenses/prettier-LICENSE`。Black 仅为可选排版工具，不随本目录分发。
传递依赖声明见 `licenses/dependency-licenses.json`；其中 `only` 0.0.2 缺少许可元数据。
JSZip 的 `(MIT OR GPL-3.0-or-later)` 采用 MIT 分支。
安装及再分发工具依赖时，应保留各包自己的版权与许可。

GNU GPL 第 3 版原文：https://www.gnu.org/licenses/gpl-3.0.txt
本目录的 LICENSE 保留官方原文，NOTICE 说明自有内容及未附组件的范围；三款 RPK 的 `common/LICENSE.txt` 同时携带二者。
