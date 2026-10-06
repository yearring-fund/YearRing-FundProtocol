# 基准快照说明 — liverun_snapshot_1775394438108.json

## 快照性质

**本次快照为：首批用户进入前的空仓基准快照（Pre-Entry Baseline）**

拍摄时间：2026-04-05T13:07:17.947Z（UTC）
区块高度：44302546（Base Mainnet）
拍摄目的：GO/NO-GO 阶段 D 合规要求，作为 Step3 白名单运行的零点基准

---

## 关键指标

| 指标 | 值 | 说明 |
|---|---|---|
| totalAssets | 0.000099 USDC | 空仓状态，Step2 dust 残留，≈ 0 |
| totalSupply | 0.000121277665914856 fbUSDC | Step2 dust 残留 shares |
| pricePerShare | **0.81781 USDC/fbUSDC** | 见下方 PPS 说明 |
| systemMode | 0 (Normal) | 系统正常 |
| depositsPaused | false | 存款开放 |
| redeemsPaused | false | 赎回开放 |
| manager.paused | false | 策略管理器正常 |
| investCap | 20,000 USDC | 链上硬上限，已就绪 |
| strategy.totalUnderlying | 0 USDC | 无策略部署资金 |

---

## PPS = 0.817810 说明

PPS ≈ 0.818 为已知历史会计状态，已在快照说明与首批用户风险确认中解释，不构成阻断项。

---

## 快照时用户状态

5 个白名单地址（User-A ～ User-E）全部：
- `allowed = true`（白名单已录入）
- `shares = 0`（尚无持仓，首批进入前）
- `headroom = 2,000 USDC`（满额可用）

---

*本说明文件与快照 JSON 一同存档，作为 Step3 空仓基准的完整证据。*
