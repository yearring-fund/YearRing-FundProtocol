# Step1 总复查报告（Phase Final）

状态：**通过**

验收时间：2026-04-03

关联命令：`fd/step1pFcheck.md`

对照规范：`fd/STEP1_FINALIZED_SPEC_CN.md`（冻结版）

测试状态：**575 / 575 通过**

---

## 1. 总复查结论摘要

Step1 所有 Phase 的原始阻塞项均已修复，七个模块逐条比对无未闭合冲突。未发现"局部通过、整体不自洽"的问题。跨阶段会计口径、权限边界、状态机行为、储备纪律、合规叙事全部一致。

---

## 2. Phase 0–7 验收结果汇总表

| Phase | 内容 | 原始结论 | Patch 后状态 | 当前状态 |
|---|---|---|---|---|
| Phase 0 | 差异分析 / Gap Analysis | 完成 | N/A | ✅ 已冻结产出 `STEP1_GAP_ANALYSIS.md` |
| Phase 1 | 资产与份额会计逻辑 | 通过 | N/A | ✅ `Accounting.test.ts` / `Phase3_VaultAccounting.test.ts` 全通 |
| Phase 2 | 角色、状态机、Rebalance | 通过 | N/A | ✅ `Phase2_RolesAndRebalance.test.ts` 全通 |
| Phase 3 | Strategy 层、收益路径 | 通过 | N/A | ✅ `Phase4_StrategyBoundary.test.ts` 全通 |
| Phase 4 | 权限、治理桥接、Timelock | 通过 | N/A | ✅ `Phase4_Timelock.test.ts` 全通；PROPOSER_ROLE 在 GovernanceSignalV02 落地 |
| Phase 5 | 合规 Hook（allowlist） | **不通过** | Patch1 完成 | ✅ 14 项 allowlist 测试全通；C1–C4 全部关闭 |
| Phase 6 | 前端一致性 | **不通过** | Patch1 / 1.5 / 2 完成 | ✅ F1–F8 全部关闭 |
| Phase 7 | 文档与叙事一致性 | **不通过** | Patch1 + Patch2 完成 | ✅ N1–N6 全部关闭 |

---

## 3. Step1 七模块闭合度检查

### 模块 1 — 项目身份与外部表述

- `README.md` 已更新为 `V3 testnet demo build`
- `docs/ONE_PAGER.md` §Current Build Status 已反映 V3 真实状态（Timelock / Governance / Frontend 落地）
- `docs/ONE_PAGER.md` §Next Milestone 已改写为 Step2 mainnet real-yield + V4 规划
- 无"保收益"、"随时无损退出"、"绕过监管"等越线表述

**结论：✅ 闭合**

---

### 模块 2 — 资产与份额会计逻辑

- `totalAssets()` = vault USDC + `strategyManager.totalManagedAssets()`，不含 RWT
- `pricePerShare()` = `convertToAssets(10^decimals())`，RWT 价格从不影响 PPS
- 管理费以 mint 新份额给 treasury 的方式计提，不直接扣减用户余额
- EmergencyExit 下 `accrueManagementFee()` 推进时钟但不 mint（恢复后不倒推计费）
- Paused 下费用继续计提（用户仍持有 share，符合规范 §3"管理费继续计提"）
- `_decimalsOffset = 12`：fbUSDC 固定 18 位，防止小额存款份额价格操纵

**结论：✅ 闭合**

---

### 模块 3 — 申赎、流动性与退出机制

- Normal：deposit 和 redeem 均可（需 allowlist）
- Paused：`depositsPaused` / `redeemsPaused` 独立控制，`setMode(Paused)` 不隐式暂停 redeem
- EmergencyExit：
  - `_deposit` 检查 `systemMode != Normal → revert DepositsArePaused()`
  - `_withdraw` 检查 `systemMode == EmergencyExit → revert UseClaimExitAssets()`
- `claimExitAssets()` 是 EmergencyExit 下唯一合法退出路径，按 snapshot 比例，不按实时 PPS
- 前端 VaultSection 读取 systemMode：EmergencyExit 下 Redeem 禁用，claimExitAssets 区块展示
- Exit Round 管理（openExitModeRound / closeExitModeRound）需 DEFAULT_ADMIN_ROLE

**结论：✅ 闭合**

---

### 模块 4 — Strategy 层与收益路径

- 架构：Vault → StrategyManagerV01 → Strategy（三层隔离）
- `transferToStrategyManager()` 需 DEFAULT_ADMIN_ROLE + `externalTransfersEnabled=true`，不自动触发
- 70% 硬上限：`(strategyAssets + amount) * BPS_DENOMINATOR > total * MAX_STRATEGY_DEPLOY_BPS → revert MaxDeployExceeded()`
- `reserveRatioBps` 初始为 10000（100% 留在 vault），管理员调低后才允许部署
- `rebalance()`：
  - reserve < 15%（RESERVE_FLOOR）：从 strategy 回撤至 30% 目标
  - reserve > 35%（RESERVE_CEILING）：emit `RebalanceNeedsReview`，不自动再投资
  - admin 须显式调 `transferToStrategyManager()` 完成再部署
- 储备三参数 15 / 30 / 35 与规范精确匹配；70% 上限独立存在
- `Phase4_StrategyBoundary.test.ts` 覆盖：70% 上限强制、单策略锁定、异常处理

**结论：✅ 闭合**

---

### 模块 5 — 锁仓、奖励、RWT 逻辑

- 锁仓对象：fbUSDC shares，不是 USDC
- 锁仓 share 持续参与 vault NAV/PPS 变化（LockLedger 持有份额）
- 管理费返现线性累积：早退已累计部分不退回，未来资格立即终止
- RWT 按仓位一次性预发；早退须全额返还 RWT，否则 revert
- `totalAssets()` / `pricePerShare()` 不含 RWT；RWT 不进 NAV
- commitment layer 与 base fund layer 逻辑分离，vault 不知晓 lock / tier / points
- `docs/ONE_PAGER.md` §"Why This Is Not Lock-Up Liquidity Mining" 叙事准确区分 vault yield（策略收益）与 RWT（commitment coordination）
- Beneficiary 模块：锁仓到期才可转移，不缩短 unlockAt，合规表述正确

**结论：✅ 闭合**

---

### 模块 6 — 管理权限、治理桥接与安全边界

**D1（PROPOSER_ROLE）：**
- `GovernanceSignalV02.createProposal()` 使用 `onlyRole(PROPOSER_ROLE)`（已修复，初始由 admin 持有，可委托）

**D2（Timelock）：**
- `ProtocolTimelockV02` 已部署，MIN_DELAY = 24h
- DEFAULT_ADMIN_ROLE 转给 Timelock，非紧急操作须排队执行
- EMERGENCY_ROLE 可绕过 Timelock 即时 Pause（只能 Pause，不能恢复）
- `setMode(Paused)` = EMERGENCY_ROLE 或 DEFAULT_ADMIN_ROLE 可调
- `setMode(Normal / EmergencyExit)` = DEFAULT_ADMIN_ROLE only
- `unpauseDeposits()` / `unpauseRedeems()` = DEFAULT_ADMIN_ROLE only

**UPGRADER_ROLE：** 定义为常量，V3 未 grant，FundVaultV01 非可升级合约，符合规范"升级权预留"原则

**治理桥接：** GovernanceSignalV02 vote weight 来自 lock tier，信号层只排序不执行；前端 COMPLIANCE §7 已明确声明"治理投票为信号层，不自动执行"

**前端权限披露（LimitationsPanel）：**
- multisig 持有 DEFAULT_ADMIN_ROLE
- EMERGENCY_ROLE 可绕过 Timelock 即时 Pause
- 24h Timelock 保护非紧急操作
- FundVaultV01 非可升级合约
- 治理投票仅信号层，不自动执行

**结论：✅ 闭合**

---

### 模块 7 — 合规边界与对外叙事风险

**Layer 1 allowlist：**
- `mapping(address => bool) public isAllowed` 已实现
- `_deposit` 检查 receiver，`addToAllowlist / removeFromAllowlist` 由 DEFAULT_ADMIN_ROLE 管理
- 移除白名单只阻止新存款，已有持仓可正常 redeem / claimExitAssets
- 14 项测试全通

**Layer 2（blacklist / IComplianceHook）：** D4 冻结决策，V4 范围，文档已预留接口

**RWA 叙事：** ONE_PAGER 和 PRODUCT_ARCHITECTURE 均明确第二策略为"未来合规接入方向"，V3 无 RWA 当前实现声明

**前端 COMPLIANCE §7 全覆盖（LimitationsPanel 新增红色边框卡片）：**

| 必要项 | 状态 |
|---|---|
| 本协议不保证资产增值或资本保全 | ✅ |
| 基础收益随市场利率波动，非固定 | ✅ |
| RWT 不计入 NAV，价格变化不构成基金收益 | ✅ |
| 本协议不是证券，不构成投资建议 | ✅ |
| 治理投票为信号层，不自动执行 | ✅ |

**越线表述检查：**

| 越线类型 | 结果 |
|---|---|
| "保收益" / "保本" | ✅ 未发现 |
| "绕过监管" | ✅ 未发现 |
| "随时无损退出" / "国债替代" | ✅ 未发现 |
| RWT 为收益来源 / 进入 NAV | ✅ 未发现 |
| RWA 作为 V3 当前实现 | ✅ 未发现 |
| "完全去中心化" | ✅ 未发现 |

**结论：✅ 闭合**

---

## 4. 跨阶段冲突清单

| 检查项 | 结论 |
|---|---|
| NAV / PPS 与 EmergencyExit / Exit Round 是否冲突 | ✅ 无冲突：`totalAssets()` 不含 RWT；EmergencyExit 下 PPS 仍可读，redeem 被合约层拦截 |
| 管理费在 Paused / EmergencyExit 口径是否前后一致 | ✅ Paused = 继续计提；EmergencyExit = 推进时钟不 mint（D2 frozen decision）|
| RWT 是否始终不进入 NAV | ✅ `totalAssets()` 定义无 RWT 组成部分，代码与叙事双重验证 |
| EMERGENCY_ROLE 是否只刹车不恢复 | ✅ 仅可调 `setMode(Paused)`；Normal / EmergencyExit 均需 DEFAULT_ADMIN_ROLE |
| unpause 是否始终是更重权限 | ✅ `unpauseDeposits()` / `unpauseRedeems()` 均 `onlyRole(DEFAULT_ADMIN_ROLE)` |
| EmergencyExit 是否自动封锁 redeem | ✅ `_withdraw()` 合约层检查，`revert UseClaimExitAssets()` |
| 15 / 30 / 35 与 70% 上限是否互相匹配 | ✅ 常量精确匹配规范；两者独立守卫，70% 为绝对上限 |
| rebalance 是否没有越权为自动再投资 | ✅ 超出上沿仅 emit `RebalanceNeedsReview`，不自动部署 |
| reviewedInvest 是否仍需要审核 | ✅ `transferToStrategyManager()` 需 DEFAULT_ADMIN_ROLE + `externalTransfersEnabled` |
| allowlist / blacklist 是否与正式面向用户版本匹配 | ✅ 邀请制 allowlist 实现；blacklist D4 推迟 V4；allowlist 仅控制入口，已有持仓可退出 |
| 文案是否避免越线表述 | ✅ 全文档、前端无越线表述 |
| RWA 叙事是否始终保持"未来合规接入"而不越位 | ✅ 全文档一致 |

**发现跨阶段冲突：零项。**

---

## 5. 尚未闭合的阻塞项

**Step1 范围内无任何阻塞项。**

以下为规范明确允许推迟的项目，不构成 Step1 阻塞：

| 项目 | 规范依据 | 计划阶段 |
|---|---|---|
| Layer 2 blacklist / IComplianceHook | D4 冻结决策 | V4 |
| 司法管辖区 gate（IJurisdictionGate） | D4 冻结决策 | V4 |
| 第二策略（USDY / RWA 债券暴露） | §4 预留上线条件 | V5+ |
| 完整 DAO 治理执行桥接 | §6 后续 DAO 构想 | V4+ |
| KYC / KYB 链上 hook | D4 冻结决策 | V4 |

---

## 6. 可进入下一步的前提条件

以下条件全部已满足：

1. ✅ 575 项测试全部通过，涵盖 accounting、exit round、allowlist、timelock、strategy boundary、safety mode、governance、beneficiary、metrics
2. ✅ 七个 Step1 模块逐条对照规范无未闭合项
3. ✅ EmergencyExit 用户路径在合约层和前端均已落地
4. ✅ Allowlist（Layer 1）在合约层和前端均已落地
5. ✅ 24h Timelock 已部署并测试
6. ✅ COMPLIANCE §7 风险声明在前端已落地
7. ✅ README / ONE_PAGER 对外叙事与 V3 实际状态一致
8. ✅ 无跨阶段会计 / 权限 / 叙事冲突

---

## 7. 最终总结论

**总复查结论：通过**

Step1 七个模块全部闭合，无跨阶段冲突，无未修复 P0 / P1 阻塞项，测试 575 / 575，文档与代码行为一致。

当前版本可以进入 **Step2（Base 主网 × 真实 USDC × Aave V3 最小闭环验证）**。
