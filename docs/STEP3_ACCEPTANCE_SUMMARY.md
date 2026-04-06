# STEP3_ACCEPTANCE_SUMMARY.md — Step3 总验收结论

生成时间：2026-04-05
更新时间：2026-04-06（口径统一：Step3 = Internal Mainnet Rehearsal）
状态：**Step3 准备完成 — 可执行 Internal Mainnet Rehearsal**

> **Step3 定义**：Internal Mainnet Rehearsal（内部主网演练）。白名单 5 个地址均由 ADMIN 自控，用于验证主网多地址真实资金的完整流程（存入→投资→赎回）。不涉及外部真实用户，不代表真实用户反馈完成。
>
> **Step4 定义**：首批真实用户进入。真实用户风险确认、用户反馈留档、`USER_FEEDBACK_TEMPLATE.md §二` 等外部用户管理动作均属于 Step4 范畴，与 Step3 无关。

---

## 一、Step3 目标回顾

Step3 唯一目标：将当前系统收敛为可用于 **Internal Mainnet Rehearsal** 的最低可行版本，验证主网多地址真实资金流程的完整性与安全性。

完成标准（5 件事基本成立）：

| 目标 | 状态 |
|---|---|
| 白名单准入有效 | ✅ |
| 运行期限额有效 | ✅ |
| 已有用户退出优先保护成立 | ✅ |
| pause / emergency 路径可执行 | ✅ |
| 监控、运维、Runbook、验收文档齐备 | ✅ |

---

## 二、各阶段执行结论摘要

### 阶段 A：现状盘点与差距分析

**结论**：已具备白名单、退出保护、权限角色三大核心能力；缺少脚本层限额控制、统一监控入口、前端白名单运行收敛三项。差距清单见 `STEP3_GAP_ANALYSIS.md`。

### 阶段 B：白名单与限额

**执行内容**：
- `scripts/step3/query_limits.ts`：只读查询全部限额 + 白名单持仓
- `docs/LIVE_RUN_LIMITS.md`：Step3 参数权威来源

**验收修复**：LIVE_RUN_LIMITS.md §三 原将 investCap 与 TVL_CAP 混同为"链上硬上限"——已修正：明确区分 investCap（链上，策略部署上限）与 TVL_CAP（脚本层，totalAssets 软检查）

**结论**：通过

### 阶段 C：权限边界与退出保护

**执行内容**：
- `scripts/step3/emergency_pause.ts`：一键应急暂停（保留 redeem 路径）
- `test/Phase_C_ExitProtection.test.ts`：17 个测试，覆盖 C-EP1–EP7 退出保护 + C-RB1–RB10 角色边界
- `docs/ROLE_MATRIX_LIVE_RUN.md`：角色权限矩阵与退出优先级表

**验收修复**：前端 allowlist banner 错误表述"Deposits and redemptions require an approved address"——已修正：明确 "Deposits require allowlist. Redemptions are always available." 前端 deposits pill 在 systemMode=Paused 时误显示绿色 "Deposits Open"——已修正为 `depositsEffectivelyBlocked = depPaused || systemMode !== 0n`

**结论**：通过

### 阶段 D：监控、Runbook 与运维脚本

**执行内容**：
- `scripts/liveRun/lib.ts`：共享常量与 ABI 单一来源
- `scripts/liveRun/checkSystemState.ts`：统一巡检（17 项一次读取）
- `scripts/liveRun/checkWhitelist.ts`：白名单持仓与预警
- `scripts/liveRun/checkLimits.ts`：全维度限额利用率
- `scripts/liveRun/exportLiveRunSnapshot.ts`：结构化 JSON 存档
- `docs/LIVE_RUN_MONITORING.md`：监控规范（频率、阈值、预警级别）
- `docs/LIVE_RUN_RUNBOOK.md`：7 节异常处置 SOP
- `docs/LIVE_RUN_OPERATIONS.md`：6 类标准操作流程 + 5 条操作纪律

**结论**：通过

### 阶段 E：前端收敛与测试补齐

**执行内容**：
- `frontend/v01/index.html`：完整 V01 前端（Deposit + Redeem 双面板 + PPS 收益展示）
- `test/Step3_LiveRun.test.ts`：21 个集成测试，覆盖 S3-A～S3-H（完整白名单运行路径）

**验收修复**：EmergencyExit 模式下 redeems pill 误显示绿色 "Redeems Open"（合约实际 `redeem()` revert）——已修正为黄色 warn "Redeems: Use claimExitAssets"

**结论**：通过

### 阶段 F：GO/NO-GO 排查与最终结论

**执行内容**（本阶段）：
- `evidence/step3_go_no_go_working.md`：阶段 A–G 完整排查记录
- `evidence/liverun_snapshot_1775394438108.json`：演练前基准快照（Pre-Entry Baseline）
- `evidence/STEP3_GO_NO_GO_RESULT.md`：最终 GO/NO-GO 结论文件
- `docs/GO_NO_GO_CHECKLIST.md`：GO/NO-GO 评审清单
- `docs/STEP3_ACCEPTANCE_SUMMARY.md`（本文件）

**额外阻断项 F 结论**：Internal Rehearsal 模式，白名单账号由 ADMIN 自控，外部真实用户风险确认不适用。✅ GO。

---

## 三、全部交付物清单

### 合约（无新增，仅使用已有 V01）

| 合约 | 地址 | 作用 |
|---|---|---|
| FundVaultV01 | 见 CONTRACT_ADDRESSES.md | ERC4626 Vault + 白名单 + 状态机 |
| StrategyManagerV01 | 同上 | investCap + invest/divest/emergencyExit |
| AaveV3StrategyV01 | 同上 | Aave V3 USDC 策略 |

### 脚本

| 脚本 | 类型 | 作用 |
|---|---|---|
| `scripts/liveRun/lib.ts` | 共享库 | 常量、ABI、工具函数 |
| `scripts/liveRun/checkSystemState.ts` | 只读 | 日常巡检（推荐每日） |
| `scripts/liveRun/checkWhitelist.ts` | 只读 | 白名单持仓核查 |
| `scripts/liveRun/checkLimits.ts` | 只读 | 全维度限额利用率 |
| `scripts/liveRun/exportLiveRunSnapshot.ts` | 只读 | 结构化 JSON 存档 |
| `scripts/step3/allowlist_add.ts` | 写入 | 添加单地址白名单 |
| `scripts/step3/set_invest_cap.ts` | 写入 | 更新 investCap |
| `scripts/step3/monitor.ts` | 只读 | 含进度条监控 dashboard |
| `scripts/step3/query_limits.ts` | 只读 | 限额 + 白名单详情 |
| `scripts/step3/emergency_pause.ts` | 写入（应急） | 一键暂停入口 |

### 前端

| 文件 | 状态 | 说明 |
|---|---|---|
| `frontend/v01/index.html` | ✅ 完整 V01 前端 | Deposit + Redeem 双面板 + PPS 收益展示 |
| `frontend/v01/config.js` | ✅ | 合约地址 / ABI / RPC 配置 |
| `frontend/index.html` | ✅ | 版本路由（当前指向 v01） |

### 测试

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `Phase5_Allowlist.test.ts` | 14 | 白名单准入全路径 |
| `Phase_C_ExitProtection.test.ts` | 17 | 退出保护 + 角色边界 |
| `SafetyMode.test.ts` | 15 | pause / systemMode 状态机 |
| `EmergencyExit.test.ts` + `ExitRound.test.ts` | 25 | emergencyExit + claimExitAssets + ExitRound |
| `Step3_LiveRun.test.ts` | 21 | Step3 完整白名单运行集成路径 |
| 全套 | **613** | 全部通过，0 失败 |

### 文档

| 文档 | 作用 |
|---|---|
| `LIVE_RUN_LIMITS.md` | Step3 参数权威来源（含 investCap/TVL_CAP 口径区分） |
| `ROLE_MATRIX_LIVE_RUN.md` | 角色权限矩阵 + 退出优先级表 |
| `LIVE_RUN_MONITORING.md` | 监控规范（频率、阈值、预警） |
| `LIVE_RUN_RUNBOOK.md` | 7 节异常处置 SOP |
| `LIVE_RUN_OPERATIONS.md` | 6 类标准操作流程 |
| `LIVE_RUN_REPORT_TEMPLATE.md` | 运营周期报告模板 |
| `GO_NO_GO_CHECKLIST.md` | GO/NO-GO 评审清单 |
| `STEP3_ACCEPTANCE_SUMMARY.md` | 本文件 |
| `STEP3_DOC_ALIGNMENT_NOTE.md` | Step3/Step4 口径边界说明 |

---

## 四、已发现并修复的问题

| 编号 | 发现阶段 | 问题描述 | 影响范围 | 修复方式 |
|---|---|---|---|---|
| FIX-01 | 阶段 B 验收 | LIVE_RUN_LIMITS.md 将 investCap 与 TVL_CAP 混同为"链上硬上限" | 文档口径歧义，可能导致运营误操作 | 拆分为 4 行，明确区分链上 vs 脚本层 |
| FIX-02 | 阶段 C 执行 | 前端 allowlist banner 表述"Redemptions require an approved address" | 与合约行为不符（`_withdraw()` 不检查 allowlist） | 修正为"Redemptions are always available" |
| FIX-03 | 阶段 C 验收 | 前端 deposits pill：`systemMode=Paused` 时显示绿色"Deposits Open" | 误导用户认为存款可用（实际 `_deposit()` 会 revert） | 改为 `depositsEffectivelyBlocked = depPaused \|\| systemMode !== 0n` |
| FIX-04 | 阶段 E 验收 | 前端 redeems pill：`EmergencyExit` 时显示绿色"Redeems Open" | 误导用户认为 `redeem()` 可用（实际 revert `UseClaimExitAssets`） | EmergencyExit 下改为黄色 warn "Redeems: Use claimExitAssets" |

---

## 五、已知限制与设计决策（非阻断，已文档化）

| 编号 | 描述 | 影响 | 处置 |
|---|---|---|---|
| LIMIT-01 | per-user cap / daily cap / TVL_CAP 为脚本层软限制，BYPASS_LIMITS=true 可绕过 | 管理员可超限，非强制 | 已在 LIVE_RUN_LIMITS.md 明确标注，操作纪律限制使用 |
| LIMIT-02 | BYPASS_LIMITS=true 操作不计入 daily tracker | 日限追踪有盲区 | 已在 LIVE_RUN_LIMITS.md §七 文档化 |
| LIMIT-03 | PPS ≈ 0.818 USDC/fbUSDC（Step2 dust 操作导致） | PPS 低于 1，但非损失，系统会计正确 | 已在 LIVE_RUN_LIMITS.md §七 记录，不阻断运行 |
| LIMIT-04 | Step3 阶段无 Timelock，ADMIN 可单人执行所有写入操作 | 操作风险集中 | 已在 ROLE_MATRIX_LIVE_RUN.md 明确，建议 Cold wallet 操作，双人确认 |
| LIMIT-05 | 监控脚本无自动告警（需人工执行），无链上事件订阅 | 依赖人工巡检 | 已在 LIVE_RUN_MONITORING.md 定义频率规范（每日 checkSystemState） |
| LIMIT-06 | V01 合约未经正式外部审计 | 智能合约风险 | 已在 Risk Disclaimer 中展示，Step3 仅限内部演练，资金规模受限额控制 |

---

## 六、演练前必须完成的操作

> 本节仅适用于 Step3 Internal Mainnet Rehearsal。Step4 真实用户进入前另需完成外部用户管理动作（见 Step4 文档）。

1. **运行 GO_NO_GO_CHECKLIST.md** 全部检查项（合约角色确认 + 快照存档）
2. **拍摄基准快照**：`exportLiveRunSnapshot.ts` → 保存至 `evidence/`
3. **确认运营钱包有足够 ETH**（ADMIN ≥ 0.009 ETH，GUARDIAN ≥ 0.001 ETH；预警线分别为 0.00045 / 0.00005 ETH）
4. **确认白名单地址由 ADMIN 自控**，明确本次为内部演练，不对外宣称真实用户参与

---

## 七、演练参数

| 参数 | 值 | 类型 | 依据 |
|---|---|---|---|
| 白名单地址数量 | 5（ADMIN 自控） | 邀请制（内部） | Internal Rehearsal 覆盖多地址场景 |
| per-user cap | 2,000 USDC | 脚本层（软） | 控制单账号风险敞口 |
| TVL_CAP | 20,000 USDC | 脚本层（软） | Step3 全局上限 |
| daily cap | 5,000 USDC | 脚本层（软） | 控制单日流入速度 |
| investCap | 20,000 USDC | 链上（硬） | 已设置，与 TVL_CAP 对齐 |
| reserveRatioBps | 3,000（30% reserve） | 链上 | 保留 30% idle 以支持赎回；70% 可投 Aave |
| invest 频率 | 每 1–2 周一次 | 运维建议 | 控制操作频率，降低操作风险 |
| divest 频率 | 按需（赎回需求 / 定期收益确认） | 运维建议 | 优先保障赎回流动性 |

---

## 八、总体 GO/NO-GO 结论

**结论：✅ GO — 可执行 Internal Mainnet Rehearsal**

**理由**：

1. **资金安全**：会计口径经 613 个测试验证正确；PPS 偏差为已知历史原因，不影响资金；emergencyExit 路径经测试可用
2. **退出保护**：`_withdraw()` 不受白名单、depositsPaused、systemMode=Paused 影响，17 个专项测试验证；ExitRound 路径在 EmergencyExit 下可用
3. **准入控制**：allowlist 链上强制生效，前端展示口径与合约行为一致（已修复 4 处不一致）
4. **应急准备**：GUARDIAN 一键暂停 + ADMIN 恢复路径完整；Runbook 覆盖 7 类异常场景
5. **文档齐备**：运维文档涵盖限额、角色、监控、运维、应急、报告、决策全环节

**前提条件（已满足）**：
- GO_NO_GO_CHECKLIST.md 全部检查项通过（见 `evidence/step3_go_no_go_working.md`）
- 基准快照已存档（`evidence/liverun_snapshot_1775394438108.json`）
- ADMIN 0.009417 ETH ≥ 0.009 ETH ✅；GUARDIAN 0.001010 ETH ≥ 0.001 ETH ✅
- 白名单 5 个地址由 ADMIN 自控，Internal Rehearsal 模式已确认

---

*本文件为 Step3 总验收结论的权威来源。Step3 = Internal Mainnet Rehearsal；Step4 = 首批真实用户进入。两者边界不可混用。*
