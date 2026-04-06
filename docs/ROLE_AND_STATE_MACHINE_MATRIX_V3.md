# docs/ROLE_AND_STATE_MACHINE_MATRIX_V3.md — 角色与状态机矩阵

**版本：** V3 初版
**文档状态：** 已冻结（Phase 2 产出）
**最后更新：** 2026-04-01

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| P2-D1 | EMERGENCY_ROLE 只能"刹车"（设置 Paused 模式、暂停存款/赎回），不能重设用户余额 | 已冻结 |
| P2-D2 | DEFAULT_ADMIN_ROLE 在生产中须经 24h Timelock；EMERGENCY_ROLE 持有人可直接操作（不过 Timelock） | 已冻结 |
| P2-D3 | 状态机：Normal / Paused / EmergencyExit，Paused 封锁新存款，EmergencyExit 同样封锁 | 已冻结 |
| P2-D4 | MAX_STRATEGY_DEPLOY_BPS = 7000（70% 硬上限），在 transferToStrategyManager() 强制执行 | 已冻结 |
| P2-D5 | rebalance() 为无许可函数，带 1 小时冷却，仅向目标区间（30%）单向移动，无法超调 | 已冻结 |

---

## 1. 角色定义

### 1.1 FundVaultV01

| 角色常量 | keccak256 值来源 | 持有人（生产） | 权限范围 |
|---------|----------------|-------------|---------|
| `DEFAULT_ADMIN_ROLE` | OZ 标准 `bytes32(0)` | 24h TimelockController | 所有管理操作 |
| `EMERGENCY_ROLE` | `keccak256("EMERGENCY_ROLE")` | Multisig（直接，绕过 Timelock） | 仅 setMode(Paused)、pauseDeposits()、pauseRedeems() |
| `UPGRADER_ROLE` | `keccak256("UPGRADER_ROLE")` | V3 初版未分配（保留） | 策略合约升级（初版未启用） |
| `PROPOSER_ROLE` | `keccak256("PROPOSER_ROLE")` | V3 初版未分配（保留） | 治理信号提案（初版未启用） |

### 1.2 StrategyManagerV01

| 角色常量 | 持有人 | 权限范围 |
|---------|-------|---------|
| `DEFAULT_ADMIN_ROLE` | 同 Vault（24h Timelock） | invest, divest, returnToVault, emergencyExit, setStrategy, setLimits, unpause |
| `EMERGENCY_ROLE` | Multisig（直接） | pause() |

### 1.3 LockLedgerV02 / LockRewardManagerV02

| 角色常量 | 持有人 | 权限范围 |
|---------|-------|---------|
| `DEFAULT_ADMIN_ROLE` | 24h Timelock | 所有管理操作、unpause |
| `EMERGENCY_ROLE` | Multisig（直接） | pause() |
| `OPERATOR_ROLE`（LockLedger 专属） | LockRewardManagerV02 合约地址 | lockFor, earlyExitFor, transferLockOwnership |

---

## 2. 函数级权限矩阵（FundVaultV01）

| 函数 | DEFAULT_ADMIN | EMERGENCY_ROLE | UPGRADER_ROLE | PROPOSER_ROLE | 无许可 |
|------|:---:|:---:|:---:|:---:|:---:|
| `setMode(Paused)` | ✓ | ✓ | — | — | — |
| `setMode(Normal)` | ✓ | — | — | — | — |
| `setMode(EmergencyExit)` | ✓ | — | — | — | — |
| `pauseDeposits()` | ✓ | ✓ | — | — | — |
| `unpauseDeposits()` | ✓ | — | — | — | — |
| `pauseRedeems()` | ✓ | ✓ | — | — | — |
| `unpauseRedeems()` | ✓ | — | — | — | — |
| `transferToStrategyManager()` | ✓ | — | — | — | — |
| `setModules()` | ✓ | — | — | — | — |
| `setReserveRatioBps()` | ✓ | — | — | — | — |
| `setMgmtFeeBpsPerMonth()` | ✓ | — | — | — | — |
| `setTreasury()` | ✓ | — | — | — | — |
| `openExitModeRound()` | ✓ | — | — | — | — |
| `closeExitModeRound()` | ✓ | — | — | — | — |
| `claimExitAssets()` | — | — | — | — | ✓（用户） |
| `deposit()` | — | — | — | — | ✓（用户，Normal 模式下） |
| `redeem()` | — | — | — | — | ✓（用户） |
| `accrueManagementFee()` | — | — | — | — | ✓ |
| `rebalance()` | — | — | — | — | ✓（1h 冷却） |
| `checkUpkeep()` | — | — | — | — | ✓（view） |
| `performUpkeep()` | — | — | — | — | ✓（调用 rebalance()） |
| `grantRole()` | ✓ | — | — | — | — |
| `revokeRole()` | ✓ | — | — | — | — |

---

## 3. 状态机转移图

```
                   ┌──────────────┐
                   │    Normal    │  ← 默认初始状态
                   │  (mode = 0)  │
                   └──────┬───────┘
          ADMIN 或         │         ADMIN 或
        EMERGENCY_ROLE     │       EMERGENCY_ROLE
        setMode(Paused)    │       pauseDeposits()
                           │
                   ┌───────▼──────┐
                   │    Paused    │
                   │  (mode = 1)  │  ← 封锁新存款
                   └──────┬───────┘
                           │
                     仅 ADMIN         仅 ADMIN
                   setMode(Normal) ──► 恢复至 Normal
                           │
                     仅 ADMIN
                   setMode(EmergencyExit)
                           │
                   ┌───────▼──────────┐
                   │  EmergencyExit   │
                   │   (mode = 2)     │  ← 封锁存款 + strategy 部署
                   └───────┬──────────┘
                           │
                     ADMIN 操作：
                     openExitModeRound()
                     claimExitAssets()（用户）
                     closeExitModeRound()
```

### 3.1 各状态下操作可用性

| 操作 | Normal | Paused | EmergencyExit |
|------|:------:|:------:|:-------------:|
| 新存款 | ✓ | ✗（封锁） | ✗（封锁） |
| 赎回（redeem） | ✓ | ✓ | ✓ |
| transferToStrategyManager | ✓ | ✗ | ✗ |
| invest（StrategyManager） | ✓ | ✗（vault 模式检查） | ✗（vault 模式检查） |
| openExitModeRound | ✗ | ✗ | ✓ |
| rebalance（无许可） | ✓ | 仅 pull 方向 | ✗（deploy 方向被封锁） |
| emergencyExit（StrategyManager） | ✓ | ✓ | ✓ |

---

## 4. Timelock 集成规范

### 4.1 生产部署要求

- 部署独立的 `TimelockController`（OZ 标准，24h 最小延迟）
- 在 FundVaultV01、StrategyManagerV01、LockLedgerV02、LockRewardManagerV02 上，将 `DEFAULT_ADMIN_ROLE` 授予 TimelockController 地址
- Multisig（运营团队）担任 TimelockController 的 PROPOSER 和 EXECUTOR
- EMERGENCY_ROLE 由 Multisig 直接持有（不过 Timelock）

### 4.2 合约层说明

- 当前合约没有内嵌 Timelock 逻辑；Timelock 通过外置 TimelockController 合约实现
- 合约内部无法区分调用者是否经过 Timelock；部署脚本和运营流程须保证 DEFAULT_ADMIN_ROLE 不直接持有于 EOA

### 4.3 绕过 Timelock 的合法场景

| 场景 | 角色 | 原因 |
|------|------|------|
| 暂停新存款 | EMERGENCY_ROLE | 紧急响应，不能等 24h |
| 设置 Paused 模式 | EMERGENCY_ROLE | 同上 |
| 暂停 StrategyManager | EMERGENCY_ROLE | 停止新资金进入策略 |

---

## 5. 不可越权边界（硬性规则）

1. **EMERGENCY_ROLE 不能**：
   - 设置 EmergencyExit 或 Normal 模式
   - unpause 任何操作
   - 修改用户余额或 shares
   - 调用 transferToStrategyManager

2. **无任何角色能**：
   - 直接 mint shares 给任意地址
   - 直接 burn 用户 shares（除 exitRound 的用户主动申请路径）
   - 改写 totalAssets 计算公式

3. **MAX_STRATEGY_DEPLOY_BPS = 7000** 为合约内硬编码常量，不可配置。

---

## 6. 待补充（Phase 2 之后）

| 项目 | 状态 | 备注 |
|------|------|------|
| TimelockController 部署脚本 | 待 Phase 6+ | 生产部署前必须完成 |
| UPGRADER_ROLE 实际功能 | 预留 | V3 初版未使用 |
| PROPOSER_ROLE 实际功能 | 预留 | 初版治理桥接仅投票排序 |
| rebalance() pull 路径完整测试 | Phase 3 补充 | 需要 strategy 有可 divest 余额 |
