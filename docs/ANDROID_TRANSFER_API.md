# Android ↔ RPK 传歌 API

基于本审查目录的三款 RPK，2026-11-02 核对。使用小米应用互联传送 UTF-8 JSON，非 HTTP。

## 接入

APK 与 RPK 的包名、签名须一致，当前包名为 `com.tse.musicplayer`。
选定节点并完成 `DEVICE_MANAGER` 授权后，先注册监听，再启动 `/pages/index`。

| Android SDK 调用                                                   | 用途           |
| ------------------------------------------------------------------ | -------------- |
| `MessageApi.addListener(nodeId, listener)`                         | 接收并解析回复 |
| `NodeApi.launchWearApp(nodeId, "/pages/index")`                    | 打开播放器     |
| `MessageApi.sendMessage(nodeId, json.toByteArray(Charsets.UTF_8))` | 发送业务消息   |
| `MessageApi.removeListener(nodeId)`                                | 结束时撤销监听 |

先用 `catalog` 确认业务通道和能力；当前不支持 `__hs__` / `info` 握手。
SDK 发送成功不等于手环保存成功。平台配置见 [官方说明](https://iot.mi.com/vela/quickapp/zh/features/network/interconnect.html#开发注意事项)。

## 公共字段

| 字段  | 约定                                         |
| ----- | -------------------------------------------- |
| `tag` | 固定 `haptic.music.v1`                       |
| `id`  | 32 位小写十六进制；音频传输 ID 同时是歌曲 ID |
| `seq` | 非负整数；begin=0，分块从 1 开始             |
| `op`  | 操作名                                       |

ACK 包含相同的 tag / id / seq / op，以及 `type: "ack"`、`ok`。
一次只发送一个未确认请求，匹配成功 ACK 后再推进；重试复用原始消息，不改变 ID、序号或字段顺序。
歌词、封面和管理操作使用新的请求 ID，以 `songId` 指定已有歌曲。

## 传歌流程

```text
catalog → begin → chunk（逐块等 ACK）→ commit → saved + receipt
```

音频为无文件头的 **12000 Hz、单声道、signed 8-bit PCM（s8）**。
单曲 1–3600000 字节，最长 300 秒；样本绝对值不得超过声明 peak，不能使用 -128。

### 1. begin

| 附加字段           | 要求                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `title`            | 1–64 个 UTF-16 代码单元，无控制字符                               |
| `bytes`、`crc32`   | 原始 PCM 总长、整包无符号 CRC32                                   |
| `rate`、`encoding` | 12000、`s8`                                                       |
| `peak`             | 1–127，非播放音量百分比                                           |
| `lyrics`           | 可省略；提供时须为合法非空 LRC                                    |
| `resumeRevision`   | 申请续传时为 1，仍须检查 ACK 能力                                 |
| `transport`        | chunkBytes=256–16384、intervalMs=0–1000、payloadEncoding=`base64` |

以下测试向量是 ASCII `123456789` 的 9 个样本，不是可听歌曲：

```json
{
  "tag": "haptic.music.v1",
  "id": "11111111111111111111111111111111",
  "seq": 0,
  "op": "begin",
  "title": "协议测试向量",
  "bytes": 9,
  "crc32": 3421780262,
  "rate": 12000,
  "encoding": "s8",
  "peak": 64,
  "resumeRevision": 1,
  "transport": {
    "chunkBytes": 256,
    "intervalMs": 20,
    "payloadEncoding": "base64"
  }
}
```

以 ACK 的 `transport`、`next`、`nextSeq` 为准；新传输 next=0。
9 Pro 不提供 nextSeq，首次从 seq=1 开始。
现有 Android 默认请求 4096 字节 / 20 毫秒，另有快速 16384 / 0、稳定 1024 / 50。

### 2. chunk

```json
{
  "tag": "haptic.music.v1",
  "id": "11111111111111111111111111111111",
  "seq": 1,
  "op": "chunk",
  "offset": 0,
  "data_b64": "MTIzNDU2Nzg5",
  "crc32": 3421780262
}
```

CRC32 覆盖本块原始字节，Base64 使用标准编码并带正确 padding。
检查 ACK 的 `next == offset + 本块字节数` 后，才递增 seq 并发送下一块。
普通块按协商块长发送，最后一块使用剩余长度；offset / next 的单位均为原始字节。
旧 hex 模式使用小写 `hex` 字段，最多 1024 字节 / 块；新接入优先使用 Base64。

### 3. commit / receipt

发完 N 块后发送 `op: "commit", seq: N+1`。本例为：

```json
{
  "tag": "haptic.music.v1",
  "id": "11111111111111111111111111111111",
  "seq": 2,
  "op": "commit"
}
```

保存成功必须同时满足：

- `ok: true`、`saved: true`、`next == bytes`。
- receipt 的 revision=1、state=`saved`、verified=true，且 id / title / bytes / crc32 与本次歌曲一致。
- peak 不为 64 时核对 receipt.peak；附带歌词时核对 lyricsRevision=1 和 lyricsChars。

最终回复丢失时，用原 ID 发送 `op: "receipt"` 查询；不要直接换 ID 重传。
完整请求与预期回执见 [JSON 示例](examples/android-transfer.json)，实际发送其中 requests 下的单个对象。

## 其他操作

均携带公共字段。独立任务使用新 ID；catalog 翻页沿用同一 ID 并递增 seq。
歌词、封面与曲库修改前先停止播放，保持播放器打开。

| op            | 附加字段 / 处理                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `catalog`     | catalogPageRevision=1、catalogOffset=0；下一页带回 catalogToken，offset 使用 catalogNext；null 表示结束，每页最多 20 首 |
| `lyrics`      | songId、音频 bytes/crc32、当前 lyricsVersion、完整 lyrics；检查 lyricsSaved 和 lyricsUpdateRevision=1                   |
| `cover`       | songId、音频 bytes/crc32、当前 coverVersion、coverBytes、coverCrc32、coverB64；检查 coverSaved 及 coverVersion=旧版本+1 |
| `cancel`      | 使用原传输 ID；cancelled=true 表示已中断，saved=true 表示已保存且未删除                                                 |
| `rename`      | songId、bytes、crc32、expectedTitle、title、catalogPageRevision=1                                                       |
| `delete`      | songId、bytes、crc32、catalogPageRevision=1；与取消未完成传输不同                                                       |
| `reorder`     | 完整 ids、expectedIds、catalogPageRevision=1                                                                            |
| `diagnostics` | 无额外必填字段，返回 diagnostics 对象                                                                                   |

catalog 的 songs 含 id、title、bytes、crc32、hasLyrics、lyricsVersion、hasCover、coverVersion。
翻页期间 token 或曲库变化须从头读取。管理操作检查 managementRevision=1、applied=true；
delete 还检查 deleted=true。收到 catalogRefresh=true 后重新分页查询。

LRC 最多 4096 个 UTF-16 代码单元、256 个时间点、单句 160 个代码单元，offset 不超过 ±60000 毫秒。
封面为 16–8192 字节的 baseline JPEG，正方形边长 32–256；coverB64 最多 10924 字符。
歌词 / 封面回复还须匹配 songId 和音频身份，更新后可重新 catalog 取得版本。

## 型号差异与恢复

| 能力                                        | 普通 10 / 10 Pro | 9 Pro  |
| ------------------------------------------- | ---------------- | ------ |
| 传歌、回执、取消、分页曲库、歌词、封面      | 支持             | 支持   |
| 续传 resumeRevision=1                       | 支持             | 不提供 |
| 远程 rename / delete / reorder、diagnostics | 支持             | 不提供 |

仅在 ACK 声明 resumeRevision=1 时续传：用同一 ID、相同音频元数据、歌词和 transport 重发 begin，
按 next / nextSeq 继续；`nextSeq = ceil(next / chunkBytes) + 1`。除完整末尾外，next 必须块对齐。
next=bytes 时直接 commit；若 begin 已返回 saved=true，核对 receipt 后结束。

当前 Android 普通请求等 20 秒，commit / receipt 至少等 60 秒，每次最多尝试 3 次。
失败时检查 error、unconfirmed、cancelled；结果未确认不能推进偏移或宣称已清理。
手环主动中断的事件为 `type: "cancelled"`，没有 seq / op；匹配 ID 后停止发送。

RPK 入站 JSON 当前限 24576 个 UTF-16 代码单元，Android 包装层入站回复限 4096；
大回复或长标题曲库需留意该限制。这些是应用实现限制，不是 SDK 平台上限。
实现以 [接收器源码](../10p/rpk/src/common/music.js)和 [9 Pro 版本](../9p/rpk/src/common/music.js)为准。
