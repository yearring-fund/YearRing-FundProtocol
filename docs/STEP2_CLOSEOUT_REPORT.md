# Step2 收尾报告

生成时间：2026-04-04
状态：**Step2 收尾完成 — 可进入 Step3**

---

## Step2 收尾目标

将 Step2 已完成的主网 Aave V3 闭环验证固化为稳定可重复的运行基础，并为 Step3（白名单 / 限额正式试运营）做好前置准备。

具体目标：
1. 执行脚本稳定性收尾（gasLimit 固化）
2. 正式 RPC 切换（QuickNode）
3. Step2 证据文件归档与一致性核对
4. 前端主网只读接入 + 邀请制提示
5. dust 自动清理逻辑补充 + Step3 规划预留

---

## Phase 1–5 结论摘要

### Phase 1：执行脚本 gasLimit 固化 ✅

全部 4 个核心执行脚本已补充显式 gasLimit：

| 脚本 | 操作 | gasLimit |
|---|---|---|
| `deposit.ts` | `usdc.approve()` | 100,000 |
| `deposit.ts` | `vault.deposit()` | 250,000 |
| `invest.ts` | `vault.transferToStrategyManager()` | 150,000 |
| `invest.ts` | `manager.invest()` | 500,000 |
| `divest.ts` | `manager.divest()` | 500,000 |
| `divest.ts` | `manager.returnToVault()` | 200,000 |
| `divest.ts` | dust divest（自动） | 500,000 |
| `divest.ts` | dust returnToVault（自动） | 200,000 |
| `withdraw.ts` | `vault.redeem()` | 400,000 |

证据记录逻辑（`saveEvidence` / `appendEvidence`）未受影响。

---

### Phase 2：正式 RPC 切换 ✅

| 项目 | 结果 |
|---|---|
| RPC 服务商 | QuickNode Base Mainnet |
| 环境变量 | `BASE_MAINNET_RPC_URL`（`.env`）|
| 公共 RPC fallback | 已移除，未设置时显式报错 |
| 所有脚本 RPC 来源 | `ethers.provider`（Hardhat 注入），统一读取 `BASE_MAINNET_RPC_URL` |
| 连接验证 | 只读脚本成功读取主网状态，无断线 |

---

### Phase 3：证据文件归档 ✅

四份关键证据文件齐全，交叉核对通过：

| 文件 | 状态 |
|---|---|
| `docs/STEP2_EXECUTION_REPORT.md` | ✅ 完整 |
| `docs/STEP2_STATE_AND_TX.json` | ✅ 完整（22 笔交易，9 个状态快照，step2Verdict=PASS）|
| `evidence/step2_log.json` | ✅ 存在（3 条主要动作，完整 tx 以 STATE_AND_TX.json 为准）|
| `deployments/base.json` | ✅ 完整（合约地址 + 角色地址 + 协议参数）|

合约地址、角色地址、关键 tx hash 三方一致，区块时序单调递增。

权威来源索引：`docs/STEP2_SOURCE_OF_TRUTH_INDEX.md`

---

### Phase 4：前端主网只读接入 ✅

新建两个文件，不影响现有 Sepolia demo：

| 文件 | 说明 |
|---|---|
| `frontend/mainnet-config.js` | Base 主网合约地址 + QuickNode RPC + 只读 ABI |
| `frontend/mainnet.html` | 只读 dashboard（totalAssets / PPS / totalSupply / stratUnderlying / systemMode）|

- 邀请制橙色 banner 清晰可见（"Allowlist / Invitation Mode"）
- 无 deposit / redeem 交互按钮
- 数据来自 QuickNode，验证读取正常
- 打开方式：浏览器直接打开 `frontend/mainnet.html`

---

### Phase 5：dust 自动清理 + Step3 规划 ✅

`divest.ts` 已补充 dust 自动检测与清零逻辑：
- 触发条件：full-divest 模式（不设 `AMOUNT`）且 `strategy.totalUnderlying() > 0 && < 1 USDC`
- 自动执行：dust divest → returnToVault，完整日志输出
- 超阈值（≥ 1 USDC）时打印 WARNING，不自动处理

Step3 规划说明：`docs/STEP3_PLANNING_NOTES.md`

---

## 关键修复与改动摘要

| 类别 | 改动 |
|---|---|
| 脚本稳定性 | `deposit.ts` / `invest.ts` / `divest.ts` / `withdraw.ts` 补充 gasLimit |
| RPC 稳定性 | 切换 QuickNode，移除公共节点 fallback，`.env.example` 同步 |
| dust 防护 | `divest.ts` 新增全自动 dust 检测清零，阈值 1 USDC |
| 证据归档 | 新增 `STEP2_SOURCE_OF_TRUTH_INDEX.md` |
| 前端接入 | 新增 `mainnet-config.js` + `mainnet.html`（只读 + 邀请制） |
| Step3 准备 | 新增 `STEP3_PLANNING_NOTES.md` |

---

## 当前是否可进入 Step3：**可以**

### 总复查五项（全部通过）

| 条件 | 状态 |
|---|---|
| 1. 所有关键执行脚本已显式设置 `gasLimit` | ✅ 9 个交易调用，全部覆盖 |
| 2. 正式 RPC 已替换并生效 | ✅ QuickNode，无公共节点 fallback |
| 3. Step2 四份关键证据文件已归档并核对一致 | ✅ 地址 / tx hash / 时序三方一致 |
| 4. 前端已接入 Base 主网核心只读数据 | ✅ mainnet.html 数据正常，邀请制提示清晰 |
| 5. Step3 前置阻塞项已清空 | ✅ dust 逻辑已补，规划文档已输出 |

---

## 后续动作清单

### Step3 启动前仍需完成

1. **allowlist 录入**：将首批受邀用户地址添加到 Vault allowlist（`vault.addToAllowlist(address)`）
2. **运营钱包 gas 储备确认**：ADMIN / GUARDIAN 钱包建议保持 ≥ 0.1 ETH
3. **入金金额上限评估**：确认 `investCap`（当前 0 = unlimited）是否需要设置上限

### Step3 启动后再做的低优先级项

- TVL 历史曲线展示
- 收益自动化统计脚本
- 前端 deposit / redeem UI 接入（allowlist 稳定后）
- WebSocket 实时更新（`BASE_MAINNET_WSS_URL` 已备用）

### 当前不建议扩展的事项

- 多资产 / 多策略
- 跨链 / RWA 正式接入
- 公开开放存款（allowlist 尚未扩大前）
- 修改 V01 核心合约（需重走 Step1 验证流程）
