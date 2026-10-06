# ACCOUNTING_NOTES — V2 会计接触面审查

*文档版本：v1.0 | 日期：2026-03-28 | 审查范围：V2 模块对 FundVaultV01 的接触面*

---

## 审查范围

本文档审查 V2 新增模块（LockLedgerV02 / LockRewardManagerV02）对 FundVaultV01 会计的影响。
V1 内部会计（StrategyManagerV01 / MerkleRewardsDistributorV01）不在本次范围内。

---

## 1. 风险审查摘要

**结论：三条 V2 接触路径均不破坏 vault 会计。**

核心依据：三条路径全部是纯 ERC20 `transfer` / `transferFrom` 操作，不涉及 vault 的 `deposit` / `withdraw` / `mint` / `redeem`。因此：

| 不变量 | 结论 |
|---|---|
| `vault.totalAssets()` | 三条路径均不变（无 USDC 进出 vault） |
| `vault.totalSupply()` | 三条路径均不变（无 shares 增发/销毁） |
| `pricePerShare` (NAV) | totalAssets 和 totalSupply 均不变，NAV 稳定 |
| `ledger.totalLockedShares()` | lock 时增加，earlyExit / unlock 时减少，始终与 ledger 实际持有量一致 |
| `nextLockId` | 仅递增，earlyExit 和 unlock 均不回退，可安全用作历史累计计数 |

---

## 2. 三条路径会计流向

### 2.1 lockWithReward

```
alice (vault shares)  --[transferFrom]--> LockLedger (vault shares)
treasury (rwToken)    --[transferFrom]--> alice (rwToken)
```

- `vault.totalAssets()` 不变（USDC 在 vault 中未移动）
- `vault.totalSupply()` 不变（无 shares 增发）
- `vaultShares.balanceOf(alice)` 减少 `shares`
- `vaultShares.balanceOf(address(ledger))` 增加 `shares`（守恒）
- `ledger.totalLockedShares()` 增加 `shares`

### 2.2 claimRebate

```
treasury (vault shares)  --[transferFrom]--> alice (vault shares)
```

- `vault.totalAssets()` 不变
- `vault.totalSupply()` 不变
- `vaultShares.balanceOf(treasury)` 减少 `rebateShares`
- `vaultShares.balanceOf(alice)` 增加 `rebateShares`（守恒）
- rebate 金额上限 = `shares × mgmtFeeBps × discountBps × duration / (BPS² × SECONDS_PER_MONTH)`

### 2.3 earlyExitWithReturn

原子操作（三步顺序执行）：

```
1. treasury (vault shares)  --[transferFrom]--> alice          (rebate 结算)
2. alice (rwToken)          --[transferFrom]--> treasury       (token 归还)
3. LockLedger (vault shares)--[transfer]    --> alice          (本金归还)
```

- `vault.totalAssets()` 不变
- `vault.totalSupply()` 不变
- rebate 只结算到 `effectiveNow = min(block.timestamp, unlockAt)`，不会超出锁仓期范围
- `ledger.totalLockedShares()` 减少 locked amount（恢复为 0 若该仓位为最后一个）
- `issuedRewardTokens[lockId]` 清零（标记该仓位已终止）

---

## 3. 发现的问题清单

### P0 — 无结构性会计冲突

三条路径均经过测试验证（`test/Accounting.test.ts`，23 tests 全通过），未发现 totalAssets / totalSupply / NAV 被破坏的情形。

### P1 — 需关注的边界情况（非 bug，但需运营注意）

| 编号 | 描述 | 影响 | 建议 |
|---|---|---|---|
| A-01 | rebate 来源是 treasury 持有的 vault shares，treasury shares 耗尽时 claimRebate revert | 用户无法领取已应得 rebate | 运营层面确保 treasury 持有足量 fbUSDC shares |
| A-02 | earlyExitWithReturn 先结算 rebate 再归还 token，两步之间 treasury shares 需足量 | 若 treasury shares 不足，earlyExit 在 rebate 步骤 revert，而非在 token 归还步骤 | 同 A-01 |
| A-03 | `staticCall` 预测的 rebate 与实际执行时略有差异（跨区块 timestamp 漂移） | 精确的前后差额断言不可靠 | 测试层面用"实际转出量 = 实际收入量"替代"预测量 = 差额" |

### P2 — 已记录、无需修改的设计决策

| 编号 | 描述 |
|---|---|
| D-01 | `nextLockId` 是追加计数器（等于 `totalLocksEver`），不表示当前活跃数；活跃数需由 `activeLockCount` 或脚本迭代获取 |
| D-02 | rewardToken 从不经过 LockRewardManagerV02 持有，始终 treasury → user 或 user → treasury 直转，合约不持仓 |
| D-03 | rebate 计算中 `effectiveNow = min(block.timestamp, unlockAt)`，到期后时间冻结，多次调用不累积 |

---

## 4. 补充测试

`test/Accounting.test.ts` 新增 23 个会计不变量测试，按 4 组组织：

| 组 | 覆盖路径 | 测试数 |
|---|---|---|
| Group 1 | lockWithReward | 6 |
| Group 2 | claimRebate | 6 |
| Group 3 | earlyExitWithReturn | 7 |
| Group 4 | nextLockId append-only | 4 |

核心断言模式：
- `totalAssets` before == after
- `totalSupply` before == after
- 转出方减少量 == 转入方增加量（shares 守恒）
- `nextLockId` 仅递增，exit / unlock 不回退

---

## 5. 不在 D12 范围内的问题

以下类型问题若在审查中发现，不在本轮修改范围，需另行决断：

- 需改 FundVaultV01 / StrategyManagerV01
- 影响现有奖励公式或结算口径
- 影响 LockLedgerV02 / LockRewardManagerV02 状态结构
- 触发大面积测试重写

---

*审查结论：V2 模块以薄层方式接触 vault，三条接触路径的会计口径正确，测试覆盖充分。*
