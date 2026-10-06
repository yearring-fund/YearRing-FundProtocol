# Closed Beta 当前代码实现盘点报告

> 生成日期：2026-05-04  
> 基于仓库：YearRing-FundProtocol / FinacialBase  
> 状态：新部署前只读盘点，代码未修改

---

## 一、当前合约清单

| 合约文件 | 职责 | 已部署 | 部署脚本 | 测试文件 |
|---|---|---|---|---|
| `FundVaultV01.sol` | ERC4626 Vault 主体，管理费铸造，allowlist，EmergencyExit，rebalance | ✅ `0x9dD6…` | `scripts/deploy.ts` | `FundVault.test.ts`, `Phase2~5` |
| `LockLedgerV02.sol` | 锁仓账本，持有 fbUSDC shares，lockFor/unlock/earlyExitFor | ✅ `0x2D95…` | `deploy_v2.ts` | `LockLedger.test.ts` |
| `LockBenefitV02.sol` | 纯 view，tier 判定 + multiplier + discountBps | ✅ `0x083C…` | `deploy_v2.ts` | `LockBenefit.test.ts` |
| `LockRewardManagerV02.sol` | 锁仓主入口，前置发放 RWT，rebate 结算，earlyExit | ✅ `0xb29D…` | `deploy_v2.ts` | `LockRewardManager.test.ts`, `EarlyExit.test.ts` |
| `RewardToken.sol` | RWT ERC20，固定总量预铸至 Treasury，ERC20Snapshot | ✅ `0xeAb5…` | `deploy_v2.ts` | `RewardToken.test.ts` |
| `LockPointsV02.sol` | 纯 view，基于已锁时间计算 loyalty points（已标记 Deprecated） | ⚠️ 部署但 deprecated | `deploy_v2.ts`（注释为"never deploy"） | `LockPoints.test.ts` |
| `BeneficiaryModuleV02.sol` | 受益人指定，inactivity timer，锁仓所有权转移 | ✅ `0x0dA3…` | `deploy_v2.ts` | `Beneficiary.test.ts` |
| `UserStateEngineV02.sol` | 纯 view，返回单锁和用户聚合状态枚举 | ✅ `0x083A…` | `deploy_v2.ts` | `UserState.test.ts` |
| `MetricsLayerV02.sol` | 纯 view，返回协议快照（TVL/locked/ratio/totalLocks） | ✅ `0x1C4B…` | `deploy_v2.ts` | `Metrics.test.ts` |
| `GovernanceSignalV02.sol` | 信号治理，RWT 投票，仅信号无执行权 | ✅ `0x9BE5…` | `deploy_v2.ts`（optional） | `GovernanceSignal.test.ts` |
| `ClaimLedger.sol` | Exit 模式索赔凭证登记（VAULT_ROLE 控制） | ✅ `0x5CF9…` | `scripts/deploy.ts` | `ClaimLedger.test.ts` |
| `StrategyManagerV01.sol` | 策略中间层，Vault→Strategy 资金转发，emergencyExit | ✅（Vault 关联） | `deploy.ts` | `StrategyManager.test.ts` |
| `MerkleRewardsDistributorV01.sol` | Merkle 分发，epoch 管理，增量 claim | ⚠️ 有脚本，未确认部署 | `scripts/deploy_rewards.ts` | `MerkleRewardsDistributor.test.ts` |

---

## 二、Vault / 管理费实现

**1. 当前参数**

`mgmtFeeBpsPerMonth` 当前值：**9 bps/月** ≈ 1.08%/年（来自 `config.ts: mgmtFeeBpsPerMonth: 9`）。构造函数不设置，初始为 0，通过 `setMgmtFeeBpsPerMonth()` 配置。

**2. 收费公式**（`accrueManagementFee`，L339）

```
feeShares = totalSupply × mgmtFeeBpsPerMonth × elapsed
            / (10000 × 30days)
```

按秒线性累积，任何 deposit/redeem 前自动结算，也可 permissionless 主动调用。

**3. mgmtFeeBpsPerMonth() 当前返回**

链上读取返回 `9`（上限 `MAX_MGMT_FEE_BPS_PER_MONTH = 200`）。

**4. 管理费进入地址**

铸造 fbUSDC shares 至 `treasury` 地址（EOA/Multisig，非合约），不是 USDC，是 fbUSDC shares。

**5. 是否可 admin 修改**

是。`setMgmtFeeBpsPerMonth(uint256 newBps)` 由 `DEFAULT_ADMIN_ROLE` 调用，通过 Timelock 执行。调用前自动 `accrueManagementFee()` 结清旧费率。

**6. 改为原来一半所需操作**

**纯参数修改，不改合约**。当前 9 bps → 改为 4 bps（向下取整）或 5 bps。通过 Timelock 调度 `setMgmtFeeBpsPerMonth(4)` 即可，等待 timelock delay 后执行。

---

## 三、Treasury 当前实现

**1. 是否有 Treasury 合约**

**没有**。Treasury 是普通 EOA 地址（在 `.env` 中配置），由 `dep.config.treasury` 在部署时传入各合约构造函数。

**2. Treasury 当前函数**

无合约函数。Treasury 只是一个地址，通过对 `LockRewardManagerV02` 开放 RWT `approve` 及 fbUSDC shares `approve` 来允许合约从中拉取资产。

**3. 设计持有的资产**

- fbUSDC shares（管理费铸造进来）
- RWT 全量（部署时预铸入 Treasury）

**4. 是否接收管理费**

是。Vault `accrueManagementFee()` 直接 `_mint(treasury, feeShares)` — 铸造 fbUSDC shares 进 Treasury。

**5. 是否作为 RWT 发放源**

是。`LockRewardManagerV02._lockWithRewardInternal` 中 `rewardToken.safeTransferFrom(treasury, owner, tokens)` — 从 Treasury 拉 RWT 给用户。

**6. 是否作为 rebate fbUSDC shares 来源**

是。`_settleRebate` 中 `vaultShares.safeTransferFrom(treasury, pos.owner, rebateShares)` — 从 Treasury 拉 fbUSDC shares 给用户。

**7. 安全机制**

Treasury **没有**以下任何机制：

- `revokeAllowance` / emergency revoke
- `rescueToken`
- approved asset list
- budget cap
- 多签审批

当前 LockRewardManager 对 Treasury allowance 的检查是"先查后拉"，如果 Treasury 持有量不足，交易 revert，无其他保护。

**8. 是否可能接触用户本金**

**不直接接触**。用户的 USDC 由 Vault 持有（或通过 StrategyManager 部署）。Treasury 持有的 fbUSDC shares 是管理费收入，不是用户本金。Treasury 持有 fbUSDC shares 并有权赎回，是管理费的合理权益，不构成对用户本金的侵占。

---

## 四、Lock / RWT / Rebate 当前实现

**1. LockRewardManagerV02 主要函数**

| 函数 | 说明 |
|---|---|
| `lockWithReward(shares, duration)` | 主锁仓入口，前置发 RWT |
| `lockWithPermit(shares, duration, deadline, v, r, s)` | EIP-2612 版本 |
| `claimRebate(lockId)` | 结算并领取 rebate fbUSDC |
| `earlyExitWithReturn(lockId)` | 提前退出：自动结算 rebate → 收回 RWT → 释放 shares |
| `previewRebate(lockId)` | view：查看未领 rebate 量 |
| `checkClaimRebate(lockId)` | view：详细 rebate + treasury 余量检查 |
| `checkEarlyExit(lockId)` | view：提前退出所需信息全集 |
| `approveForceExit(lockId)` | EMERGENCY_ROLE：预授权强制退出 |
| `executeForceExit(lockId, reason)` | DEFAULT_ADMIN_ROLE：执行强制退出（两步） |
| `pause() / unpause()` | 紧急暂停 |

**2. lockWithReward 完整流程**（`_lockWithRewardInternal`）

1. 检查 vaultShares allowance（用户已 approve to LockLedger）
2. 调用 `ledger.lockFor(owner, shares, duration)` — LockLedger 从用户 transferFrom shares
3. 调用 `benefit.multiplierFromDuration(duration)` 查询 tier multiplier
4. 计算 `tokens = lockedUSDCValue × 1e12 × durationDays × multiplierBps / (10000 × 500)`
5. 记录 `issuedRewardTokens[lockId] = tokens`，初始化 `lastRebateClaimedAt[lockId] = block.timestamp`
6. `rewardToken.safeTransferFrom(treasury, owner, tokens)` — 发 RWT 给用户

**3. RWT 计算公式位置**

`LockRewardManagerV02.sol:192`

```
tokens = lockedUSDCValue × USDC_TO_TOKEN_SCALE × durationDays × multiplierBps / REWARD_DENOMINATOR
       = USDC(6dec) × 1e12 × days × bps / (10000 × 500)
```

等价于：500 USDC × 1 day × 1× = 1 RWT

> ⚠️ **前端 preview 公式存在 Bug（Lock.tsx:79）：**
> ```js
> previewRwt = usdcValue × 1_000_000_000_000n × days × multiplierBps / (10000n × 50n)
> ```
> 分母用的是 `50`，而合约用的是 `500`，**前端 preview 显示的是实际 RWT 数量的 10 倍**。

**4. RWT 是否真实 transfer 给用户**

是，`rewardToken.safeTransferFrom(treasury, owner, tokens)` — 实际 ERC20 transfer。

**5. earlyExitWithReturn 是否强制返还 RWT**

是，强制。流程：
1. `_settleRebate` 最后一次 rebate 结算
2. `rewardToken.safeTransferFrom(msg.sender, treasury, tokensToReturn)` — 全额收回
3. `ledger.earlyExitFor(lockId, msg.sender)` — 释放 shares

用户必须事先 approve RWT 给 LockRewardManager，否则 revert。

**6. Rebate 计算公式位置**

`LockRewardManagerV02.sol:398-400`

```
rebate = shares × mgmtFeeBps × discountBps × elapsed
         / (10000 × 10000 × 30days)
```

**7. Rebate 是否从 Treasury 转 fbUSDC shares 给用户**

是，`vaultShares.safeTransferFrom(treasury, pos.owner, rebateShares)`。

**8. 是否存在 active / finalized / reduced points 概念**

**不存在**。当前 `issuedRewardTokens[lockId]` 只有一个值：发放时记录，earlyExit 时归零。没有 active/finalized/reduced 分层。

**9. 是否已有 points 相关变量或函数**

有，但在单独合约 `LockPointsV02.sol` 中：

- `pointsOf(lockId)` — 基于已锁时长实时计算 loyalty points（与 RWT 不同，是 elapsed-based 而非 upfront）
- `totalPointsOf(owner)` — 汇总
- 公式：`points = USDC(6dec) × elapsedDays × multiplierBps / (10000 × 50)`
- 该合约**已被标记 Deprecated**，不在前端使用，部署脚本注释"never deploy"

> 注意：LockPointsV02 的 Points 语义与 RWT 不同 —— RWT 是 upfront 发放的固定量，LockPointsV02 是实时累积的。两者不可直接对调。

**10. 如果要把 RWT 全部换成 Points（链上也改），需要修改哪些文件**

| 文件 | 改动内容 |
|---|---|
| `LockRewardManagerV02.sol` | 变量 `issuedRewardTokens` 改名为 `issuedPoints`；事件 `LockedWithReward` 改名；接口同步 |
| `RewardToken.sol` | token name/symbol 改（需重新部署） |
| `interfaces/ILockRewardManagerV02.sol` | 同步接口变量名和事件 |
| `frontend/src/pages/Lock.tsx` | 所有 RWT 文字→Points，`fmtRwt`→`fmtPoints` |
| `frontend/src/pages/Positions.tsx` | `issuedRwt`→`issuedPoints`，所有显示文字 |
| `frontend/src/components/RwtRulesSection.tsx` | 全部重命名和重写 |
| `frontend/src/components/IncentiveSection.tsx` | RWT Balance → Points Balance |
| `frontend/src/components/FeeRulesSection.tsx` | RWT Multiplier → Points Multiplier |
| `frontend/src/utils.ts` | `fmtRwt` 改为 `fmtPoints` |
| `frontend/src/contracts/abis.ts` | ABI 中事件/函数名同步 |
| `scripts/config.ts` | `rewardTotalSupply` 参数名可保留，说明改 |

---

## 五、LockBenefitV02 当前实现

**1. Tier 范围**

| Tier | 时长范围 | 说明 |
|---|---|---|
| Bronze | [30d, 90d) | 含30天，不含90天 |
| Silver | [90d, 180d) | 含90天，不含180天 |
| Gold | [180d, 365d] | 含180天，含365天 |
| None | 其他 | 包括 < 30d 或 > 365d 或已 unlock |

**2. multiplierBps**

| Tier | multiplierBps | 等效倍数 |
|---|---|---|
| Bronze | 10,000 | 1.0× |
| Silver | 13,000 | 1.3× |
| Gold | 18,000 | 1.8× |

**3. discountBps（管理费折扣）**

| Tier | discountBps | 等效折扣 |
|---|---|---|
| Bronze | 2,000 | 20% |
| Silver | 4,000 | 40% |
| Gold | 6,000 | 60% |

**4. 是否可直接复用为 Points multiplier 与 rebate discount**

是，**完全可以直接复用**。`LockBenefitV02` 是纯 view 合约，无状态，tier/multiplier/discount 的语义与 closed beta 规则完全一致，不需要修改。

---

## 六、Allowlist / 用户进入规则

**1. deposit 是否受 allowlist 控制**

是。`_deposit` hook 检查 `isAllowed[receiver]`，不在列表则 revert `NotAllowed`。

**2. lock 是否受 allowlist 控制**

**不直接控制**。`LockLedgerV02.lockFor` 和 `LockRewardManagerV02.lockWithReward` 均无 allowlist 检查。但用户需先有 fbUSDC（需通过 deposit 获得，deposit 受 allowlist 控制）。

**3. redeem 是否受 allowlist 控制**

**不控制**。`_withdraw` hook 只检查 `redeemsPaused` 和 `systemMode`，不检查 allowlist。

**4. 被移出 allowlist 后是否仍可 redeem**

是，可以。代码注释明确："Removal only prevents new deposits. Existing shares and exit rights are unaffected."

**5. 是否有单用户 deposit cap / 总 TVL cap**

- 单用户 deposit cap：**无**
- 总 TVL cap：**无**
- 活跃锁仓上限：每用户最多 5 个并发锁（`MAX_ACTIVE_LOCKS_PER_USER = 5`）

---

## 七、EmergencyExit / ClaimLedger

**1. systemMode 状态**

```
Normal        — 正常运营，所有操作可用
Paused        — deposit 暂停，redeem 和 emergencyExit 路径仍开放
EmergencyExit — deposit 和 redeem() 均关闭，仅 claimExitAssets() 可用；管理费计时暂停
```

**2. EmergencyExit 开启方式**

`FundVaultV01.setMode(SystemMode.EmergencyExit)` — 仅 `DEFAULT_ADMIN_ROLE` 可调用。进入前自动 `accrueManagementFee()` 结清费用。

**3. ClaimLedger 当前函数**

| 函数 | 访问控制 | 说明 |
|---|---|---|
| `issueClaim(beneficiary, roundId, assetType, nominalAmount)` | `VAULT_ROLE` | 发放索赔凭证 |
| `settleClaim(claimId, beneficiary)` | `VAULT_ROLE` | 标记已结清 |
| `userClaimIds(user)` | public view | 查询用户全部凭证 ID |

**4. openExitModeRound / claimExitAssets 是否已接入 Vault**

`openExitModeRound` 和 `claimExitAssets` 在 `FundVaultV01` 中**已完整实现**。**但 FundVaultV01 并未调用 ClaimLedger**，两者是独立的实现路径。`claimExitAssets` 直接 burn shares 并 transfer USDC，不经过 ClaimLedger。

**5. ClaimLedger 是否已拿到 VAULT_ROLE**

**不确定** — ClaimLedger 合约已部署，但 VAULT_ROLE 是否已 grant 给 Vault 需链上确认。从 deploy 脚本和代码中未找到 grantRole 调用。当前可能是**孤立部署，未接入**。

**6. EmergencyExit 下用户本金路径**

1. Admin 调用 `setMode(EmergencyExit)` → 模式切换，正常 redeem 关闭
2. Admin 调用 `openExitModeRound(availableAssets)` → Snapshot 当前 shares 余额（含锁仓），记录可用资产
3. 用户调用 `claimExitAssets(roundId, sharesToBurn)` → 按快照比例 burn shares，接收 USDC
4. 锁仓用户的 snapshot 余额 = free balance + lockedShares（通过 `lockedSharesOfAt` 查历史）
5. **锁仓用户需先 unlock/earlyExit 才能 burn 实际 ERC20 shares**；snapshot 权益存在但 free balance 不足时 revert `InsufficientFreeBalance`

**7. EmergencyExit 是否影响 RWT / rebate / points**

**不影响**。LockRewardManagerV02 的 pause 与 Vault 的 EmergencyExit 是独立的。EmergencyExit 下：

- RWT 仍在用户钱包，不自动收回
- Rebate 计算基于时间，时钟继续走（LockRewardManager 未暂停）
- 如果用户 earlyExit，仍需返还 RWT

---

## 八、Beneficiary / GovernanceSignal

**1. BeneficiaryModuleV02 已实现函数**

| 函数 | 说明 |
|---|---|
| `setHeartbeat()` | 重置 inactivity timer（任何人对自己） |
| `designateBeneficiary(beneficiary)` | 指定受益人（默认=自己） |
| `executeClaim(originalOwner, lockId)` | 受益人触发，满足 inactivity 条件后转移锁仓所有权 |
| `adminMarkInactive(user)` | admin 强制标记为 inactive |
| `adminUnmarkInactive(user)` | admin 取消标记 |
| `claimableLockIds(owner)` | view：返回可被 claim 的锁仓列表 |
| `isClaimable(owner, lockId)` | view：单锁是否可被继承 |

**2. 前端是否已接入**

是。`frontend/src/pages/Beneficiary.tsx` 存在，且 ABI 中包含 `BeneficiaryModule_ABI`。

**3. GovernanceSignalV02 已实现函数**

- `createProposal(proposalType, description, value)` — 需持有 ≥ votingThreshold RWT
- `castVote(proposalId, inFavor)` — RWT 持有量快照投票
- `finalizeProposal(proposalId)` — 结束投票期后任何人可调用
- `expireProposal(proposalId)` — 过期处理
- `setVotingThreshold(newThreshold)` / `setVotingPeriod(newPeriod)` — admin 参数

**4. 前端是否已接入**

是。`frontend/src/pages/Governance.tsx` 存在。

**5. 是否有测试**

有：`GovernanceSignal.test.ts`、`Beneficiary.test.ts`

---

## 九、前端当前实现

**1. 页面 / 组件清单**

页面（pages/）：Dashboard, DepositRedeem, Lock, Positions, Beneficiary, Governance, Claim, Community

组件（components/）：AdminConsole, BeneficiarySection, DaoBridgeSection, DemoStateSection, FeeRulesSection, IncentiveSection, LimitationsPanel, LockRow, LockSection, MetricsBar, RwtRulesSection, StateSection, StrategySection, VaultSection, WalletSection, YieldSection

**2. 显示 RWT / RewardToken / token reward / claim RWT 的位置**

| 位置 | 内容 |
|---|---|
| `Lock.tsx:148` | "receive upfront RWT and fee discounts" |
| `Lock.tsx:225` | "Upfront RWT" label，`fmtRwt(previewRwt)` |
| `Lock.tsx:238` | "Warning: Early exit requires returning RWT." |
| `Lock.tsx:244` | "Early exit is possible but requires returning issued RWT." |
| `Positions.tsx:195` | "Issued RWT" label，`fmtRwt(issuedRwt)` |
| `Positions.tsx:210` | "Early exit: must return X in RWT" |
| `Positions.tsx:256` | confirm 弹窗 "must return X in RWT" |
| `RwtRulesSection.tsx` | 整个组件标题"RWT Rules"，所有规则文字 |
| `IncentiveSection.tsx` | "RWT Balance"，说明文字 |
| `FeeRulesSection.tsx` | "RWT Multiplier" 列 |

**3. 显示 rebate 的位置**

- `Positions.tsx:199` — "Pending Rebate" + claimRebate 按钮
- `FeeRulesSection.tsx` — Lock Discount & Fee Rebate 规则
- `IncentiveSection.tsx` — "Fee Rebate" 说明

**4. 显示 lock tier 的位置**

- `Lock.tsx` — 三 tier 选择按钮（Bronze/Silver/Gold）
- `Positions.tsx` — `tierBadge(tier)` 显示
- `FeeRulesSection.tsx` — tier 折扣表格

**5. 显示 admin 功能的位置**

`components/AdminConsole.tsx` — 独立组件，包含 Vault 管理操作

**6. bigint 转 Number 的风险**

`Lock.tsx:53`：

```js
BigInt(Math.round(parseFloat(sharesInput) * 1e18))
```

`parseFloat` + `Math.round` + `* 1e18` 存在精度丢失风险。当输入超过 `Number.MAX_SAFE_INTEGER`（约 9e15）时结果不准确。锁仓 shares 是 18 位小数，1000 fbUSDC = 1e21，远超安全整数范围。**这是一个已存在的精度 Bug。**

**7. deposit / redeem / lock / early exit 是否有 loading guard**

- Lock.tsx：有，`step` 状态机（idle/approving/approve-wait/locking/lock-wait/done/error），busy 时 button disabled ✅
- Positions.tsx：有，`rebaseStep / unlockStep / exitStep` 各自独立状态机，busy 时 disabled ✅
- DepositRedeem.tsx：文件存在，预计有类似实现

**8. EmergencyExit / Claim 页面**

`pages/Claim.tsx` 存在，为 EmergencyExit 场景的 claimExitAssets UI。

**9. Beneficiary / GovernanceSignal 页面**

`pages/Beneficiary.tsx` 和 `pages/Governance.tsx` 均存在。

**10. 当前 .env 需要的合约地址**

无需在 `.env` 中配置合约地址（地址硬编码在 `frontend/src/contracts/addresses.ts`）。.env 控制的是后端/脚本侧：私钥、RPC URL、Basescan API key、admin/guardian/treasury 角色地址。

---

## 十、测试现状

**1. 当前测试文件清单**（29 个）

```
FundVault.test.ts                Phase2_RolesAndRebalance.test.ts
Phase3_VaultAccounting.test.ts   Phase4_StrategyBoundary.test.ts
Phase4_Timelock.test.ts          Phase5_Allowlist.test.ts
LockLedger.test.ts               LockBenefit.test.ts
LockRewardManager.test.ts        EarlyExit.test.ts
LockPoints.test.ts               SafetyMode.test.ts
EmergencyExit.test.ts            ExitRound.test.ts
Phase_C_ExitProtection.test.ts   ClaimLedger.test.ts
Beneficiary.test.ts              UserState.test.ts
Metrics.test.ts                  RewardToken.test.ts
GovernanceSignal.test.ts         MerkleRewardsDistributor.test.ts
StrategyManager.test.ts          DummyStrategy.test.ts
AaveV3Fork.test.ts               Step3_LiveRun.test.ts
Integration.test.ts              SecurityBoundary.test.ts
Accounting.test.ts
```

**2. Vault 测试覆盖**

FundVault.test.ts + Phase2~5：deposit/redeem/allowlist/pause/mode切换/管理费/rebalance/reserve band/Timelock权限/AccountingAccuracy

**3. Lock / RWT / Rebate 测试覆盖**

LockLedger、LockRewardManager、EarlyExit：lock 创建/解锁/提前退出/RWT 发放/rebate 结算/强制退出两步授权/permit 路径

**4. Treasury 测试覆盖**

无专门 Treasury 测试（Treasury 是 EOA，无合约逻辑）。Treasury 相关行为在 LockRewardManager 测试中作为 fixture 配置。

**5. EmergencyExit / ClaimLedger 测试**

EmergencyExit.test.ts、ExitRound.test.ts、Phase_C_ExitProtection.test.ts、ClaimLedger.test.ts

**6. 前端测试**

**无自动化前端测试**。无 vitest/jest 配置，无 .test.tsx 文件。前端测试依赖手动验证。

**7. 测试是否全部通过**

Step3_LiveRun.test.ts 是 Base mainnet fork 集成测试，依赖环境变量和 RPC。AaveV3Fork.test.ts 同理。其余单元测试在最近提交时均通过（参考 b65d1c3 commit 消息）。

---

## 十一、部署现状

**1. Base Mainnet 已部署合约地址**

| 合约 | 地址 |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| FundVaultV01 | `0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54` |
| RewardToken | `0xeAb54e7cFbE5d35ea5203854B44C8516201534A9` |
| LockLedgerV02 | `0x2D95517Cc375ab2dc6433fd44A8706462A418a89` |
| LockBenefitV02 | `0x083C50F9996b8E1389eB4506e24A2A22Df2C6e1c` |
| LockRewardManagerV02 | `0xb29DeFCF75f71bc4DaFaA353cE294C284F5e07cB` |
| BeneficiaryModuleV02 | `0x0dA3955C58D3252012A76D5CC01E9cc4dfF05C00` |
| UserStateEngineV02 | `0x083A92c65A7f586Bc7B8D3D24EE831C217298e18` |
| MetricsLayerV02 | `0x1C4Ba691688db06a63AfCde29FF377394BF530F1` |
| GovernanceSignalV02 | `0x9BE5636943d7BfF57ACA6047Cf945FD770CcC7d0` |
| ClaimLedger | `0x5CF9b8EC75314115EDDE5Dd332C193995Dd55234` |

**2. 当前部署脚本**

- `scripts/deploy.ts` — V01 全套（Vault + Strategy + ClaimLedger 等）
- `scripts/v2/deploy_v2.ts` — V02 模块（RewardToken + Lock 系统）
- `scripts/v2/setup_v2.ts` — 部署后 role grant + treasury approve 配置
- `scripts/v2/treasury_approve.ts` — 单独设置 treasury allowance
- `scripts/v2/deploy_v2_remaining.ts` — 补充部署剩余 V2 模块
- `scripts/v2/redeploy_lock_reward_manager.ts` — 单独重部署 LockRewardManager

**3. 是否有新部署脚本模板**

**无**。没有专门为 closed beta 新部署准备的脚本，需新建。

**4. 当前权限归属**

| 角色 | 当前持有者 |
|---|---|
| DEFAULT_ADMIN_ROLE（Vault） | Timelock 合约（`0x054C…`） |
| EMERGENCY_ROLE（Vault） | Guardian EOA |
| OPERATOR_ROLE（LockLedger） | LockRewardManagerV02 |
| DEFAULT_ADMIN_ROLE（LockLedger） | Timelock（推测） |
| DEFAULT_ADMIN_ROLE（LockRewardManager） | Timelock（推测） |
| EMERGENCY_ROLE（LockRewardManager） | Guardian EOA |
| VAULT_ROLE（ClaimLedger） | **未确认是否已 grant** |

**5. Timelock 是否持有核心 admin**

是。`transfer_admin_to_timelock.ts` 脚本已执行（Basescan：`0x054Cb2c32D6062B291420584dE2e5952C372cDD6`）。Vault 的 DEFAULT_ADMIN_ROLE 由 Timelock 持有。

**6. 新部署需要替换的地址和环境变量**

合约侧：全部 V02 模块地址（LockLedger、LockBenefit、LockRewardManager、RewardToken）会变。

前端 `frontend/src/contracts/addresses.ts` 中对应地址全部更新：

```
RewardToken, LockLedgerV02, LockBenefitV02, LockRewardManagerV02
```

（FundVaultV01 若不重部署则不变）

---

## 十二、差异清单

### A. 已符合的部分

| 规则 | 符合情况 |
|---|---|
| 规则 4：提前退出先扣 Points 再返还 fbUSDC | ✅ `earlyExitWithReturn` 结构完全符合：先结算 rebate → 收回 RWT → 释放 shares |
| 规则 5：Rebate 名称保留，closed beta 继续启用 | ✅ rebate 逻辑完整，独立于 RWT 命名 |
| 规则 6：管理费折扣规则不变 | ✅ `LockBenefitV02` 无需修改 |
| 规则 8：不新增 slash 机制 | ✅ 当前无任何 slash 逻辑 |
| 规则 9：Treasury 不控制用户本金 | ✅ Vault 持有 USDC，Treasury 仅持有管理费 shares |

### B. 不符合的部分

| 规则 | 当前状态 | 差距 |
|---|---|---|
| 规则 2：前端全部表述为 Points | ❌ 前端全部显示 RWT | 约 12 处文字/变量需改 |
| 规则 2：链上记录也改为 Points | ❌ 合约变量名为 `issuedRewardTokens`，token 名为 RWT | 需新部署合约，rename |
| 规则 3：Points 只有一种余额 | ⚠️ `issuedRewardTokens` 是单一值，符合；但 lock settled 后 cleared 为 0，需确认展示逻辑 | 基本符合，前端 display 逻辑需验证 |
| 规则 7：管理费率改为原来的一半 | ❌ 当前 9 bps/月，需改为 4 bps/月 | admin 参数改，无需改合约 |
| 规则 10：使用新部署方向 | ❌ 当前无新部署脚本 | 需创建 closed beta 部署脚本 |

### C. 必须修改的文件

| 文件 | 改动类型 | 原因 |
|---|---|---|
| `contracts/LockRewardManagerV02.sol` | 重命名变量/事件，新合约 | `issuedRewardTokens` → `issuedPoints`，接口同步 |
| `contracts/RewardToken.sol` | 无代码改动，新部署传不同 name/symbol | token 名从"RWT"改为"Points"或保持中性命名 |
| `contracts/interfaces/ILockRewardManagerV02.sol` | 同步接口 | 变量名/事件名同步 |
| `frontend/src/pages/Lock.tsx` | 文字替换 + 修复 preview 公式 bug | RWT→Points，分母 `50`→`500` |
| `frontend/src/pages/Positions.tsx` | 文字替换 | "Issued RWT"→"Points"，"return RWT"→"forfeit Points" |
| `frontend/src/components/RwtRulesSection.tsx` | 重写 | 整体重命名为 PointsRulesSection |
| `frontend/src/components/IncentiveSection.tsx` | 文字替换 | RWT Balance → Points Balance |
| `frontend/src/components/FeeRulesSection.tsx` | 文字替换 | RWT Multiplier → Points Multiplier |
| `frontend/src/utils.ts` | rename + fix | `fmtRwt` → `fmtPoints` |
| `frontend/src/contracts/addresses.ts` | 地址更新 | 新部署后更新 4 个合约地址 |
| `frontend/src/contracts/abis.ts` | ABI 同步 | 如事件名/函数名变更则同步 |
| `scripts/config.ts` | 参数调整 | `mgmtFeeBpsPerMonth: 9 → 4` |

### D. 推荐修改的文件

| 文件 | 建议 |
|---|---|
| `Lock.tsx:53` | 修复 bigint 精度 bug（`parseFloat * 1e18`），改用字符串解析 |
| `scripts/v2/deploy_v2.ts` | 基于此创建 `scripts/closed_beta/deploy_beta.ts`，固定 mgmtFee=4 |
| `scripts/v2/setup_v2.ts` | 创建对应 `setup_beta.ts`，包含 treasury approve + allowlist 配置 |

### E. 不建议修改或暂缓的部分

| 项目 | 原因 |
|---|---|
| `FundVaultV01.sol` | 主 Vault 逻辑成熟，mgmtFee 通过 admin 参数改，不改合约 |
| `LockBenefitV02.sol` | tier/multiplier/discount 规则不变，不需要修改 |
| `LockLedgerV02.sol` | 锁仓账本逻辑稳定，直接复用 |
| `LockPointsV02.sol` | 已 Deprecated，不在 closed beta 中使用，不部署 |
| `GovernanceSignalV02.sol` | closed beta 阶段暂缓，不影响主流程 |
| `MerkleRewardsDistributorV01.sol` | closed beta 不涉及 Merkle 分发 |
| `ClaimLedger.sol` | 保留现有部署，VAULT_ROLE 授权问题单独处理 |
| `BeneficiaryModuleV02.sol` | 逻辑无需改动，可直接复用 |

### F. 新部署前的阻塞项

| 阻塞项 | 严重程度 | 说明 |
|---|---|---|
| **前端 RWT preview 公式 bug** | 🔴 高 | `Lock.tsx:79` 分母 `50` 应为 `500`，preview 显示为实际的 10 倍，会严重误导用户 |
| **缺少 closed beta 部署脚本** | 🔴 高 | 没有现成脚本，需新建，且需包含 mgmtFee=4 的 setParam 步骤 |
| **RWT → Points 前端全量替换** | 🔴 高 | 规则 2 强制要求，不改不能上线 |
| **管理费率调整（9→4 bps）** | 🔴 高 | 规则 7，需通过 Timelock 调度，有时间延迟，需提前安排 |
| **Treasury EOA approve 额度重新配置** | 🟡 中 | 新合约地址后，Treasury 需对新 LockRewardManager 重新 approve RWT 和 fbUSDC |
| **ClaimLedger VAULT_ROLE 是否已授权** | 🟡 中 | 需链上核查，否则 EmergencyExit 路径中 ClaimLedger 不可用 |
| **LockLedger OPERATOR_ROLE grant 给新 LockRewardManager** | 🔴 高 | 新合约部署后必须重新 grant，否则 lockFor 会 revert |
| **Allowlist 新地址迁移** | 🟡 中 | 新 Vault 部署（若 Vault 也重部署）需重新 add allowlist |
| **前端 bigint 精度 bug** | 🟡 中 | 精度问题在大额输入时会出现，建议在新部署前修复 |
