# V2 合约复查报告：GovernanceSignalV02 / BeneficiaryModuleV02 / ClaimLedger

**复查日期：** 2026-04-06
**复查范围：** 会计口径、逻辑正确性、实现缺口
**结论摘要：** GovernanceSignalV02 可部署；BeneficiaryModuleV02 等设计确认；ClaimLedger 有实现缺口需修复

---

## 一、GovernanceSignalV02

### 结论：✅ 可部署

### 逻辑口径

| 检查项 | 结果 |
|---|---|
| 快照时机：`createProposal` → `snapshot()` → `castVote` 读 `balanceOfAt(snapshotId)` | ✅ 正确，防双投 |
| 状态机：Active → Succeeded / Defeated | ✅ 完整 |
| 合约隔离：无资产、无协议角色、无执行路径 | ✅ 完全隔离 |
| `abstainVotes` 不影响结果，仅做透明记录 | ✅ 符合设计 |
| `votingPowerOf` 返回当前余额（非快照值） | ✅ 有注释说明，非缺陷 |

### 轻微问题（前端消费层注意）

`resultOf` 在提案仍处于 Active 状态时可被查询，会提前返回当前累计票数的 `passed` 值。
合约本身逻辑没错；前端在展示结果前需先检查 `stateOf(proposalId) != Active`，否则会误导用户。

### 会计影响

无。此合约不持有任何资产，不具备任何协议角色，不对 Vault / LockLedger / RewardManager 产生任何会计影响。

---

## 二、BeneficiaryModuleV02

### 结论：⚠️ 等待设计确认后可部署

### 逻辑口径

| 检查项 | 结果 |
|---|---|
| `isInactive`：时间计时 ≥ 365 天 OR adminMarked | ✅ 正确 |
| `_claimed` 防止重复 claim | ✅ 正确 |
| `beneficiaryOf` 未设时返回 `user` → `executeClaim` revert | ✅ 行为正确 |
| Lock 所有权转移通过 `LockLedger.transferLockOwnership()` | ✅ 正确 |
| 自由 fbUSDC 仅记事件，不做链上转移 | ✅ 符合设计（非侵入性） |
| 积分永远不转移，留在 originalOwner | ✅ 符合设计 |

### 需确认的设计风险 #1：incomplete lockIds

`executeClaim` 由受益人自行提供 `lockIds[]`。

**问题路径：**
1. 受益人提供不完整的 lockIds（漏掉部分锁仓）
2. `_claimed[originalOwner] = true` **已永久置位**
3. 剩余锁仓无法再次发起 claim
4. 剩余锁仓永远留在失活 originalOwner 名下，无法解锁、无法转移

**是否接受：** 待用户确认。

如接受，需在外部文档中明确写明：受益人在执行 claim 前须通过 `LockLedger.userLockIds(originalOwner)` 查询全部 lockId，一次性提交完整列表。

### 需确认的设计选择 #2：`_lastActiveAt = 0` 的用户

从未调用过 `heartbeat` 的用户，`_lastActiveAt = 0`，时间计时永远不启动，无法通过时间维度触发 isInactive。

只能通过 `adminMarkInactive` 覆盖。

**是否接受：** 属故意设计（避免对从未主动参与的用户启动倒计时），但需在文档中说明：用户须至少调用一次 `heartbeat` 才能激活自己的继承保护计时器。

### 会计影响

无资产转移，不影响 Vault NAV、Share 供应量或任何会计口径。仅发生 Lock 所有权转移（LockLedger 层）。

---

## 三、ClaimLedger

### 结论：❌ 有实现缺口，建议修复后再部署

### 问题：`settleClaim` 不校验受益人

**现状：** `ClaimRecord` struct 未存储受益人地址：

```solidity
struct ClaimRecord {
    uint256 roundId;
    address assetType;
    uint256 nominalAmount;
    bool settled;
    // ← 缺少 address beneficiary
}
```

`settleClaim(claimId, beneficiary)` 接受任意 `beneficiary` 参数，但不对其做链上验证，仅将其写入事件：

```solidity
function settleClaim(uint256 claimId, address beneficiary) external onlyRole(VAULT_ROLE) {
    // 未校验 beneficiary 是否与 issueClaim 时的接收方一致
    c.settled = true;
    emit ClaimSettled(claimId, beneficiary);
}
```

**实际影响：**
- VAULT_ROLE 调用方可对任意有效 claimId 传入任意地址，触发 `ClaimSettled` 事件
- 无法从链上反查"claimId X 归属于谁"（`_userClaimIds` 为 private，仅支持正向查询）
- 在 VAULT_ROLE 为可信方的前提下，短期风险可控；但属实现不完整，不符合台账语义

**建议修复：**

在 `ClaimRecord` 中增加 `address beneficiary` 字段，`settleClaim` 中增加校验：

```solidity
struct ClaimRecord {
    uint256 roundId;
    address assetType;
    uint256 nominalAmount;
    address beneficiary;   // ← 新增
    bool settled;
}

function settleClaim(uint256 claimId, address beneficiary) external onlyRole(VAULT_ROLE) {
    ClaimRecord storage c = claims[claimId];
    if (c.nominalAmount == 0) revert NotFound();
    if (c.settled) revert AlreadySettled();
    if (c.beneficiary != beneficiary) revert WrongBeneficiary();  // ← 新增校验
    c.settled = true;
    emit ClaimSettled(claimId, beneficiary);
}
```

同时需在 `issueClaim` 中将 `beneficiary` 写入 struct：

```solidity
claims[claimId] = ClaimRecord(roundId, assetType, nominalAmount, beneficiary, false);
```

### 会计影响

ClaimLedger 不持有任何资产，不影响 Vault NAV。修复为纯台账完整性问题。

---

## 总结

| 合约 | 结论 | 阻断项 |
|---|---|---|
| GovernanceSignalV02 | ✅ 可部署 | 无；前端消费注意 Active 态结果展示 |
| BeneficiaryModuleV02 | ⚠️ 等设计确认 | incomplete lockIds 行为 + last=0 计时策略 需用户确认 |
| ClaimLedger | ❌ 建议修复 | `settleClaim` 缺少 beneficiary 校验；`ClaimRecord` 缺少 beneficiary 字段 |

---

*本文件为部署前复查记录，结论由代码静态分析得出。修复完成后重新确认再推进部署。*
