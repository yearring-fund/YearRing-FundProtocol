# FinancialBase V02 — Scope Document（申请版）

> **定位**：在已通过测试的 V01 主路径之上，以最小改动叠加六个薄层模块，形成完整的"链上基金 + 锁仓激励 + 管理费折扣返还 + 奖励代币发放 + 受益人 + 演示数据"协议形态，用于 Grant 申请与产品演示。
>
> **不是终局架构**，不引入 DAO / 多策略 / 完整 Token 经济机制。
>
> **排期依据**：本 Scope 依照 `FunctionD/Increasing_Locked_Returns_and_Unlocking_Schedule_v2.md` 的 V2 必做功能清单整合，锁定奖励代币与管理费折扣为本版必做项；提前解锁与补缴奖励代币退出推迟至 V3。

---

## 1. V2 Scope 设计摘要

### 1.1 目标

| 目标 | 说明 |
| --- | --- |
| 演示完整性 | 可以展示：存款 → 锁仓 → 积累积分 → 奖励加权分发 → 解锁赎回的完整用户路径 |
| 叙事完整性 | 锁仓 + 积分 + 受益人构成"链上基金会员体系"的基础叙事 |
| 可审计性 | 每个模块职责单一，代码量小，便于快速审阅 |
| V01 零破坏 | V01 所有合约不改动，V02 模块仅通过标准接口与 V01 交互 |

### 1.2 新增模块一览

```
LockLedgerV02          锁仓账本        — 用户锁定 fbUSDC shares，记录到期时间
LockBenefitV02         积分引擎        — 按锁仓量 × 时长 × 档位乘数计算积分，暴露 tierOf
LockRewardManagerV02   奖励分发        — lockWithReward 锁仓时一次性发放奖励代币；claimRebate 领取管理费折扣返还（fbUSDC shares）
UserStateEngineV02     用户状态聚合    — 聚合单用户全协议状态，纯 view
BeneficiaryModuleV02   受益人          — 用户指定代领地址，转发 Merkle 奖励
MetricsLayerV02        演示指标层      — 协议级聚合数据，纯 view，供前端/投资人
```

### 1.3 模块依赖关系

```
FundVaultV01 (fbUSDC shares) ◄─── treasury 预授权 ───┐
      │                                               │
      ▼                                               │
LockLedgerV02 ──► LockBenefitV02 ──► LockRewardManagerV02
      │            (档位 + 乘数)     (lockWithReward: 奖励代币 upfront
      │                               claimRebate: 折扣返还 fbUSDC)
      │
      └──► UserStateEngineV02 ◄── MerkleRewardsDistributorV01
                                          │
                              BeneficiaryModuleV02 (claim 转发)
                                          │
                              MetricsLayerV02 (聚合所有合约)
```

---

## 2. 模块职责边界

### 2.1 LockLedgerV02

**职责**：接收并保管用户的 fbUSDC vault shares，记录锁仓期限，到期返还。

| 项目 | 说明 |
| --- | --- |
| 输入 | 用户 approve → 经由 `LockRewardManagerV02.lockWithReward()` → `lockFor(owner, shares, duration)` 拉取 shares |
| 存储 | `LockPosition { owner, shares, lockedAt, unlockAt, unlocked }` |
| 输出 | `unlock(lockId)` 到期后归还 shares |
| 时长范围 | 30 天 ～ 365 天（`MIN_LOCK_DURATION` / `MAX_LOCK_DURATION` 常量，不可改） |
| 活跃仓位上限 | `MAX_ACTIVE_LOCKS_PER_USER = 5`，超出 revert |
| 早期解锁 | 经由 `LockRewardManagerV02.earlyExitWithReturn(lockId)`：归还奖励代币后，principal 全额返还，points 清零，状态标记 `earlyExited` |
| V01 交互 | 仅 `IERC20.transferFrom / transfer`，不调用 vault 任何业务函数 |
| 权限 | GUARDIAN 暂停；DEFAULT_ADMIN 恢复 |

**关键不变量**：

- `totalLockedShares == IERC20(vaultShares).balanceOf(address(this))`
- 每个 lockId 只能 unlock 一次（`unlocked` 标志位）
- 每个用户活跃（未 unlock）仓位数 ≤ 5

---

### 2.2 LockBenefitV02

**职责**：根据锁仓记录暴露档位信息（`tierOf`）供 LockRewardManagerV02 使用。不写入 LockLedger，不转移任何资产。

**奖励代币档位乘数（5 档）**：

| 档位 | 锁仓时长 | 乘数（bps，10000=1×） | 备注 |
| --- | --- | --- | --- |
| Sub | < 30 天 | 8000（0.8×） | 方案B：LockLedger 常量不变，此档在 V2 物理上不可达，仅乘数表存在 |
| Bronze | 30 ～ 89 天 | 10000（1×） | 基础档 |
| Silver | 90 ～ 179 天 | 13000（1.3×） |  |
| Gold | 180 ～ 365 天 | 18000（1.8×） |  |
| Super | > 365 天 | 20000（2×） | 方案B：同 Sub，V2 物理上不可达 |

*Sub / Super 档位已在合约乘数表中定义，方便 V3+ 直接扩展 LockLedger 时长范围时复用，无需改动 LockBenefitV02。*

**奖励代币计算公式（由 LockRewardManagerV02 调用）**：

```
rewardTokens = lockedUSDCValue × duration_days × rewardMultiplierBps
               / (10000 × 50)

其中：
  lockedUSDCValue = FundVaultV01.convertToAssets(lockedShares)  // claim 时实时读取
  duration_days   = elapsed / 1 days
  rewardMultiplierBps = tierOf(lockId) 对应的乘数

示例：50 USDC × 1 天 × 10000(1×) / (10000 × 50) = 1 RewardToken
```

**管理费折扣档位（独立于奖励代币，仅 Bronze/Silver/Gold 三档有效）**：

| 档位 | 折扣率 | 说明 |
| --- | --- | --- |
| None（未锁仓） | 0% | 标准管理费 |
| Bronze | 20% |  |
| Silver | 40% |  |
| Gold | 60% |  |

*Sub / Super 无对应折扣率（V2 不可达）。*

| 项目 | 说明 |
| --- | --- |
| 输入 | `LockLedgerV02.getLock(lockId)` 读取锁仓数据 |
| 输出 | `rewardMultiplierOf(lockId) view` / `feeDiscountBpsOf(lockId) view` / `tierOf(lockId) view` |
| 写入状态 | 无（纯计算，不存储） |
| V01 交互 | 无 |
| 权限 | 无特殊权限，纯 view |

**关于积分用途**：`rewardMultiplierOf` 供 LockRewardManagerV02 计算奖励代币；`feeDiscountBpsOf` 供其计算折扣返还；两者独立调用，互不干扰。

---

### 2.3 UserStateEngineV02

**职责**：聚合单个用户在整个协议中的状态，作为前端和链下系统的统一只读入口。

**聚合内容**：

| 字段 | 来源 |
| --- | --- |
| `vaultShareBalance` | `FundVaultV01.balanceOf(user)` |
| `lockedShares` | `LockLedgerV02.totalLockedSharesOf(user)` |
| `availableShares` | vaultShareBalance − lockedShares |
| `totalPoints` | `LockBenefitV02.totalPointsOf(user)` |
| `tier` | 最高 tier（按当前活跃锁仓） |
| `totalClaimed` | `MerkleRewardsDistributorV01.claimed` 汇总 |
| `beneficiary` | `BeneficiaryModuleV02.beneficiaryOf(user)` |
| `pendingRebateShares` | `LockRewardManagerV02.previewRebate(lockId)` 汇总 |
| `issuedRewardTokens` | `LockRewardManagerV02.issuedRewardTokens(lockId)` 汇总（upfront 已发，非 pending） |
| 项目 | 说明 |
| --- | --- |
| 写入状态 | 无（纯 view） |
| V01 交互 | 只读 |
| 权限 | 无 |

---

### 2.4 BeneficiaryModuleV02

**职责**：允许用户指定一个受益人地址，由受益人代为发起 Merkle claim，奖励直接转给原 account（不改变 leaf 的 account 字段）。

**V2 实现：单一受益人。接口预留复数受益人扩展点，V3+ 升级时不需要重写接口层。**

**流程**：

```
受益人调用 claimFor(epochId, account, amount, proof)
  → 验证 beneficiaryOf(account) == msg.sender
  → 转发至 MerkleRewardsDistributorV01.claim(epochId, account, amount, proof)
```

| 项目 | 说明 |
| --- | --- |
| 核心函数 | `setBeneficiary(address)` / `revokeBeneficiary()` / `claimFor(...)` |
| V01 交互 | 调用 `MerkleRewardsDistributorV01.claim()`，不修改 Distributor |
| 奖励流向 | 仍转给 `account`（Distributor 内部逻辑不变） |
| 权限 | 用户自主设置，无 admin 介入 |

**关键约束**：

- 用户只能为自己设置受益人，不能替他人设置
- 受益人不能是 `address(0)`

**接口扩展预留（V3+ 实现）**：

`IBeneficiaryV02.sol` 中预留以下接口签名（V2 不实现，仅声明），供后续版本的多受益人合约继承：

```solidity
// V2 实现
function setBeneficiary(address beneficiary) external;
function revokeBeneficiary() external;
function beneficiaryOf(address account) external view returns (address);

// V3+ 预留（V2 中标注 @dev future，不实现）
function setBeneficiaries(address[] calldata beneficiaries, uint256[] calldata bps) external;
function getBeneficiaries(address account) external view returns (address[] memory, uint256[] memory);
```

后续版本部署新合约实现完整接口，V2 合约不升级，用户可迁移。

---

### 2.5 LockRewardManagerV02

**职责**：链上奖励协调层。用户所有锁仓操作（锁仓、领 rebate、提前退出）均经由本合约，LockLedgerV02 直接调用被 OPERATOR_ROLE 限制。

两项收益时机不同，独立计算，互不干扰：

#### 收益一：奖励代币（RewardToken）— 锁仓时一次性发放

```
// lockWithReward() 时按完整锁仓期限一次性计算并发放
rewardTokens = lockedUSDCValue × USDC_TO_TOKEN_SCALE × durationDays × multiplierBps
               / (10000 × 50)

其中：
  lockedUSDCValue   = FundVaultV01.convertToAssets(shares)  // 锁仓时读取
  USDC_TO_TOKEN_SCALE = 1e12                                 // 6→18 decimal 桥接
  durationDays      = duration / 1 days
  multiplierBps     = LockBenefitV02.multiplierFromDuration(duration)

乘数固定值：
  Bronze (30~89d)   → 10000 bps (1×)
  Silver (90~179d)  → 13000 bps (1.3×)
  Gold   (180~365d) → 18000 bps (1.8×)

提前退出（earlyExitWithReturn）：用户必须将全量奖励代币归还 treasury，
                                 本合约再通过 earlyExitFor 释放 principal。
归还后 issuedRewardTokens[lockId] 清零。
```

#### 收益二：管理费折扣返还（fbUSDC shares）— 线性累计，随时可领

```
// claimRebate(lockId) 按自上次结算以来的时间线性计算
rebateShares = lockedShares × mgmtFeeBpsPerMonth × feeDiscountBps × elapsed
               / (BPS_DENOMINATOR² × SECONDS_PER_MONTH)

折扣率（来自 LockBenefitV02）：
  Bronze → 2000 bps (20%)
  Silver → 4000 bps (40%)
  Gold   → 6000 bps (60%)

FundVaultV01 全程不改动，管理费仍全额铸造给 treasury，
本模块在 treasury 授权范围内将折扣部分返还给锁仓用户。
```

**核心接口**：

```
lockWithReward(uint256 shares, uint64 duration) → lockId
  → 调用 ledger.lockFor(msg.sender, shares, duration)
  → 一次性计算并发放 rewardTokens（treasury → owner）
  → 初始化 lastRebateClaimedAt[lockId] = block.timestamp
  → emit LockedWithReward(lockId, owner, shares, rewardTokensIssued)

claimRebate(uint256 lockId) → rebateShares
  → 结算自 lastRebateClaimedAt 至今的 rebate shares（treasury → owner）
  → 更新 lastRebateClaimedAt[lockId]
  → emit RebateClaimed(lockId, owner, rebateShares)

earlyExitWithReturn(uint256 lockId)
  → auto-settle 最终 rebate
  → 用户归还全量 issuedRewardTokens（owner → treasury）
  → 调用 ledger.earlyExitFor(lockId, owner) 释放 principal
  → issuedRewardTokens[lockId] = 0
  → emit EarlyExitExecuted(lockId, owner, rewardTokensReturned)

previewRebate(uint256 lockId) view → rebateShares
```

| 项目 | 说明 |
| --- | --- |
| 输入 | `LockLedgerV02.getLock(lockId)` / `LockBenefitV02.multiplierFromDuration` + `feeDiscountFromDuration` / `FundVaultV01.mgmtFeeBpsPerMonth` + `convertToAssets` |
| 输出 | lockWithReward: RewardToken upfront；claimRebate: fbUSDC shares 线性返还 |
| 写入状态 | `issuedRewardTokens[lockId]`（锁仓时写入，earlyExit 后清零）；`lastRebateClaimedAt[lockId]`（锁仓时初始化，每次 claimRebate 更新） |
| 资产来源 | treasury 预授权本合约支配 RewardToken + fbUSDC shares |
| V01 交互 | 只读 `mgmtFeeBpsPerMonth`、`convertToAssets`；`transferFrom` RewardToken + fbUSDC shares |
| 权限 | DEFAULT_ADMIN（DEFAULT_ADMIN_ROLE）；GUARDIAN 可暂停 |

**关键不变量**：

- treasury 授权额度不足时 revert（`InsufficientRewardTokenAllowance` / `InsufficientVaultSharesAllowance`），不静默失败
- `lastRebateClaimedAt[lockId]` 在 lock 创建时初始化为 `block.timestamp`，unlock / earlyExit 后不可再领
- earlyExitWithReturn 须先归还全量奖励代币，principal 才会释放
- 不持有任何资产，所有 token 直接从 treasury 点对点划转给用户

---

### 2.6 MetricsLayerV02

**职责**：协议级聚合数据的只读层，供前端 Dashboard 和演示使用。

**提供数据**：

| 函数 | 说明 |
| --- | --- |
| `totalTVL()` | FundVaultV01.totalAssets() |
| `totalLockedShares()` | LockLedgerV02.totalLockedShares() |
| `lockRateBps()` | lockedShares / totalSupply（bps） |
| `totalLockCount()` | LockLedgerV02.nextLockId() |
| `estimatedAPY()` | 基于 AaveV3StrategyV01 aToken yield 的估算（bps） |
| `getUserMetrics(address)` | 转发 UserStateEngineV02.getState(user) |
| 项目 | 说明 |
| --- | --- |
| 写入状态 | 无（纯 view） |
| V01 交互 | 只读 |
| 权限 | 无 |

---

## 3. 绝对不动的地方

| 文件 | 禁止原因 |
| --- | --- |
| `contracts/FundVaultV01.sol` | totalAssets / share accounting / deposit / redeem 核心路径 |
| `contracts/StrategyManagerV01.sol` | totalManagedAssets / invest / divest 策略会计 |
| `contracts/MerkleRewardsDistributorV01.sol` | claim / epoch 会计，不改签名、不改逻辑 |
| `contracts/RewardToken.sol` | 固定供应，不增发 |
| `contracts/interfaces/IStrategyManagerV01.sol` | 接口签名冻结 |
| `contracts/interfaces/IStrategyV01.sol` | 接口签名冻结 |
| `contracts/interfaces/IFundSharesV01.sol` | 接口签名冻结 |
| 所有 V01 测试文件 | 已验收，不回归 |

---

## 4. 新增 / 修改文件清单

### 4.1 新增合约

```
contracts/
  LockLedgerV02.sol               锁仓账本（主合约）
  LockBenefitV02.sol              积分计算（纯 view，兼档位查询）
  LockRewardManagerV02.sol        lockWithReward（奖励代币 upfront）+ claimRebate（折扣返还线性累计）
  UserStateEngineV02.sol          用户状态聚合（纯 view）
  BeneficiaryModuleV02.sol        受益人代领
  MetricsLayerV02.sol             协议指标层（纯 view）

contracts/interfaces/
  ILockLedgerV02.sol              LockLedger 接口 + LockPosition struct
  ILockRewardManagerV02.sol       RewardManager 接口
  IUserStateV02.sol               UserState 返回结构体
  IBeneficiaryV02.sol             Beneficiary 接口
```

### 4.2 新增文档

```
docs/
  V2_SCOPE.md                     本文档
```

### 4.3 新增脚本（后续）

```
scripts/
  deploy_v02.ts                   V02 模块部署 + 接线
```

### 4.4 新增测试（逻辑确认后补全）

```
test/
  LockLedger.test.ts
  LockBenefit.test.ts
  FeeDiscount.test.ts
  UserState.test.ts
  Beneficiary.test.ts
  Metrics.test.ts
  Integration.V02.test.ts
```

---

## 5. 推荐目录结构

```
FinancialBase/
├── contracts/
│   ├── FundVaultV01.sol                    ← V01，不动
│   ├── StrategyManagerV01.sol              ← V01，不动
│   ├── MerkleRewardsDistributorV01.sol     ← V01，不动
│   ├── RewardToken.sol                     ← V01，不动
│   ├── LockLedgerV02.sol                   ← V02 新增
│   ├── LockBenefitV02.sol                  ← V02 新增
│   ├── LockRewardManagerV02.sol            ← V02 新增
│   ├── UserStateEngineV02.sol              ← V02 新增
│   ├── BeneficiaryModuleV02.sol            ← V02 新增
│   ├── MetricsLayerV02.sol                 ← V02 新增
│   ├── interfaces/
│   │   ├── IFundSharesV01.sol              ← V01，不动
│   │   ├── IStrategyManagerV01.sol         ← V01，不动
│   │   ├── IStrategyV01.sol                ← V01，不动
│   │   ├── ILockLedgerV02.sol              ← V02 新增
│   │   ├── ILockRewardManagerV02.sol       ← V02 新增
│   │   ├── IUserStateV02.sol               ← V02 新增
│   │   └── IBeneficiaryV02.sol             ← V02 新增
│   ├── strategies/
│   │   ├── AaveV3StrategyV01.sol           ← V01，不动
│   │   └── interfaces/
│   │       ├── IAToken.sol
│   │       └── IPool.sol
│   └── mocks/
│       ├── MockUSDC.sol
│       └── DummyStrategy.sol
├── docs/
│   └── V2_SCOPE.md                         ← 本文档
├── scripts/
│   ├── config.ts
│   ├── deploy.ts
│   ├── deploy_rewards.ts
│   ├── deploy_v02.ts                       ← V02 新增
│   └── build_merkle.ts
└── test/
    ├── (V01 测试，已通过，不改)
    ├── LockLedger.test.ts                  ← V02，待补
    ├── LockBenefit.test.ts                 ← V02，待补
    ├── LockRewardManager.test.ts           ← V02，待补
    ├── UserState.test.ts                   ← V02，待补
    ├── Beneficiary.test.ts                 ← V02，待补
    ├── Metrics.test.ts                     ← V02，待补
    └── Integration.V02.test.ts             ← V02，待补
```

---

## 6. 测试文件骨架命名建议

| 文件 | 覆盖重点 |
| --- | --- |
| `LockLedger.test.ts` | lock / unlock / 时长边界 / 重复解锁 / 暂停 / 未到期解锁 revert |
| `LockBenefit.test.ts` | 积分计算正确性 / 三档乘数 / 零锁仓 / 边界时长 / tierOf 返回值 |
| `LockRewardManager.test.ts` | lockWithReward 奖励代币 upfront / claimRebate 线性 rebate / treasury 授权不足 revert（两个自定义错误）/ 重复 claimRebate 累计正确 / unlock 后不可 claimRebate / earlyExitWithReturn 归还代币 + 清零 issuedRewardTokens |
| `UserState.test.ts` | 聚合数据正确性 / 有无锁仓两种状态 / pendingRebate + pendingReward 字段 |
| `Beneficiary.test.ts` | 设置/撤销受益人 / claimFor 转发 / 非受益人 revert / 接口预留签名存在性验证 |
| `Metrics.test.ts` | TVL / lockRate / estimatedAPY 数据正确性 |
| `Integration.V02.test.ts` | 完整路径：deposit → lockWithReward（奖励代币 upfront）→ claimRebate（折扣返还）→ unlock → redeem |

---

## 7. 开发顺序建议

```
① LockLedgerV02           已完成
② LockBenefitV02          下一步（积分 + tierOf 接口）
③ LockRewardManagerV02    依赖 ①②（读取 getLock + tierOf）
④ BeneficiaryModuleV02    独立模块，无依赖（可与③并行）
⑤ UserStateEngineV02      依赖 ①②③④
⑥ MetricsLayerV02         依赖 ①②③④⑤
⑦ deploy_v02.ts           部署脚本（含 treasury 授权步骤）
⑧ 测试（用户确认逻辑后统一补全）
```

---

## 8. V2 安全边界说明

- LockLedger 持有用户资产（vault shares），是本次新增中唯一有资产风险的合约，需重点审计
- BeneficiaryModule 作为 claim 转发层，逻辑简单，但需确保转发不会绕过 Distributor 的 proof 验证
- LockRewardManager 不持有资产，所有 token 从 treasury 点对点划转；treasury 授权额度是主要风险边界，需严格管控
- lockWithReward / claimRebate / earlyExitWithReturn 均须防重入，使用 ReentrancyGuard
- UserStateEngine / LockBenefit / MetricsLayer 均为纯 view，无资产风险
- V02 模块不持有也不转移 USDC，不影响 Vault 的 `totalAssets()` 不变量

---

## 9. V2 与排期文档对齐说明

本 Scope 依照 `FunctionD/Increasing_Locked_Returns_and_Unlocking_Schedule_v2.md` 整合，对应关系如下：

| 排期文档 V2 必做功能 | 本 Scope 对应模块 | 状态 |
| --- | --- | --- |
| 锁定功能（仓位、时长档位、分离记账） | LockLedgerV02 | ✅ 已实现 |
| 锁定奖励代币（积分加权 → Merkle 分发） | LockBenefitV02 + MerkleRewardsDistributorV01 | ✅ 纳入 Scope |
| 管理费折扣（返还 fbUSDC shares）+ 奖励代币（upfront） | LockRewardManagerV02.claimRebate + lockWithReward（新增） | ✅ 纳入 Scope |
| 锁定期间不可赎回 | LockLedgerV02（unlock 到期检查） | ✅ 已实现 |
| 排期文档 V2 不做功能 | 本 Scope 处理 |
| --- | --- |
| 提前解锁 | ✅ 纳入 V2（最小版）：principal 全额返还，points 清零，无罚金机制 |
| 足额补缴奖励代币退出 | 不纳入，推迟 V3 |
| 增强收益池 | 不纳入，推迟 V4 |

**折扣实现说明**：管理费全额铸造给 treasury（V01 不改），LockRewardManagerV02 在 treasury 授权范围内将折扣部分以 fbUSDC shares 形式返还锁仓用户，无需 V01.1 补丁。V01 完全不动。

---

*文档版本：v2.4-scope | 日期：2026-03-28 | 变更：对齐实现口径——奖励代币改为 lockWithReward 时 upfront 一次性发放，管理费折扣返还改为 claimRebate 线性领取，移除不存在的 claimAll / previewClaimAll 接口描述*
