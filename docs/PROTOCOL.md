# RPK 客户端协议

本文记录本目录代码使用的客户端契约，不包含私有实现、固件地址、驱动或装载过程。
准确字段校验以各款 `src/common/bridge.js`、`player.js`、`music.js` 和测试为准。

## RPK → 原生服务：HBR1 文件邮箱

RPK 在 `internal://files/` 内写入文件。发布使用临时文件写入后 `file.move` 替换，
不通过 `@system.audio` 直接播放，不执行 ELF 或 HPM。

| 文件                                                               | 用途                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `haptic_native_session.txt`                                        | 当前会话及短租约                                                 |
| `haptic_native_request.txt`                                        | ping、load、stage、start、stop、pause、resume、player 等原生请求 |
| `haptic_native_heartbeat.json`                                     | 带 session、tick、player 的服务状态                              |
| `haptic_native_result.json`                                        | 与 session、seq、op 匹配的终态回执                               |
| `haptic_session.txt` / `haptic_request.txt` / `haptic_result.json` | 客户端保留的表盘诊断命令路径                                     |

会话文本按行包含 `HBR1`、session、expires、`END`。
请求文本依次为 `HBR1`、session、seq、op、expires、bytes、crc32；
stage 文件流请求追加 sourceId 和 volumePercent，最后以 `END` 及换行结尾。
客户端限制一次未确认发布，超时与结果未确认分别处理，不将超时当成已经取消的证明。

服务回执检查 `abi === 1`、`native_revision === 1`、同一 session、seq、op，
并要求 `terminal === true`。心跳须属于当前会话，各型号检查自己的原生 build：
10 Pro `0x10430012`，9 Pro `0x91750003`，普通 10 `0x31280019`。
播放状态包括 state、sent、total、rate、crc32、source_id、volume_percent 及运行状态；
客户端要求 12,000 Hz，单曲最多 3,600,000 个 s8 样本，即 300 秒。

手机歌曲使用 32 位小写十六进制 ID，数据文件为 `music_<id>.bin`。
原协议的内置 ID `b` 继续保留在客户端兼容代码中，但此副本不提供内置曲目。
CRC32 负责完整性检测，不承担身份认证。

## 手机 ↔ RPK：haptic.music.v1

完整字段表、Android SDK 接入顺序及可验证消息示例见
[Android 歌曲传输 API](ANDROID_TRANSFER_API.md)。本节保留整体协议概览。

使用 `@system.interconnect`，JSON 消息带 `tag: "haptic.music.v1"`，
请求携带 op、id、seq；回执包含 `type: "ack"`、同一 op/id/seq、ok 和相关结果或错误。
消息发送成功的回调只证明提交，传输完成需要终态回执及校验。

传歌使用 begin → 分块 → 完成校验／receipt，音频描述为 rate 12000、encoding s8，
包含 bytes、crc32、peak 和标题。协商 transport 决定分块长度、间隔及负载编码。
实现包含序号、长度和 CRC 检查、取消、文件落盘和不确定回执恢复。
歌曲目录、歌词、封面和管理命令包括 catalog、lyrics、cover、rename、delete、reorder；
具体字段及上限见 `music.js`，不得绕过客户端已有校验。

普通 10 和 10 Pro 的当前工作区快照支持 `resumeRevision: 1` 的检查点续传；
9 Pro 仍保留其当前协议实现，不能仅凭其他型号支持就向它假定发送续传字段。
目录分页使用 catalogOffset/catalogToken 等字段及版本能力，连接后先协商能力。
落盘文件包括 `music_library.json`，支持续传的版本另有 `music_pending.json` 与临时数据文件。

## 10 Pro 原生转场客户端

`native_transitions.js` 仅通过文件邮箱连接转场服务，固定检查 build `0x10433a01`，
包名为 `com.tse.musicplayer`。状态来自 `native_transition_status.json`，
请求使用 `native_transition_request.txt`／`native_transition_cancel.txt`，文本头为 `ATR1`。
保留连接、nonce、序号、过期、取消和退出交接逻辑。
原生转场未连接时，现有视图代码使用直接页面切换；音频原生服务仍然是播放前提。

## 测试边界

`tests/rpk/player_harness.mjs` 只替代平台文件 API、时钟和原生回执，实际运行本目录的
controller、view、receiver 和 bridge。它不包含或模拟真实驱动、装载器或蓝牙认证。
主机测试通过不等于设备安装、播放或手感验收。
