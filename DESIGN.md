# Birthday Capsule — Design

> Written 2026-05-19 · Ship target 2026-05-20 09:00 JST · Annual ritual

## 是什么

一只年复一年的生日蛋糕网页。平时打开蜡烛点着，吹不灭；只有 Jada 在 5/20 当天对着摄像头吹气，蜡烛才一根根灭，灭完解锁一段写给明年的话。明年同一天再打开，先看到去年的自己说过什么，再录今年的。

## 不是什么

- 不是公共可玩 demo（别人能看蛋糕，无法触发胶囊）
- 不是日记 / blog（一年只 1 次写 1 次开）
- 不是 ambient 桌面壁纸（这是页面，需要主动打开）

## 流程

### Daily mode（非 5/20 任意日）

1. 开页 → 蛋糕 + 39 根蜡烛点燃 + 火苗 flicker
2. **不开**摄像头 / 不开麦克风
3. 不显示历年 capsule
4. Footer 小字："只在 5/20 听吹气"

### Birthday mode（5/20 当天，本地时区）

1. 开页 → 出现"今天是你的生日，开启摄像头"按钮
2. 点击 → 申请摄像头 + 麦克风权限
3. Face match：
   - face-api detection + 128-dim embedding 比对 `public/embedding.json`
   - 阈值 distance < 0.4 → 是 Jada
   - 不是 → "今天不是你的生日"挡掉，5s 后回 daily mode
4. 是 Jada：
   - 如果有去年 capsule（GitHub Issues label `capsule-YYYY-1`）→ 先弹 modal 展示去年文字 + 录音播放
   - 关闭 modal → 进入蛋糕主舞台，39 根蜡烛点燃
5. 吹气检测：mouth pucker (face landmark) **AND** mic wind spike (Web Audio energy > threshold over 500ms)
   - 每次有效吹气 → 1 根随机未灭蜡烛灭 + 烟 sprite fade
6. 全灭 → "记下来 → 给明年的你" prompt
7. 3 文字输入 + 30s 录音（MediaRecorder webm/opus）
8. 提交：
   - GitHub Issue, title `Capsule 2026`, label `capsule-2026`
   - body: JSON `{ q1, q2, q3, audioBase64 }`（音频 base64 inline，< 1MB）
9. 提交成功 → "封存。明年 5/20 再来。"

### 隔日（5/21+）

回到 daily mode，蜡烛重新点燃。

### 第 N 年 5/20（N ≥ 2）

- 验脸 → 先弹 modal 翻页展示前 N-1 年所有 capsule
- 关闭 → 开新蛋糕，重复 birthday mode

## 视觉

- **蛋糕**：32×32 px sprite，2 层圆形蛋糕，奶油白 + 草莓装饰
- **蜡烛**：4×8 px sprite × 39，环形布在蛋糕顶层
- **火苗**：2-frame idle（橙黄交替，5fps 切换）
- **烟**：3-frame fade（蜡烛灭后 1s 上升消失）
- **舞台**：黑底 + 暖色环境光（夜晚生日感）
- **字体**：等宽 pixel font（默认浏览器 monospace 即可）

## 数据流

```
me.jpg (local, gitignored)
  └─ scripts/generate-embedding.ts (Node, 跑一次)
       └─ public/embedding.json (128 float, committed)

Browser (Birthday mode):
  Camera frame → face-api → embedding
                   ↓ cosine distance vs embedding.json
              match? → enable blow detection

  Mic → Web Audio analyser → RMS energy → threshold trigger
  Face landmark → mouth pucker shape detection
  Both fire within 500ms → blow event → candle out

Submit:
  { q1, q2, q3, audioBase64 } → GitHub Issues API
                                  ↓
                            labeled capsule-2026

Annual unlock (optional v2):
  GitHub Action cron @ 5-20 09:00 JST
    → Telegram bot notify ("🎂 today's the day")
```

## Capsule 内容

3 文字 prompt（textarea，无字数限制）：
- **Q1** 这一年最骄傲的 1 件事
- **Q2** 给明年的你 1 个 warning
- **Q3** 给明年的你 1 个 wish

1 段 30s 录音（自由说什么都行）。

## 技术栈

- Vite + TypeScript (vanilla, 无 framework)
- @vladmandic/face-api (detection + landmark + embedding，maintained fork)
- Web Audio API (mic energy 检测)
- Canvas 2D (cake/candle 渲染，60fps loop)
- MediaRecorder API (audio 录制)
- GitHub Issues API (capsule 后端，零运维)
- Vercel (静态托管)

## 部署

- Vercel: `jada-birthday-capsule.vercel.app`（custom domain v2 再说）
- GitHub: public repo `Jada-Q/birthday-capsule`
- `.gitignore`: `me.jpg`, `.env.local`, `node_modules`, `dist`
- `embedding.json` 公开（128 float 不能反推脸）
- GitHub Token：用 fine-grained token 限 issues:write，存 `.env.local`，前端通过 Vercel env var 注入

## Lethal Trifecta 检查

1. **私有数据**：me.jpg (本地) + GitHub Issues 内容（私密但 repo 公开，issue 也公开 — 见下"隐私权衡"）
2. **不可信内容摄入**：无（唯一输入是 Jada 自己自录自看）
3. **外部通信**：GitHub Issues API

→ **缺角 2（无不可信摄入）→ 安全**。

### 隐私权衡

GitHub Issues 是公开的（public repo）。Capsule 内容会被任何人看到。两种选择：
- **A**：public（默认）— 你的年度反思被世界看到，可能是 feature 不是 bug（"公开的私密"美学）
- **B**：private repo + PAT auth — 完全私密，但 PAT 要管

**默认 A**。想 B 现在说。

## 时间预算

今天（5/19）下午 4-5h ship v1：
- 1.0h scaffold (Vite + face-api install + me.jpg 拍照 + embedding 预生成)
- 1.0h cake + candle pixel sprite + canvas loop
- 1.5h face match + blow detection + 蜡烛灭逻辑
- 1.0h capsule prompt + GitHub Issues 写入 + audio 录音
- 0.5h daily/birthday mode date gate + 部署 + smoke test

明天（5/20）09:00 前 deploy 完成 + 你试用。

## Done 定义

- [ ] Vercel URL 可访问
- [ ] 5/20 当天打开 → 摄像头 + 麦克风权限请求
- [ ] face match 通过（你的脸 ✓，别人 ✗）
- [ ] 吹气 → 蜡烛灭（≥ 30/39 命中率算 OK，剩下手动 click 兜底）
- [ ] 全灭 → 解锁 capsule
- [ ] 提交 → GitHub Issue 出现 `capsule-2026` label
- [ ] 非 5/20 打开 → 只显示蛋糕 + 蜡烛点着，**不**开摄像头

## v2 / 后续年度 TODO

- 2027-05-20 验证：modal 翻页 UX + GitHub Action 通知到位
- 第 5 年评估：candle 数 = 年龄 vs 固定 39 (Jordan Catalano forever)
- Custom domain `birthday.jada.tools` (optional)

## Sunset

3 年 (2029-05-20) 无条件复评：还在用吗？capsule 有 ≥3 年实际数据吗？value > maintenance？

## 决策记录

- **face-api 选 @vladmandic/face-api fork**：原 face-api.js 已停更，fork 持续维护 + TF.js 现代 API。
- **blow 检测用 face + mic 联合**：纯 face landmark flaky，纯 mic 会把讲话当吹气。联合鲁棒。
- **historical capsule 也只在 5/20 看**：强化 ritual，避免变日记。
- **public repo 默认**：年度反思的"公开私密"美学；想 private 现在说。
- **TDD pre-gate**：B 答 no（非 deep rule engine），跳过决策表，走 smoke-test。
