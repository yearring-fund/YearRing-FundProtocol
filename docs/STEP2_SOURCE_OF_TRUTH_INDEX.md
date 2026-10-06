# Step2 权威来源索引

生成时间：2026-04-04
状态：**已归档 — 可作为 Step3 基线**

---

## 各文件用途说明

### 1. `deployments/base.json`
**用途：** 合约地址与部署配置的唯一权威来源。
所有脚本、前端、后续 Step3 配置均应以此为合约地址基准。
包含：合约地址（USDC / FundVaultV01 / StrategyManagerV01 / AaveV3StrategyV01）、角色地址（admin / guardian / treasury）、协议参数（reserveRatioBps / mgmtFeeBpsPerMonth）。

### 2. `docs/STEP2_STATE_AND_TX.json`
**用途：** Step2 执行过程的结构化状态与交易完整记录。
包含所有 tx hash（共 22 笔）、9 个关键状态快照、收益摘要、pause/emergencyExit 能力矩阵，以及 `step2Verdict: "PASS"` 结论。
**Step3 应优先引用此文件** 核查 Step2 历史状态与交易。

### 3. `docs/STEP2_EXECUTION_REPORT.md`
**用途：** 人类可读的 Step2 执行报告，含详细叙述、状态快照对比表、收益证明、pause 能力确认。
适用于：人工复查、外部说明、审计参考。
不应作为程序化引用的数据源（使用 `STEP2_STATE_AND_TX.json` 代替）。

### 4. `evidence/step2_log.json`
**用途：** Step2 关键动作的时序执行日志，由执行脚本自动写入。
包含 3 条记录：deposit / invest / divest（部分退出）。
**注意：** 后续退出操作（return_partial / redeem_partial / divest_full / dust_cleanup / redeem_full）通过 `_now` 系列脚本执行，未写入此日志。完整 tx 记录以 `STEP2_STATE_AND_TX.json` 为准。

### 5. `evidence/` 目录（补充）
**用途：** 每次动作的 pre/post 状态 JSON 快照，以及 19 个时间点的只读状态文件。
适用于：精细化复查某一笔操作前后的状态变化。

---

## Step3 引用优先级

| 用途 | 优先引用 |
|---|---|
| 合约地址 | `deployments/base.json` |
| 历史状态 / tx hash 核查 | `docs/STEP2_STATE_AND_TX.json` |
| 人工阅读 / 外部报告 | `docs/STEP2_EXECUTION_REPORT.md` |
| 精细状态差值分析 | `evidence/` 目录下各 snapshot |

---

## 地址一致性核对结果（2026-04-04）

| 字段 | `deployments/base.json` | `STEP2_STATE_AND_TX.json` | `STEP2_EXECUTION_REPORT.md` | 一致性 |
|---|---|---|---|---|
| FundVaultV01 | `0x8acaec738...` | `0x8acaec738...` | `0x8acaec738...` | ✅ |
| StrategyManagerV01 | `0xa44d3b9b0...` | `0xa44d3b9b0...` | `0xa44d3b9b0...` | ✅ |
| AaveV3StrategyV01 | `0x621CC4189...` | `0x621CC4189...` | `0x621CC4189...` | ✅ |
| admin | `0x087ea7F67...` | `0x087ea7F67...` | `0x087ea7F67...` | ✅ |
| guardian | `0xC8052cF44...` | `0xC8052cF44...` | `0xC8052cF44...` | ✅ |
| treasury | `0x9d16Eb6A6...` | `0x9d16Eb6A6...` | `0x9d16Eb6A6...` | ✅ |

| 关键 tx | `step2_log.json` | `STEP2_STATE_AND_TX.json` | `STEP2_EXECUTION_REPORT.md` | 一致性 |
|---|---|---|---|---|
| deposit | `0x1d787c03...` | `0x1d787c03...` | `0x1d787c03...` | ✅ |
| invest | `0x58f8b470...` | `0x58f8b470...` | `0x58f8b470...` | ✅ |
| divest_partial | `0xd3b14940...` | `0xd3b14940...` | `0xd3b14940...` | ✅ |

区块时序：44215769 → 44216000 → 44216662 → 44216726 → 44216815 → 44216993 → 44217051（单调递增 ✅）

---

## 已知差异说明

- `evidence/step2_log.json` 仅记录 3 条动作（deposit / invest / divest_partial）
  原因：后续操作通过 `_now` 系列脚本执行，未调用 `appendEvidence`
  影响：不影响证据完整性，完整 tx 记录在 `STEP2_STATE_AND_TX.json` 中已归档
  处置：不需要补写，保留现状即可，Step3 不依赖 `step2_log.json` 作为权威来源
