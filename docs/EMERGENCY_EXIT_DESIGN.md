# Emergency Exit 设计说明

状态：Phase 2 验收产出（含 patch1 更新），设计决策记录
生成时间：2026-04-01
关联规范：fd/STEP1_FINALIZED_SPEC_CN.md §3

---

## 一、设计思路

### 快照机制定位（Phase 2 patch1 更新）

快照（ERC20Snapshot + LockLedger 历史查询）在 `openExitModeRound()` 时拍摄，目的是：

1. **防止抢先买入**：EmergencyExit 宣布后，外部地址不得通过购入 fbUSDC 来占据分配份额
2. **兼顾所有用户（含锁仓用户）**：快照捕获 totalEconomicShares = 自由流通 fbUSDC（ERC20 balance）+ LockLedger 中锁仓 fbUSDC，确保所有经济权益都被纳入

快照口径由"仅 ERC20 余额"扩展为"totalEconomicShares"，不再要求锁仓用户在快照之前先完成解锁。

---

### 锁仓用户的退出路径（Phase 2 patch1 新设计）

快照包含锁仓 shares 后，锁仓用户路径如下：

```
admin openExitModeRound()
    ↓ 快照拍摄（totalEconomicShares 纳入，含锁仓 fbUSDC）
lock 用户（已有快照分配额度）
    ↓
earlyExitWithReturn()
    ├─ 归还全部 issuedRewardTokens[lockId] 的 RWT
    ├─ 已形成的 rebate 自动结算（shares 转入用户）
    └─ LockLedger 释放 fbUSDC 份额给用户
    ↓
用户持有 fbUSDC（自由余额增加）
    ↓
claimExitAssets(roundId, sharesToBurn) → 按快照比例领取 USDC
```

**核心顺序：纳入快照 → 足额归还 RWT → 取回 fbUSDC → claimExitAssets**

- 快照时用户的锁仓 shares 已计入分配额度（lockedSnapshotBalance）
- 用户必须先完成 earlyExitWithReturn 取回 fbUSDC，才能在 claimExitAssets 中实际 burn 这些 shares
- 分母（snapshotTotalSupply）保持不变，即全部 ERC20 totalSupply（已包含 LockLedger 持有份额）

---

## 二、代码实现（Phase 2 patch1）

### 新增字段

| 合约 | 变更 | 说明 |
|------|------|------|
| `LockLedgerV02.LockPosition` | 新增 `uint64 endedAt` | 0 = 仍活跃；unlock/earlyExit 时设为 block.timestamp |
| `FundVaultV01.ExitRound` | 新增 `uint256 snapshotTimestamp` | 快照对应的 block.timestamp，供历史查询 |
| `FundVaultV01` | 新增 `address public lockLedger` | LockLedgerV02 地址；未配置时 lockedShares = 0 |

### 新增接口

| 函数 | 说明 |
|------|------|
| `ILockLedgerV02.lockedSharesOfAt(owner, timestamp)` | 返回 owner 在 timestamp 时刻的锁仓 shares 总量 |
| `FundVaultV01.setLockLedger(address)` | DEFAULT_ADMIN_ROLE 配置 LockLedger 地址 |

### claimExitAssets 逻辑变更

```
// 旧
snapshotBalance = balanceOfAt(user, snapId)

// 新
freeSnapshotBalance   = balanceOfAt(user, snapId)
lockedSnapshotBalance = lockLedger != 0 ? lockedSharesOfAt(user, snapshotTimestamp) : 0
snapshotBalance       = freeSnapshotBalance + lockedSnapshotBalance
```

---

## 三、正式执行顺序

| 步骤 | 执行方 | 操作 | 说明 |
|------|--------|------|------|
| 1 | admin | `setMode(EmergencyExit)` | 封锁新存款和常规 redeem；结算当前管理费 |
| 2 | admin | 从策略层回收资金：`manager.emergencyExit()` 或 `partialEmergencyExit()` | USDC 回到 vault |
| 3 | admin | `openExitModeRound(availableAssets)` | **快照拍摄**；totalEconomicShares 纳入（含锁仓用户） |
| 4 | lock 用户 | `earlyExitWithReturn(lockId)` | 归还全部 RWT → 取回 fbUSDC；已形成 rebate 同步结算 |
| 5 | 全体用户 | `claimExitAssets(roundId, sharesToBurn)` | 按快照比例领取 USDC；支持分批申领 |
| 6 | admin | `closeExitModeRound()` | 关闭当前轮 |
| 7 | admin（可选）| 重复步骤 2–6 | 若资产分批回收，可开多轮；每轮有独立快照 |
| 8 | admin（可选）| `setMode(Normal)` | 全部清算完成后恢复；EmergencyExit 期间不追溯管理费 |

> **注**：步骤 3 和步骤 4 顺序可互换。快照之后完成 earlyExitWithReturn 的用户，其额度已在快照中预留，取回 fbUSDC 后即可 claim。

---

## 四、已知风险与边界情况

### 快照后未完成 earlyExitWithReturn 的锁仓用户

- 快照已为其预留 lockedSnapshotBalance 额度
- 但无法 burn 任何 shares（free balance = 0）
- 完成 earlyExitWithReturn 后取回 fbUSDC，然后才能 claimExitAssets
- 若当前轮已关闭，可等下一轮（新快照重新计算额度）

### 不愿归还 RWT 的锁仓用户

- `earlyExitWithReturn` 的 RWT 归还检查仍然强制执行
- 用户无法绕过 RWT 归还直接取回 fbUSDC
- 其 fbUSDC 长期滞留 LockLedger，直至锁期自然到期（`unlock()` 无需归还 RWT）
- 锁期到期后 `unlock()` 取回 fbUSDC，再参与下一轮 openExitModeRound

### 锁期到期用户（非早退）

- 调用 `LockLedger.unlock()`（无需归还 RWT）→ 取回 fbUSDC
- 后续与非锁仓用户完全相同

### LockLedger 与 FundVaultV01 模式无自动联动

- LockLedger 的 pause 状态独立于 vault 的 systemMode
- EmergencyExit 期间，LockLedger 仍可操作（unlock / earlyExitFor）
- 若需冻结 LockLedger，admin 需单独调用 `LockLedger.pause()`

---

## 五、代码层面的运营顺序未作强制约束

以下情况代码**不会阻止**，依赖 admin 正确执行：

- admin 在资金尚未从策略回收完毕时就开 round（→ availableAssets 可能低于实际可分配量）
- lock 用户在 claimExitAssets 前未完成 earlyExitWithReturn（→ burn 会因 free balance 不足而 revert）

**这两点均为已知运营风险，需在 admin 操作手册中明确。**

---

## 六、待补充（Phase 5）

- [ ] 补充专项测试：lock 用户在 earlyExitWithReturn 之前 free balance = 0，claimExitAssets 因 burn 失败而 revert
- [ ] 补充专项测试：lock 用户完成 earlyExitWithReturn 后，可正常 claimExitAssets 至 lockedSnapshotBalance 上限
- [ ] 补充专项测试：锁期自然到期 → unlock → 参与下一轮 exit round（快照重新纳入）
