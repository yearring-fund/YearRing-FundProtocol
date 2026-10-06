# docs/PERMISSIONS_AND_GOVERNANCE_BRIDGE_V3.md — FinancialBase V3 权限与治理桥接规范

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D3 | Timelock 延迟 = 24 小时，覆盖所有 DEFAULT_ADMIN_ROLE 操作 | 已冻结 |
| D6 | EMERGENCY_ROLE 只能暂停；恢复 Normal 只能由 Admin 经 timelock | 已冻结 |
| D_GOV_1 | UPGRADER_ROLE 只能升级 strategy 合约；核心 vault 不可升级 | 已冻结 |
| D_GOV_2 | 治理桥接（GovernanceSignalV02）为信号投票，不执行任何链上操作 | 已冻结 |
| D_GOV_3 | V3 初版非完全 DAO；Admin/multisig 权限明确存在 | 已冻结 |

---

## 1. 四角色定义

### 1.1 角色标识符

| 角色名称 | bytes32 常量 | 持有者 |
|----------|------------|--------|
| `EMERGENCY_ROLE` | `keccak256("EMERGENCY_ROLE")` | 专属紧急响应地址（可为独立 EOA 或 multisig 的子角色） |
| `UPGRADER_ROLE` | `keccak256("UPGRADER_ROLE")` | multisig（与 DEFAULT_ADMIN 共享或独立） |
| `PROPOSER_ROLE` | `keccak256("PROPOSER_ROLE")` | 治理提案创建者（可为 DEFAULT_ADMIN 或独立地址） |
| `DEFAULT_ADMIN_ROLE` | `0x00` (OZ 默认) | multisig（通过 TimelockController 操作） |

---

## 2. EMERGENCY_ROLE

### 2.1 可以做什么

| 操作 | 函数 | 说明 |
|------|------|------|
| 暂停 vault 存款 | `vault.pauseDeposits()` | 阻断新存款 |
| 暂停 vault 赎回 | `vault.pauseRedeems()` | 阻断常规赎回（谨慎使用） |
| 将 vault 切换到 Paused 状态 | `vault.setMode(Paused)` | 阻断 invest() |
| 将 vault 切换到 EmergencyExit 状态 | `vault.setMode(EmergencyExit)` | 进入紧急退出模式 |
| 触发 strategy emergencyExit | `strategyManager.emergencyExit()` | 将资金从 Aave 撤回到 vault |
| 暂停 LockRewardManager | `lockRewardManager.pause()` | 阻断新建锁仓和返现领取 |
| 暂停 LockLedger | `ledger.pause()` | 阻断锁仓操作 |

### 2.2 绝对不能做什么

| 禁止操作 | 原因 |
|----------|------|
| 修改管理费率（`setMgmtFeeBps`） | 参数操作，须经 Timelock |
| 修改储备比例常量 | 参数操作，须经 Timelock |
| 切换 strategy 合约地址 | 参数操作，须经 Timelock |
| 将 vault 从 Paused / EmergencyExit 恢复为 Normal | 恢复操作须 Admin 经 Timelock 审核后才能执行 |
| 铸造 shares（adminMintShares） | 严格禁止（任何角色均不得执行） |
| 销毁用户 shares（adminBurnUserShares） | 严格禁止（任何角色均不得执行） |
| 修改任意用户余额 | 严格禁止（任何角色均不得执行） |
| 触发 emergencyExit 资金流向非 vault 地址 | emergencyExit 只能归还到 vault |

### 2.3 EMERGENCY_ROLE 的设计约束

- EMERGENCY_ROLE 是**"刹车"角色**，只能停止系统，不能重新配置系统
- 暂停是单向操作：EMERGENCY_ROLE 可以 pause，但不能 unpause
- 解除暂停（unpause）须由 `DEFAULT_ADMIN_ROLE` 通过 24 小时 Timelock 执行，确保有充足的评估时间

---

## 3. UPGRADER_ROLE

### 3.1 可以做什么

| 操作 | 说明 |
|------|------|
| 升级 strategy 合约（AaveV3StrategyV01） | 替换 strategy 实现，须通过 UUPS upgradeToAndCall 或 Transparent Proxy |
| 升级 strategyManager（若为 proxy） | 可升级 strategy 层非核心合约 |

### 3.2 绝对不能做什么

| 禁止操作 | 原因 |
|----------|------|
| 升级核心 vault（FundVaultV01） | 核心 vault 为不可升级合约（non-upgradeable），V3 设计决策 |
| 升级 LockLedger | 属于用户资产托管合约，不可升级 |
| 升级 RewardToken | 固定供应代币，不可升级 |

### 3.3 核心 vault 不可升级说明

- `FundVaultV01` 部署为标准非代理合约，无 `_authorizeUpgrade` 函数
- 此为 V3 安全设计决策：降低升级风险，用户资产存储在不可被 admin 单方面重写逻辑的合约中
- strategy 合约允许升级（可能需要接入新协议版本），但须通过 UPGRADER_ROLE 授权

---

## 4. PROPOSER_ROLE

### 4.1 可以做什么

| 操作 | 函数 | 说明 |
|------|------|------|
| 创建治理提案 | `GovernanceSignalV02.createProposal()` | 发起信号投票 |

### 4.2 绝对不能做什么

| 禁止操作 | 原因 |
|----------|------|
| 执行任何链上协议操作 | 治理桥接为信号层，PROPOSER_ROLE 无执行权 |
| 强制执行提案结果 | V3 治理结果为信号，不自动执行 |
| 修改投票权重 | 投票权重由 RWT 快照决定，不可人工修改 |

---

## 5. DEFAULT_ADMIN_ROLE

### 5.1 可以做什么（须经 24 小时 Timelock）

| 操作 | 函数 | 延迟 |
|------|------|------|
| 修改管理费率 | `vault.setMgmtFeeBps(newBps)` | 24h |
| 切换 strategy 合约 | `vault.setStrategyManager(newSM)` | 24h |
| 修改可投资比例配置（若可配置） | `vault.setReserveParams(...)` | 24h |
| 将 vault 从 Paused 恢复为 Normal | `vault.setMode(Normal)` | 24h |
| 开启 / 关闭 Exit Round | `vault.openExitRound()` / `vault.closeExitRound()` | 24h |
| 为角色增减成员 | `grantRole / revokeRole` | 24h（通过 Timelock） |
| 授权 UPGRADER_ROLE 执行升级 | - | 24h |

### 5.2 绝对不能做什么

| 禁止操作 | 原因 |
|----------|------|
| 手写 NAV（setTotalAssets / setPps） | 严格禁止，见 ACCOUNTING_AND_NAV_RULES_V3.md |
| 铸造 / 销毁用户 shares | 严格禁止 |
| 直接（无 Timelock）修改核心参数 | 须经 24h Timelock |

---

## 6. Timelock（TimelockController）

### 6.1 参数

| 参数 | 值 |
|------|----|
| 最小延迟（minDelay） | 24 小时（86400 秒） |
| 提案者（proposers） | multisig 地址 |
| 执行者（executors） | multisig 地址 |
| 取消者（cancellers） | multisig 地址 |

### 6.2 Timelock 覆盖范围

所有 `DEFAULT_ADMIN_ROLE` 受保护的操作均须通过 TimelockController 执行，流程：

```
1. multisig 调用 timelock.schedule(target, value, data, predecessor, salt, delay=86400)
2. 等待 24 小时
3. multisig 调用 timelock.execute(target, value, data, predecessor, salt)
```

- 紧急操作（EMERGENCY_ROLE）不经过 Timelock，可立即执行
- 非紧急操作（参数修改、恢复、升级授权）必须经过 Timelock

---

## 7. 治理桥接（GovernanceSignalV02）

### 7.1 设计定位

- **信号投票，不执行**：治理结果为参考信号，不触发任何链上参数修改
- **排序功能**：按 `forVotes > againstVotes` 显示提案通过/未通过信号，按票数展示优先级
- **无执行路径**：`GovernanceSignalV02` 合约不持有任何协议角色，无 `DEFAULT_ADMIN_ROLE` 或 `EMERGENCY_ROLE`

### 7.2 投票权重

| 机制 | 说明 |
|------|------|
| 投票代币 | RWT（RewardToken） |
| 权重计算 | `rewardToken.balanceOfAt(voter, snapshotId)` |
| 快照时机 | 提案创建时调用 `rewardToken.snapshot()` |
| 防双投 | 快照机制防止同一 RWT 在提案期间被转移后重复投票 |

### 7.3 提案生命周期

```
PROPOSER_ROLE 调用 createProposal(description, duration)
  → 触发 rewardToken.snapshot() 记录快照 ID
  → 提案进入投票期

RWT 持有者调用 castVote(proposalId, support)
  → 按快照余额计算票权

投票期结束后 → resultOf(proposalId) 返回信号结果（passed/rejected）
  → 结果仅为参考，不自动执行任何操作
```

### 7.4 明确声明

- V3 初版的治理为**信号层治理**，不是 DAO 执行层治理
- 提案结果须经 multisig/Admin 人工审核后，通过 Timelock 路径执行
- 前端必须标注："治理投票为信号投票，结果不自动执行"

---

## 8. V3 初版非完全 DAO 声明

以下管理权限在 V3 初版中明确存在，属于公开透明信息：

| 权限 | 存在形式 |
|------|---------|
| Admin 参数控制权 | multisig + 24h Timelock |
| 紧急暂停权 | EMERGENCY_ROLE |
| strategy 升级权 | UPGRADER_ROLE |
| 治理提案创建权 | PROPOSER_ROLE |

**V3 不是，也不声称是完全去中心化自治组织（DAO）。** 上述权限的存在是为了在初版运行阶段提供必要的风险管理能力。后续版本将逐步向更去中心化的方向演进。

前端和所有用户文档中**必须明确展示**上述权限的存在，不得隐藏。

---

## 9. 角色权限矩阵汇总

| 操作 | EMERGENCY_ROLE | UPGRADER_ROLE | PROPOSER_ROLE | DEFAULT_ADMIN（经 Timelock） |
|------|:--------------:|:-------------:|:-------------:|:--------------------------:|
| 暂停存款/赎回 | ✅ | ❌ | ❌ | ✅（经 Timelock） |
| 进入 EmergencyExit | ✅ | ❌ | ❌ | ✅（经 Timelock） |
| 恢复 Normal | ❌ | ❌ | ❌ | ✅（经 Timelock，24h） |
| 修改管理费率 | ❌ | ❌ | ❌ | ✅（经 Timelock，24h） |
| 切换 strategy | ❌ | ❌ | ❌ | ✅（经 Timelock，24h） |
| 升级 strategy 合约 | ❌ | ✅ | ❌ | ❌ |
| 升级 vault | ❌ | ❌ | ❌ | ❌（vault 不可升级） |
| 创建治理提案 | ❌ | ❌ | ✅ | ✅ |
| strategy emergencyExit | ✅ | ❌ | ❌ | ✅ |
| mint/burn 用户 shares | ❌ | ❌ | ❌ | ❌（严格禁止） |
| 手写 NAV | ❌ | ❌ | ❌ | ❌（严格禁止） |
