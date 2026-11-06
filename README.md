# 环间音乐 · RPK 源码

小米手环音乐播放器前端，提供播放控制、歌单、歌词、封面和手机传歌功能。
**本地待发布稿，采用 GPL-3.0-only。**

## 适配

| 目录      | 设备 / 固件                   | RPK 版本 |
| --------- | ----------------------------- | -------- |
| `10/rpk`  | 手环 10 普通版 o66cn / 3.1.28 | 0.2.43   |
| `10p/rpk` | 手环 10 Pro / 3.101.043       | 0.2.41   |
| `9p/rpk`  | 手环 9 Pro / 3.1.175          | 0.2.41   |

## 构建

需要 Node.js 22、npm 10，在根目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

单独构建使用 `npm run build:10`、`build:10p` 或 `build:9p`，输出在各款 `rpk/dist/`。
保留 `.npmrc` 的 nested 安装配置；代码排版使用 `npm run format` 和 `npm run format:check`。

## 运行前提

实际播放需要对应固件的配套表盘。
手机互联要求 APK 与 RPK 的包名、签名一致，自编译调试包不能默认与正式 APK 互联。
此副本不附内置歌曲，需从手机传入。安装、播放和视觉效果由用户在设备上审查。

## 文档

- [Android 传歌 API](docs/ANDROID_TRANSFER_API.md)
- [构建与签名](docs/BUILDING.md) · [原生服务协议](docs/PROTOCOL.md)
- [代码风格](docs/CODING_STYLE.md) · [素材来源](docs/ASSETS.md)

## 许可

自有代码和生成素材采用 [GPL-3.0-only](LICENSE)，允许商用、修改和再分发；分发覆盖作品须遵守 GPL 的源码提供等义务。
保留 [NOTICE](NOTICE)；[第三方组件](THIRD_PARTY_NOTICES.md)遵循原许可。
