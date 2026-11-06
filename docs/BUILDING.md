# 构建与签名

使用 Node.js 22 和 npm 10；在本目录根部运行 `npm ci --ignore-scripts`。
锁文件包含三款 workspace，`aiot-toolkit` 固定 2.0.5，`@aiot-toolkit/jsc` 固定 1.0.9。
`.npmrc` 固定 `install-strategy=nested`，使各 workspace 安装自己的工具依赖；
AIoT 2.0.5 按 RPK 路径直接寻找 JSC，默认依赖提升会导致构建失败。
不依赖原工程的绝对路径、外部 node_modules 符号链接、Android SDK 或固件文件。

`npm run build` 顺序构建三款。普通 10 和 9 Pro 沿用 `aiot build --enable-jsc`，
10 Pro 沿用 `aiot build`。产物位于 `10/rpk/dist/`、`10p/rpk/dist/`、`9p/rpk/dist/`。
根构建脚本会移除目标旧调试产物，再检查新 RPK，防止 AIoT 返回 0 却没有成功出包。
这些产物使用工具链本机调试签名，不包含作者正式签名。
`npm test` 无需 npm 依赖，使用 Node 内建测试运行器；`npm run check` 检查分发边界、许可、
工作区锁和资源引用。重建几何图片可运行 `npm run assets`，不会获取外部素材。

## 与正式安装包的区别

小米 interconnect 要求手机 APK 和 RPK 的包名及签名相同：
https://iot.mi.com/vela/quickapp/zh/features/network/interconnect.html

因此，自行构建的调试 RPK 不保证能与现有正式 APK 互联，也不保证能覆盖已安装的同名应用。
社区开发者应使用自己持有的签名配套构建手机端和 RPK；本目录不提供手机端源码或正式私钥。
不要为了尝试签名而卸载有歌曲数据的现有应用；请使用测试设备并先保留数据。

需要自行出 release 包时，按官方文档提供自己拥有的签名，在对应 workspace 执行
`npm run release`。官方签名指南：
https://iot.mi.com/vela/quickapp/zh/guide/start/use-ide.html
`sign/`、私钥和 keystore 都不纳入源码分发，也不需要交给项目作者。

## 包名与私有后端

manifest 保留 `com.tse.musicplayer`。现有原生服务绑定了这个应用的数据目录，
10 Pro 转场客户端也检查该包名。不能只修改 manifest 就假定能并存或继续播放。
如需社区版新包名，需要配套原生服务和手机端同时适配，此审查稿不进行该改动。

没有匹配 FACE 时，RPK 应显示连接或版本错误，不会启动模拟音频冒充播放成功。
10 Pro 的原生转场为额外能力，客户端保留已有未连接时的直接页面切换路径。

## GPL 分发范围

本目录交付 RPK 前端源码，不附私有配套程序。分发 RPK 或组合作品时，应按 GPL 提供相应源码；
是否涉及其他组件及安装信息，须按实际组合判断，不能仅凭采用文件通信就认定豁免。
