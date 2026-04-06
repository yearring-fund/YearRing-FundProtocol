# Phase 7 验收报告 — 文档与叙事一致性

状态：**不通过**

验收时间：2026-04-02

关联命令：`step1p7check.md`

对照规范：`fd/STEP1_FINALIZED_SPEC_CN.md §1`、`docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3/§4/§7`、`docs/PRODUCT_POSITIONING_V3.md §3/§4`

---

## 1. 本阶段验收结论摘要

| 类型 | 问题 | 级别 |
|------|------|------|
| ONE_PAGER.md 描述 V2 为当前状态，V3 已上线但文档未更新 | **叙事严重失真** | **P0** |
| README.md 标题显示 "V2 testnet demo build" | 版本标签错误 | **P0** |
| 前端缺少 COMPLIANCE §7 全量风险声明（非保本/RWT不计NAV/非证券） | 合规披露缺口 | **P1** |
| ONE_PAGER 锁仓期限 "30–365 days"，实际 UI 档位为 30/90/180 天 | 叙事不一致 | P2 |
| ONE_PAGER 测试计数 "160+" 已过期（现为 575+） | 事实过期 | P2 |

---

## 2. 本阶段目标对照表

| 验收目标 | 规范要求 | 实现状态 | 结论 |
|----------|----------|----------|------|
| fund-style system 表述统一 | 链上基金式资产管理，非存款/保本 | README/ONE_PAGER 表述方向正确，无越线 | ✅ |
| 非保本、非固定收益明确 | 前端必须有明确声明 | spec/positioning 文档有，前端 LimitationsPanel 无 | ❌ |
| RWT = commitment layer | 不得称 RWT 为收益来源 | ONE_PAGER §"Why Not Lock-Up Mining" 表述准确 | ✅ |
| EmergencyExit/Exit Round 表述一致 | 有序退出路径，非即时赎回 | spec 文档正确；README/ONE_PAGER 未提及（可接受） | ⚠️ |
| RWA 仅为未来方向 | 不得声称 V3 实现 RWA | 无 RWA-as-current 表述；PRODUCT_POSITIONING §3.3 明确为预留 | ✅ |
| 无越线表述 | 无"保收益""绕过监管""随时无损退出" | 全部文档未发现越线表述 | ✅ |
| 管理员/多签/治理风险明示 | 前端显眼位置明示 | Phase 6 Patch2 已在 LimitationsPanel 覆盖权限层 | ✅ |
| 版本标签一致 | V3 | README 显示 V2；ONE_PAGER 全文描述 V2 状态 | ❌ |

---

## 3. 实际改动文件清单

**本阶段为纯审查阶段，无代码改动。**

| 文件 | 类型 | Phase 7 相关内容 | 状态 |
|------|------|-----------------|------|
| `README.md` | 项目入口文档 | 标题含 "V2 testnet demo build"；无风险声明 | ❌ 需修正 |
| `docs/ONE_PAGER.md` | pitch / narrative | V2 作为当前状态描述；测试数 160+ 过期；Next Milestone 全部失效 | ❌ 严重过期 |
| `docs/PRODUCT_POSITIONING_V3.md` | 规范文档 | 产品定位正确、已冻结 | ✅ |
| `docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md` | 规范文档 | §7 风险声明模板未在前端落地 | ⚠️ |
| `docs/PERMISSIONS_AND_GOVERNANCE_BRIDGE_V3.md` | 规范文档 | 角色权限定义正确 | ✅ |
| `frontend/src/components/LimitationsPanel.tsx` | 前端风险披露 | 已覆盖治理/权限层；缺 §7 非保本/RWT/非证券声明 | ⚠️ 不完整 |
| `docs/PRODUCT_ARCHITECTURE.md` | 架构文档 | 含 "30–365 day lock" 表述（与 UI 实际档位不一致） | ⚠️ 需说明 |

---

## 4. 与 Step1 定稿规范的逐条一致性检查

### §4.1 版本标签一致性

**README.md 第 1 行：**

```md
An on-chain asset management protocol with a structured commitment incentive layer
— application-version V2 testnet demo build.
```

V3 已完成并部署；README 头部标签仍为 V2。**结论：❌ P0**

**ONE_PAGER.md §Current Build Status（第 55–66 行）：**

```md
V2 is feature-complete on local (Hardhat). Testnet deployment is the next milestone,
not yet completed. ... Test coverage: 160+ tests passing across all modules.
```

事实：V3 已在 Base Sepolia 部署，测试 575 通过，前端已上线。ONE_PAGER 的"现状描述"与实际相差整个 V2→V3 迁移周期。

**ONE_PAGER.md §Next Milestone（第 122–127 行）：**

```md
1. Testnet deployment (Base Sepolia) with real USDC mock
2. Connect live Aave V3 strategy on Base for real yield demonstration
3. Frontend dashboard consuming MetricsLayerV02 snapshot JSON
4. Token design finalization
```

以上 4 条在 V3 均已完成（或已明确超出范围）。**结论：❌ P0 — pitch 文档严重失实**

---

### §4.2 风险披露完整性

**COMPLIANCE §7 要求的前端风险声明模板（必须包含）：**

| 必要项 | 前端现状 |
|--------|---------|
| "本协议不保证资产增值或资本保全" | ❌ 缺失 |
| "基础收益随市场利率波动" | ❌ 缺失 |
| "RWT 不计入 NAV，价格变化不构成基金收益" | ❌ 缺失 |
| "本协议不是证券，不构成投资建议" | ❌ 缺失 |
| "multisig + 24h Timelock 管理协议参数" | ✅（LimitationsPanel 已覆盖） |
| "EMERGENCY_ROLE 可绕过 Timelock 即时暂停" | ✅（LimitationsPanel 已覆盖） |
| "治理投票为信号层，不自动执行" | ❌ 缺失（无治理前端段落） |

**结论：❌ P1 — COMPLIANCE §7 模板有 4 项未落地到前端**

---

### §4.3 RWT 叙事

ONE_PAGER §"Why This Is Not Lock-Up Liquidity Mining" 明确区分了 vault yield（策略收益）与 RWT（commitment coordination），符合 COMPLIANCE §4.3 要求。

```md
"Vault yield is independent of the token."
"The commitment mechanism, however, does depend on the token."
```

**结论：✅ 表述准确，无 "RWT 价格上涨是收益" 等越线声明**

---

### §4.4 锁仓期限叙事不一致

| 文档 | 期限表述 |
|------|---------|
| README.md | "30–180 days" ✅（与 UI 档位 Bronze/Silver/Gold 一致） |
| LimitationsPanel.tsx | "30–180 days" ✅ |
| ONE_PAGER.md（3 处） | "30–365 days" ⚠️ |
| PRODUCT_ARCHITECTURE.md | "30–365 day lock" ⚠️ |

合约常量：`MIN_LOCK_DURATION = 30 days`，`MAX_LOCK_DURATION = 365 days`（协议允许范围），但 UI 仅暴露 30/90/180 三档。

"30–365" 描述的是协议原始范围，"30–180" 描述的是当前 UI 可选范围。两种表述在逻辑上不矛盾，但在 pitch 文档和 README 中混用会造成受众混淆。ONE_PAGER 和 PRODUCT_ARCHITECTURE 未说明 UI 只暴露三个档位这一重要前提。

**结论：⚠️ P2 — 叙事口径不一致，需在相关文档中统一说明**

---

### §4.5 越线表述检查

| 越线类型 | 检查范围 | 结论 |
|----------|---------|------|
| "保收益""保本" | README / ONE_PAGER / docs / 前端 | ✅ 未发现 |
| "绕过监管" | 同上 | ✅ 未发现 |
| "类国债替代 + 随时无损退出" | 同上 | ✅ 未发现 |
| "完全去中心化" | 同上 | ✅ 未发现（ONE_PAGER 无此声明） |
| RWA 作为 V3 当前实现 | 同上 | ✅ 未发现（ONE_PAGER 无 RWA 声明） |
| "无条件即时赎回" | 同上 | ✅ 未发现 |

---

### §4.6 PERMISSIONS / 治理桥接叙事

`PERMISSIONS_AND_GOVERNANCE_BRIDGE_V3.md` 内容完整准确，正确定义了 4 个角色边界与 Timelock 覆盖范围。

前端 LimitationsPanel 覆盖了 multisig / EMERGENCY_ROLE / 24h Timelock，但未覆盖：
- COMPLIANCE §3.5 要求的治理信号层声明（"治理投票为信号，结果不自动执行"）

**结论：⚠️ 治理桥接声明落地不完整**

---

## 5. 关键逻辑自查

### 叙事与代码行为对照

| 叙事声明 | 代码实现 | 一致性 |
|----------|---------|--------|
| "100% reserve ERC4626 vault" | `FundVaultV01` + `reserveRatioBps=10_000` 初始 | ✅ |
| "EmergencyExit → claimExitAssets 有序退出" | VaultSection + `claimExitAssets` UI 已实现 | ✅ |
| "Deposit allowlist（邀请制）" | `isAllowed[receiver]` 检查 + 前端显示 | ✅ |
| "RWT 不计入 NAV" | `totalAssets()` 不包含 RWT；PPS 计算不受 RWT 影响 | ✅ |
| "24h Timelock 保护非紧急操作" | `ProtocolTimelockV02` 已部署并测试 | ✅ |
| "EMERGENCY_ROLE 只能暂停，不能恢复 Normal" | `setMode(Normal)` 需 DEFAULT_ADMIN_ROLE 权限 | ✅ |

---

## 6. 测试覆盖检查

Phase 7 验收为文档/叙事层，无新增测试要求。已知测试状态：575/575 通过（Phase 5 patch1 后）。

---

## 7. 未完成项与遗留风险

| 编号 | 类型 | 描述 | 级别 |
|------|------|------|------|
| **N1** | **必修项** | README.md 标题 "V2 testnet demo build" → "V3" | **P0** |
| **N2** | **必修项** | ONE_PAGER.md §Current Build Status 描述 V2 为当前状态 → 更新为 V3 实际情况 | **P0** |
| **N3** | **必修项** | ONE_PAGER.md §Next Milestone 全部失效 → 改写为 V3 已完成 / V4 路线图 | **P0** |
| **N4** | 必修项 | 前端缺少 COMPLIANCE §7 风险声明（非保本/RWT不计NAV/非证券/治理信号说明） | P1 |
| **N5** | 文案修正 | ONE_PAGER 测试计数 "160+" → 更新为实际数字 | P2 |
| **N6** | 文案修正 | ONE_PAGER / PRODUCT_ARCHITECTURE "30–365 days" → 补充说明"UI 当前档位 30/90/180，协议允许范围 30–365" | P2 |

---

## 8. 是否建议进入下一阶段

**不建议。** N1/N2/N3（P0）和 N4（P1）是当前阻塞项：

- ONE_PAGER 是面向外部的首要 pitch 文档。当前内容描述 V2 为现状、testnet 为未来目标，与实际严重不符，存在对外叙事风险。
- 前端 COMPLIANCE §7 风险声明缺口与合规边界直接相关。

修复范围明确：
1. `docs/ONE_PAGER.md`：更新 §Current Build Status → V3 已部署、更新测试计数、改写 §Next Milestone 为 V4 路线
2. `README.md`：第 1 行版本标签 V2 → V3
3. `frontend/src/components/LimitationsPanel.tsx`：新增风险声明区块覆盖 §7 模板

---

## 9. 最终验收结论

**Phase 7：不通过**

```
❌ 不通过原因（N1, N2, N3）：
  - README.md 标题仍为 "V2 testnet demo build"
  - ONE_PAGER.md 以 V2 为当前状态，testnet 为待完成里程碑，与 V3 实际上线状态严重不符
  - ONE_PAGER.md §Next Milestone 全部失效

❌ 必须在 patch 修正（N4）：
  - 前端 LimitationsPanel 缺少 COMPLIANCE §7 风险声明：
    非保本、非固定收益、RWT 不计 NAV、非证券/非投资建议、治理信号说明

⚠️ 次要待修正（N5, N6）：
  - ONE_PAGER 测试计数 "160+" 已过期
  - 锁仓期限表述 30-365 / 30-180 混用，未做区分说明

✅ 通过项：
  - 无任何越线表述（无"保收益""随时无损退出""绕过监管""国债替代"）
  - RWT 一致表述为 commitment layer，非 NAV 来源
  - RWA 仅出现在未来路线图，V3 无 RWA 当前实现声明
  - PRODUCT_POSITIONING_V3.md / COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md /
    PERMISSIONS_AND_GOVERNANCE_BRIDGE_V3.md 内容正确一致
  - LimitationsPanel 权限风险披露（governance/multisig/EMERGENCY_ROLE/timelock）已覆盖
```
