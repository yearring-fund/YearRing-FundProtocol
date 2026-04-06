# Step3 现状盘点与差距清单

生成时间：2026-04-05
依据：Step3ExecuteOrder.md §1.1–§1.4

---

## 一、已具备的能力

### 合约层

| 能力 | 实现位置 | 状态 |
|---|---|---|
| 白名单准入控制 | `FundVaultV01._deposit()` L270–271，`isAllowed[receiver]` | ✅ 链上强制，已录入 5 地址 |
| 白名单独立于退出 | `_withdraw()` 不检查 `isAllowed` | ✅ 已有用户可随时 redeem |
| Deposit 独立暂停 | `depositsPaused` + `pauseDeposits()` / `unpauseDeposits()` | ✅ EMERGENCY_ROLE 可触发 |
| Redeem 独立暂停 | `redeemsPaused` + `pauseRedeems()` / `unpauseRedeems()` | ✅ EMERGENCY_ROLE 可触发 |
| 系统模式状态机 | `systemMode`: Normal / Paused / EmergencyExit | ✅ 经测试验证 |
| emergencyExit 路径 | `manager.emergencyExit()` → Aave 全额撤回 → Vault | ✅ 不被 pause 拦截（设计如此）|
| 用户 claimExitAssets | EmergencyExit 模式下按快照比例取回 | ✅ 合约实现 |
| 全局 TVL 上限 | `StrategyManagerV01.investCap = 20,000 USDC` | ✅ 已设置，链上强制 |
| 权限角色体系 | DEFAULT_ADMIN_ROLE / EMERGENCY_ROLE / TREASURY | ✅ 三角色已分配 |

### 脚本层

| 脚本 | 状态 |
|---|---|
| `scripts/step2/state.ts` — 全量状态读取 | ✅ 已验证，QuickNode 稳定 |
| `scripts/step2/deposit.ts` — 入金（含 gasLimit、1 USDC 软检查） | ✅ |
| `scripts/step2/invest.ts` — 资金 → Aave | ✅ |
| `scripts/step2/divest.ts` — Aave 撤回（含 dust 自动清理） | ✅ |
| `scripts/step2/withdraw.ts` — 用户 redeem | ✅ |
| `scripts/step2/pause_check.ts` — 8 项权限只读校验 | ✅ |
| `scripts/step3/allowlist_add.ts` — 单地址白名单 | ✅ |
| `scripts/step3/allowlist_batch.ts` — 批量白名单（已执行，5 地址在列） | ✅ |
| `scripts/step3/set_invest_cap.ts` — investCap 设置（已执行） | ✅ |

### 前端层

| 能力 | 状态 |
|---|---|
| `frontend/mainnet.html` — 主网只读 dashboard | ✅ totalAssets / PPS / shares 正常显示 |
| 邀请制 Banner | ✅ 橙色显示，文案明确 |
| QuickNode RPC 接入 | ✅ 稳定读取 |

### 测试层

| 测试文件 | 覆盖内容 | 通过情况 |
|---|---|---|
| `Phase5_Allowlist.test.ts` | 6 项白名单场景（非白名单拒绝、白名单放行、移除后可 redeem 等） | ✅ 全通过 |
| `SafetyMode.test.ts` | pause / systemMode 状态转换 | ✅ 全通过 |
| `EmergencyExit.test.ts` | emergencyExit 路径、权限、资金守恒 | ✅ 全通过 |
| `SecurityBoundary.test.ts` | 管理员无法铸造/销毁/直接操控 NAV | ✅ 全通过 |

总计：42 tests passing（2026-04-05 基线）

---

## 二、缺失能力（Step3 目标直接相关）

### 缺失 1：单地址累计存入上限（2,000 USDC）

- **合约层**：V01 无 per-user deposit cap 字段，无累计存入 mapping
- **影响**：一个白名单地址可存入任意金额，超出 2,000 USDC 无拦截
- **处置**：脚本层软检查（`balanceOf × PPS` 估算当前持仓价值，超限拒绝执行）；**不修改 V01 合约**
- **强制方式**：ADMIN 操作纪律 + deposit 脚本防护，监控预警

### 缺失 2：单日新增总存入上限（5,000 USDC）

- **合约层**：V01 无时间窗口 deposit 追踪
- **影响**：理论上可在一日内超出运营限额
- **处置**：纯运维纪律；deposit 脚本加单日累计估算提示；运营文档中规定操作程序
- **强制方式**：ADMIN 操作纪律（Step3 小规模，可人工管控）

### 缺失 3：Step3 专用监控脚本

- 当前 `state.ts` 读全量状态，但无针对 5 个白名单地址持仓的逐一报告
- 缺少自动化预警（TVL 接近上限、某地址持仓超限、策略异常等）

### 缺失 4：全部 8 份 LIVE_RUN 文档

以下文档均缺失：

| 文档 | 用途 |
|---|---|
| `LIVE_RUN_LIMITS.md` | 运行参数权威来源（白名单、限额、参与条件） |
| `ROLE_MATRIX_LIVE_RUN.md` | 三角色操作权限矩阵 |
| `LIVE_RUN_MONITORING.md` | 监控项、频率、预警阈值 |
| `LIVE_RUN_RUNBOOK.md` | 异常处置 SOP（pause / emergency / 限额超出） |
| `LIVE_RUN_OPERATIONS.md` | 日常运营操作流程 |
| `LIVE_RUN_REPORT_TEMPLATE.md` | 周期性运营报告模板 |
| `USER_FEEDBACK_TEMPLATE.md` | 受邀用户反馈收集模板 |
| `GO_NO_GO_CHECKLIST.md` | Step3 启动 / 扩容决策清单 |

---

## 三、与 Step3 目标冲突的现有实现

### 冲突 1（轻微）：Step2 遗留 dust 导致 PPS ≠ 1.0

- **现象**：当前 Vault `totalAssets = 0.000099 USDC`，`totalSupply = 0.000121 fbUSDC`，`pricePerShare = 0.81781 USDC`
- **原因**：Step2 结束后 Vault 有微量 USDC dust 与未销毁 shares，导致 PPS 偏低
- **影响**：Step3 新用户存入 1 USDC 将获得 ~1.222 fbUSDC（多于面值），PPS 在新存款后会趋向正常
- **是否阻断**：**否**。ERC4626 机制正常，只是数字不直观
- **处置**：在 `LIVE_RUN_LIMITS.md` 和运营文档中说明；前端展示 PPS 时附注说明

### 冲突 2（文档）：STEP3_PLANNING_NOTES.md 中的参数与已执行结果有出入

- `allowlist 地址录入` 已完成，文档中仍列为"待做"
- **处置**：Phase B 开始前更新文档，保持代码与文档同步

---

## 四、可最小复用的模块

| 模块 | 复用方式 |
|---|---|
| `scripts/step2/lib.ts` — snapshot / saveEvidence | 直接复用，Step3 监控脚本基于此扩展 |
| `scripts/step2/state.ts` — 全量状态读取 | 直接复用作为监控基础 |
| `scripts/step2/pause_check.ts` — 权限检查 | 直接复用，纳入运营前置检查 |
| `test/Phase5_Allowlist.test.ts` | 复用，可扩展 Step3 新场景（per-user 软限） |
| `frontend/mainnet.html` | 直接复用，Phase E 中补充用户持仓展示 |
| `docs/ROLE_AND_STATE_MACHINE_MATRIX_V3.md` | 复用内容填入 `ROLE_MATRIX_LIVE_RUN.md` |

---

## 五、建议最小改动路径

按 Step3ExecuteOrder.md 顺序：

| Phase | 改动类型 | 范围 |
|---|---|---|
| **B：白名单与限额落地** | 脚本 | `deposit.ts` 加 per-user 持仓估算上限检查（2000 USDC）；新增 `scripts/step3/monitor.ts` |
| **B：白名单与限额落地** | 文档 | 新增 `LIVE_RUN_LIMITS.md` |
| **C：权限边界与退出保护** | 脚本 | 新增 `scripts/step3/emergency_pause.ts`（快速 pause 一键脚本）；验证 pause_check 在主网可用 |
| **C：权限边界与退出保护** | 文档 | 新增 `ROLE_MATRIX_LIVE_RUN.md` |
| **D：监控与运维文档** | 文档 | 新增 `LIVE_RUN_MONITORING.md` + `LIVE_RUN_RUNBOOK.md` + `LIVE_RUN_OPERATIONS.md` |
| **E：前端与测试收敛** | 前端 | `mainnet.html` 补充 5 用户持仓展示 |
| **E：前端与测试收敛** | 测试 | 补充 per-user 软限场景测试 |
| **F：总复查与交付** | 文档 | 输出全部剩余 LIVE_RUN 文档 + `STEP3_ACCEPTANCE_SUMMARY.md` |

**不在改动路径内（禁止）：** 修改 V01 合约核心逻辑、引入新策略、扩大白名单范围、开放公共存款入口。

---

## 六、Phase A 结论

**当前系统具备进入 Step3 的核心能力（白名单 + 全局上限 + pause/emergency）。**

缺失项均为运营支撑层（限额脚本检查 + 监控 + 运维文档），不涉及合约修改，属于"需补丁"而非"必须新增复杂模块"。

**Phase A 通过，可进入 Phase B。**
