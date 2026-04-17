# V2 Limitations & V3 Fix Notes

> This document records known V2 limitations that are intentional design choices for the demo build,
> and the recommended V3 resolution for each.

---

## Critical V2 Limitations (Must Know Before Demo)

### [V2-L1] Beneficiary inherits locked positions only — free fbUSDC is NOT transferred on-chain

`BeneficiaryModuleV02.executeClaim()` transfers ownership of **locked positions only**.
The original owner's free fbUSDC wallet balance is **not touched** on-chain.

What happens on-chain during `executeClaim`:
- Each active `LockPosition.owner` field is updated to the beneficiary address
- A `BeneficiaryClaimed` event is emitted recording the intent for free balance
- No `vault.transfer()` or `transferFrom()` is called for free shares

**Demo implication:** When Scene C runs, the beneficiary (Bob) receives the lock position and can unlock at maturity. Any free fbUSDC that carol holds stays in carol's wallet. The demo script must not display carol's free balance as "inherited" unless a manual transfer is shown.

**V3 fix:** See [BEN-02] below.

---

## [BEN-01] userStateOf stale after lock inheritance

**模块**：`UserStateEngineV02` + `BeneficiaryModuleV02`

**现象**：
`executeClaim` 执行后，原用户（originalOwner）的 `userStateOf` 仍返回
`LockedAccumulating`，即使其资产权利已全部转移给 beneficiary。

**根因**：
- `transferLockOwnership` 刻意不修改 `_userLockIds`（保证 points 留存原用户）
- `UserStateEngineV02.userStateOf` 遍历 `userLockIds(owner)`，推导状态时
  不校验 `pos.owner == owner`
- 结果：lockId 仍在 carol 的列表里，引擎看到 `pos.unlocked = false` → LockedAccumulating

**影响范围**：
- 前端 StateSection / DemoStateSection 已直接展示 `userStateOf` 结果。执行 `executeClaim` 后，原用户的 state 可能在 UI 中仍显示为 LockedAccumulating，影响 reviewer 对该地址状态的解读
- 资产会计（totalAssets / NAV / shares）完全不受影响
- bob 正常 unlock 不受影响

**V3 修复方向（二选一）**：

方案 A — 引擎层过滤（推荐，改动最小）：
```solidity
// UserStateEngineV02.userStateOf
for (uint256 i = 0; i < ids.length; i++) {
    ILockLedgerV02.LockPosition memory pos = ledger.getLock(ids[i]);
    if (pos.owner != owner) continue;  // 跳过已转移的仓位
    // ... 原有状态推导逻辑
}
```

方案 B — 账本层同步（改动较大）：
`transferLockOwnership` 同步将 lockId 从 `_userLockIds[oldOwner]` 移除并加入
`_userLockIds[newOwner]`。需同步处理 points 归属（引入独立 points 快照或
冻结机制），避免 points 随 ownership 迁移。

---

## [BEN-02] free assets not transferred on-chain (V2 scope)

**模块**：`BeneficiaryModuleV02`

**现象**：
`executeClaim` 只转移 locked 仓位，钱包里的 free fbUSDC 不做链上转移，
仅通过 `BeneficiaryClaimed` 事件记录意图。

**V3 修复方向**：
- 要求 originalOwner 提前 `approve` fbUSDC 给 BeneficiaryModule
- `executeClaim` 时读取余额，`safeTransferFrom(originalOwner, beneficiary, balance)`
- 需考虑 approve 失效场景（用户撤销 approve 后 claim 会 revert）

---

## [BEN-03] Merkle claim forwarding not implemented (V2 scope)

**模块**：`BeneficiaryModuleV02` + `MerkleRewardsDistributorV01`

**现象**：
beneficiary 继承后，originalOwner 在 Merkle 快照中的奖励无法由 beneficiary 直接领取，
需 admin 手动处理或重新生成快照。

**V3 修复方向**：
- `MerkleRewardsDistributorV01` 引入 delegate/forward 映射
- `BeneficiaryClaimed` 事件触发快照脚本将后续 epoch 的份额重定向至 beneficiary
- 或：在快照生成脚本（`build_merkle.ts`）中检查 `BeneficiaryClaimed` 事件，
  自动将 originalOwner 份额归入 beneficiary 地址

---

## [VAULT-01] externalTransfersEnabled 开关冗余 — 下个版本移除

**模块**：`FundVaultV01`

**现象**：`transferToStrategyManager()` 有一个独立的 `externalTransfersEnabled` 布尔开关，
默认 `false`，需要 admin 手动调用 `setExternalTransfersEnabled(true)` 才能开启资金出库路径。

**设计原意**：部署安全门——合约上线初期防止资金意外流向策略，确认 Vault 逻辑验证完毕后再显式开启。

**实际问题**：该开关与已有的多重保护（`systemMode`、`reserveRatioBps`、70% 硬上限）存在职责重叠，
增加了运营摩擦，且对安全性的增量贡献极低。

**V3 修复方向**：
- 从 `FundVaultV01` 合约中移除 `externalTransfersEnabled` 状态变量及相关函数
- 依赖 `systemMode == Normal`、reserve ratio 检查、70% 硬上限作为唯一约束
- Admin 页面同步移除 Enable/Disable 按钮
