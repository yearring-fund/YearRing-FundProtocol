# Phase 6 验收报告 — 前端一致性

状态：**不通过**

验收时间：2026-04-02

关联命令：`step1p6check.md`

对照规范：`fd/STEP1_FINALIZED_SPEC_CN.md §7`、`docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3`

---

## 1. 本阶段验收结论摘要

前端管理员侧（AdminConsole）系统模式展示基本正确，但用户侧存在两个关键功能缺口：

| 缺口 | 严重级别 |
| --- | --- |
| VaultSection 的 Redeem 按钮在 EmergencyExit 模式下未禁用 | **P0** |
| 无用户侧 claimExitAssets 入口 — EmergencyExit 下用户无法操作 | **P0** |
| 储备 band 状态（15%/30%/35%）未展示 | P1 |
| Deposit 按钮未检查 allowlist 状态（Phase 5 patch 后产生） | P1 |
| AdminConsole pause 说明文案与实际权限不符 | P2 |
| LimitationsPanel 版本标签仍显示 "V2" | P3 |
| `FundVault_ABI` 含不存在的 `GUARDIAN_ROLE` 条目 | P2 |

---

## 2. 本阶段目标对照表

| 验收目标 | 规范要求 | 实现状态 | 结论 |
| --- | --- | --- | --- |
| Normal/Paused/EmergencyExit 状态显示 | 明确展示三种状态之一 | AdminConsole 展示 ✅；VaultSection 不读 systemMode ❌ | ⚠️ 管理员侧可见，用户侧不可见 |
| Reserve band 状态显示 | 15%/30%/35% 参考线 + 状态标签 | 完全缺失 | ❌ |
| Redeem 在 EmergencyExit 中禁用 | EmergencyExit 下 Redeem 不可点 | VaultSection 不检查 systemMode，按钮常驻可用 | ❌ |
| claimExitAssets 为唯一异常退出路径 | EmergencyExit 下显示 claimExitAssets 路径 | 无用户侧 claimExitAssets UI | ❌ |
| 权限风险明示 | admin/multisig/timelock 声明 | LimitationsPanel 未覆盖；AdminConsole note 不完整 | ❌ |
| allowlist/restricted 状态反馈 | 用户可知自己是否在白名单 | 无 isAllowed 读取，无提示 | ❌ |
| 各按钮在不同状态下可用性正确 | 状态驱动按钮 disable/enable | VaultSection 状态驱动缺失 | ❌ |

---

## 3. 实际改动文件清单

**Phase 6 验收阶段无代码改动，以下均为现状审查。**

| 文件 | 类型 | Phase 6 相关内容 | 状态 |
| --- | --- | --- | --- |
| `frontend/src/components/VaultSection.tsx` | 核心用户 UI | Deposit/Redeem 操作入口；不读 systemMode/isAllowed | ❌ 多项缺口 |
| `frontend/src/components/AdminConsole.tsx` | 管理员 UI | 系统模式显示 + Exit Round 管理；Pause note 文案有误 | ⚠️ 基本可用，文案需修正 |
| `frontend/src/components/StrategySection.tsx` | 策略信息 | Strategy paused + systemMode badge 展示 | ✅ |
| `frontend/src/components/MetricsBar.tsx` | 全局指标栏 | TVL / PPS / LockedRatio；无 reserve band | ⚠️ 缺 reserve band |
| `frontend/src/components/StateSection.tsx` | 用户状态 | 锁仓状态展示；不涉及系统模式 | ✅ 范围内 |
| `frontend/src/components/LimitationsPanel.tsx` | 风险说明 | 版本标签仍写"V2 Testnet Demo" | ❌ 文案错误 |
| `frontend/src/contracts/abis.ts` | ABI 定义 | 含不存在的 `GUARDIAN_ROLE` 条目 | ❌ 过期条目 |

---

## 4. 与 Step1 定稿规范的逐条一致性检查

### §4.1 系统模式展示

**AdminConsole（管理员）：**

```tsx
// AdminConsole.tsx:108-109 — 正确
const modeLabelText  = currentMode !== undefined ? (MODE_LABELS[currentMode] ?? '–') : '–'
const modeBadgeClass = currentMode !== undefined ? (MODE_BADGE_CLASSES[currentMode] ?? 'badge-gray') : 'badge-gray'
```

颜色码：Normal=green、Paused=yellow、EmergencyExit=red ✅

**VaultSection（用户）：**

- `systemMode` 完全未读取
- Deposit / Redeem 按钮对系统模式无感知

**结论：❌ 用户侧不展示系统状态**

---

### §4.2 Redeem 在 EmergencyExit 下的禁用

**规范（COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3.2）：**

> EmergencyExit 下的赎回：展示 "退出申领：进行中（Exit Round）" 替代常规赎回状态

**实际代码（VaultSection.tsx:152-155）：**

```tsx
<button className="btn-secondary"
  disabled={busy || !address || !configOk || !redeemAmt}
  onClick={redeem}>
  Redeem
</button>
```

- `systemMode` 不在 disabled 条件中
- EmergencyExit 下点击 Redeem → 合约 revert `UseClaimExitAssets()` → 前端显示通用错误
- 用户不知道应该用 claimExitAssets，无任何引导

**结论：❌ P0 — Redeem 未在 EmergencyExit 下禁用，且无替代路径引导**

---

### §4.3 claimExitAssets / Exit Round 用户路径

**AdminConsole（管理员）：** Exit Round Management 卡片在 `currentMode === 2` 时显示，有 Open/Close Round 按钮 ✅（管理员操作）

**用户侧：** 遍历所有组件 — `VaultSection`、`LockSection`、`IncentiveSection`、`StateSection`、`BeneficiarySection`、`StrategySection`、`YieldSection`、`FeeRulesSection`、`RwtRulesSection`、`DaoBridgeSection`、`DemoStateSection` — 均无 `claimExitAssets` 调用。

**结论：❌ P0 — EmergencyExit 场景下用户无任何操作路径**

---

### §4.4 Reserve Band 展示

**规范（COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3.4）：**

| 要求 | 状态 |
| --- | --- |
| 当前储备率（%） | ❌ 未展示 |
| 区间标签（在目标区间 / 低于下沿 / 高于上沿） | ❌ 未展示 |
| 15% / 30% / 35% 三条参考线 | ❌ 未展示 |
| 不得展示 vault USDC 绝对余额作为"可赎回金额" | ✅ 合规 |

注意：MetricsBar 的 "Locked Ratio" 是锁仓比率（lockedShares/totalSupply），**不是储备比率**，两者完全不同，不可混用。

**结论：❌ P1 — Reserve band 状态完全缺失**

---

### §4.5 Allowlist 状态反馈（Phase 5 patch 后新增）

VaultSection 的 Deposit 按钮不检查 `isAllowed[address]`：

- 非白名单用户点击 Deposit → 合约 revert `NotAllowed()` → 前端显示通用错误
- 无法向用户说明"需要先申请加入白名单"

**结论：❌ P1 — 无 allowlist 状态读取和友好提示**

---

### §4.6 权限风险明示

**规范（COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3.3）：** 前端显眼位置须披露 multisig / timelock / EMERGENCY_ROLE / 升级权存在。

- `LimitationsPanel` 有"Admin actions not fully exposed"等说明，但未覆盖 multisig/timelock 结构
- 无专门的权限风险披露区域

**结论：❌ P1 — 权限风险披露不完整**

---

### §4.7 ABI 过期条目

`frontend/src/contracts/abis.ts:27`：

```ts
{ name: 'GUARDIAN_ROLE', type: 'function', ... }
```

`FundVaultV01` 合约中不存在 `GUARDIAN_ROLE`（合约只有 `EMERGENCY_ROLE`、`UPGRADER_ROLE`、`PROPOSER_ROLE`）。此条目是遗留过期 ABI，不会触发 runtime 错误，但会误导审计。

**结论：❌ P2 — 过期 ABI 条目**

---

### §4.8 AdminConsole Pause 文案错误

```tsx
// AdminConsole.tsx:162-164 — 不准确
<p className="note">
  Pause and Unpause both require DEFAULT_ADMIN_ROLE.
</p>
```

实际权限：Pause 可由 `EMERGENCY_ROLE` 或 `DEFAULT_ADMIN_ROLE` 执行；Unpause 仅 `DEFAULT_ADMIN_ROLE`。

**结论：❌ P2 — 文案与合约权限不符**

---

## 5. 前端状态与合约状态映射表

### 各按钮在不同 systemMode 下的可用性矩阵

| 按钮 | Normal | Paused | EmergencyExit | 规范要求 | 当前实现 |
| --- | :---: | :---: | :---: | --- | --- |
| Deposit | ✅ | 应禁用 | 应禁用 | 仅 Normal + allowlisted 可用 | 始终可点 ❌ |
| Redeem | ✅ | ✅ | 应禁用 | EmergencyExit 时禁用并引导 claimExitAssets | 始终可点 ❌ |
| claimExitAssets | 不展示 | 不展示 | 应展示 | EmergencyExit 时为主要退出入口 | 完全不存在 ❌ |
| Mint MockUSDC | ✅ | ✅ | ✅ | 无需限制（testnet 工具） | 正确 ✅ |
| Admin: setMode | ✅ | ✅ | ✅ | 当前模式按钮 disabled | 正确 ✅ |
| Admin: Open/Close Round | 不展示 | 不展示 | ✅ | EmergencyExit 时展示 | 正确 ✅ |

---

## 6. 关键逻辑自查

### 用户视角路径审查

**正常存款路径（Normal + allowlisted）：**

```
用户 → Deposit 按钮 → approve USDC → deposit()
→ 合约成功 ✅
→ 但用户不知道自己是否在白名单（无前端提示）
```

**非白名单用户存款尝试：**

```
非白名单用户 → Deposit → 合约 revert NotAllowed()
→ 前端显示通用错误文案（shortErr）
→ 用户不知道原因是"未在白名单" ❌
```

**EmergencyExit 下普通用户（当前实际）：**

```
用户进入 → 看到 Redeem 按钮（未禁用）→ 点击 Redeem
→ 合约 revert UseClaimExitAssets()
→ 前端显示错误
→ 用户不知道应该用 claimExitAssets
→ 没有 claimExitAssets 按钮 ❌
```

**正确的 EmergencyExit 路径（规范要求，前端不存在）：**

```
EmergencyExit 状态检测
→ 隐藏/禁用 Redeem 按钮
→ 显示 "Exit Round 进行中" 提示
→ 展示用户份额快照 + 可申领金额
→ claimExitAssets(roundId, sharesToBurn) 按钮
```

---

## 7. 未完成项与遗留风险

| 编号 | 类型 | 描述 | 级别 |
| --- | --- | --- | --- |
| **F1** | **必修项** | VaultSection 读取 `systemMode`，Redeem 在 EmergencyExit 时禁用 | **P0** |
| **F2** | **必修项** | 新增用户侧 claimExitAssets 入口（EmergencyExit 模式下展示） | **P0** |
| **F3** | 必修项 | VaultSection 读取 `isAllowed[address]`，Deposit 按钮联动（未 allowlisted → 禁用 + 提示） | P1 |
| **F4** | 必修项 | MetricsBar 或 StrategySection 补充 reserve band 展示（储备率 % + 15/30/35 标签） | P1 |
| **F5** | 文案修正 | AdminConsole Pause note 修正为"Pause 可由 EMERGENCY_ROLE 或 DEFAULT_ADMIN 执行，Unpause 仅 DEFAULT_ADMIN" | P2 |
| **F6** | 文案修正 | LimitationsPanel 版本标签改为"V3" | P3 |
| **F7** | ABI 清理 | `FundVault_ABI` 移除不存在的 `GUARDIAN_ROLE` 条目 | P2 |
| **F8** | 必修项 | LimitationsPanel 或新增 DisclosurePanel 添加权限风险声明（multisig/timelock/EMERGENCY_ROLE） | P1 |

---

## 8. 是否建议进入下一阶段

**不建议。需先完成 Phase 6 patch1。**

F1 和 F2 是同一 EmergencyExit 场景的两面，修复范围明确：

1. `frontend/src/components/VaultSection.tsx`
   - 读取 `systemMode`
   - Redeem 在 EmergencyExit 时 disabled + 展示替代提示
   - EmergencyExit 下显示 claimExitAssets 区块

2. `frontend/src/contracts/abis.ts`
   - 移除 `GUARDIAN_ROLE` 过期条目

F3/F4/F5/F8 可在 patch1 中一并处理或作为 patch2，不阻塞核心路径验收。

---

## 9. 最终验收结论

**Phase 6：不通过**

```
❌ 不通过原因（F1, F2）：
  - EmergencyExit 下 Redeem 按钮未禁用，无引导路径
  - 无用户侧 claimExitAssets UI — EmergencyExit 场景用户完全无法操作

❌ 必须在 patch1 修正（F3, F4, F5, F8）：
  - Deposit 无 allowlist 状态感知
  - 无 reserve band 展示（COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §3.4 要求）
  - AdminConsole Pause 权限文案错误
  - 权限风险声明不完整

⚠️ 次要待修正（F6, F7）：
  - LimitationsPanel 版本标签 "V2" → "V3"
  - FundVault_ABI 含不存在的 GUARDIAN_ROLE 条目

✅ 通过项：
  - AdminConsole 系统模式 badge + 颜色码正确
  - AdminConsole Exit Round 管理仅在 EmergencyExit 模式显示
  - StrategySection strategy paused 状态正确展示
  - MetricsBar TVL / PPS / LockedRatio 正确读取
  - ABI exitRounds 含 snapshotTimestamp（Phase 2 patch 已更新）
  - ABI claimExitAssets 条目正确
```
