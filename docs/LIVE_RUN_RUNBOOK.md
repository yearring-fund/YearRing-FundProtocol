# LIVE_RUN_RUNBOOK.md — Step3 异常处置 SOP

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）

---

## 0. 通用原则

1. **先停后查**：任何异常第一步先暂停入口（`emergency_pause.ts`），再调查，再决定是否恢复
2. **退出优先**：任何情况下优先保障用户 redeem 路径可用（非极端情况不暂停 redeems）
3. **双人确认**：资金相关操作（invest / divest / emergencyExit）操作前需两人确认
4. **记录操作**：所有操作均需记录到 evidence 目录（脚本自动保存，手动操作补录）

---

## 1. 限额命中

### 1.1 单用户 per-user cap（2,000 USDC）命中

**现象**：`deposit.ts` 报错 `[LIMIT] Per-user cap exceeded`

**处置**：
1. 不需要暂停系统
2. 告知用户当前已达上限，无法继续存款
3. 如需调整上限，须由 ADMIN 修改 `deposit.ts` 中的 `PER_USER_CAP` 常量并同步更新 `LIVE_RUN_LIMITS.md`
4. 记录 evidence（`checkLimits.ts` 输出存档）

**注意**：per-user cap 是脚本层软限制，用户仍可 redeem，不影响退出

### 1.2 TVL cap（20,000 USDC）命中

**现象**：`deposit.ts` 报错 `[LIMIT] TVL cap exceeded`

**处置**：
1. 不需要暂停系统（链上 investCap 是更底层的防线）
2. 停止接受新存款请求
3. 运行 `checkSystemState.ts` 确认系统状态
4. 评估是否需要扩容：如需扩容，走参数变更流程（见 LIVE_RUN_OPERATIONS.md §三）
5. 记录 evidence

### 1.3 daily cap（5,000 USDC）命中

**现象**：`deposit.ts` 报错 `[LIMIT] Daily cap exceeded`

**处置**：
1. 当日不接受新存款
2. 次日 UTC 0:00 后，`daily_deposits.json` 自动重置
3. 无需任何链上操作

### 1.4 investCap（链上，20,000 USDC）命中

**现象**：`invest.ts` 报错 `CapExceeded`

**处置**：
1. 不影响 vault deposit 和 redeem
2. 暂停 invest 操作，等待 divest 回收空间或调高 investCap
3. 如调高 investCap：`scripts/step3/set_invest_cap.ts` + 同步 `LIVE_RUN_LIMITS.md`

---

## 2. Deposit 失败

### 2.1 非白名单地址尝试 deposit

**现象**：链上 revert `NotAllowed`

**处置**：
1. 正常的链上保护行为，无需处置
2. 如需添加白名单：`scripts/step3/allowlist_add.ts`
3. 记录请求与决策

### 2.2 白名单地址 deposit 失败（非权限）

**可能原因**：
- `depositsPaused = true` → ADMIN 执行 `unpauseDeposits()`
- `systemMode ≠ Normal` → ADMIN 执行 `setMode(0)`（需先确认异常已解除）
- 用户 USDC 不足 / approve 不足 → 用户侧问题
- gasLimit 不足 → 增大 gasLimit 重试

**处置**：
1. 运行 `checkSystemState.ts` 确认当前状态
2. 根据具体原因处置
3. 非预期 pause 须调查原因后再解除

### 2.3 Deposit 成功但 shares 为 0

**可能原因**：ERC4626 精度问题（极少量 USDC deposit 时）

**处置**：
1. 要求用户存款金额 ≥ 1 USDC（脚本层 `MIN_DEPOSIT_USDC` 保护）
2. 如已发生：检查 `vault.balanceOf(user)` 和 `vault.totalAssets()`，确认 USDC 未丢失

---

## 3. Withdraw / Redeem 失败

### 3.1 用户 redeem 失败

**最高优先级处置场景。**

**可能原因 A：`redeemsPaused = true`**
- 检查 `vault.redeemsPaused()`
- 如非预期：ADMIN 立即执行 `vault.unpauseRedeems()`
- 记录原因

**可能原因 B：`systemMode = EmergencyExit`**
- 正常行为：EmergencyExit 下 `redeem()` 被替换为 `claimExitAssets()`
- 告知用户使用 `claimExitAssets()` 路径
- 确认 ADMIN 已执行 `openExitModeRound()`

**可能原因 C：Vault 无足够 idle USDC（资金全部在策略中）**
- 检查 `vault.availableToInvest()` 和 vault idle
- ADMIN 执行 `divest()` + `returnToVault()` 撤回足够资金
- ERC4626 标准：`maxRedeem(user) ≤ vault.totalAssets()`，如 idle 不足且无法立即 divest，需评估

**处置流程**：
```
1. checkSystemState.ts → 确认 redeemsPaused / systemMode
2. 如 redeemsPaused：ADMIN unpauseRedeems（确认安全后）
3. 如 EmergencyExit：引导用户 claimExitAssets
4. 如 idle 不足：divest → returnToVault
5. 记录 evidence
```

---

## 4. NAV 异常

### 4.1 pricePerShare 突降（>5%）

**触发信号**：`checkSystemState.ts` 输出 pricePerShare 低于预期

**可能原因**：
- 管理费大幅累积（`accrueManagementFee` 被触发）
- 策略遭受损失（Aave V3 极端情况）
- 恶意操作（大额 deposit → 操纵 PPS）

**处置**：
1. 立即执行 `emergency_pause.ts` 暂停所有存款入口
2. 执行 `exportLiveRunSnapshot.ts` 存档当前状态
3. 对比前后快照，定位变化来源
4. 如策略资产减少：检查 Aave V3 状态（aToken 余额 vs totalUnderlying）
5. 如确认损失：考虑 `manager.emergencyExit()` 撤回所有资金
6. 通知用户（视情况）

### 4.2 totalAssets 与 stratUnderlying + idle 不一致

**处置**：
1. 检查是否有未 return 的 manager idle：`manager.idleUnderlying()`
2. 检查是否有管理费未 accrue：手动触发一次 `deposit` 或 `redeem`（会自动 accrue）
3. 如差值持续存在且 > 1 USDC：调查是否存在未知的 USDC 转入/转出

---

## 5. 应急暂停流程

### 5.1 标准应急暂停（不影响 redeem）

```bash
# GUARDIAN 或 ADMIN 均可执行
npx hardhat run scripts/step3/emergency_pause.ts --network base
```

执行后：
- `depositsPaused = true`
- `systemMode = Paused`
- `manager.paused = true`
- `redeemsPaused` **不变**（退出路径保留）

### 5.2 极端情况：暂停所有操作（含 redeem）

仅在怀疑 redeem 路径本身存在安全风险时使用：

```bash
PAUSE_REDEEMS=true npx hardhat run scripts/step3/emergency_pause.ts --network base
```

**使用前必须确认**：存在具体的 redeem 侧安全风险，且已评估对用户的影响。

### 5.3 恢复正常（ADMIN only）

```bash
# 1. 先确认异常已解除
npx hardhat run scripts/liveRun/checkSystemState.ts --network base

# 2. 手动在 Hardhat 或脚本中执行：
#    vault.unpauseDeposits()
#    vault.setMode(0)
#    manager.unpause()
#    （如已暂停 redeems）vault.unpauseRedeems()
```

### 5.4 全额撤回（manager.emergencyExit）

仅在策略资金面临风险时（如 Aave V3 出现安全事件）：

```bash
npx hardhat run scripts/step2/divest.ts --network base
# 或直接调用：manager.emergencyExit()
```

执行后：所有资金从 Aave 撤回到 Vault，用户可正常 redeem。

---

## 6. 角色异常

### 6.1 ADMIN 钱包疑似泄露

**处置**（需另一个具备 DEFAULT_ADMIN_ROLE 的钱包）：
1. 立即 `revokeRole(DEFAULT_ADMIN_ROLE, compromised_admin)`
2. 暂停所有操作
3. 评估损失
4. 通知用户

**预防**：Step3 期间建议将 ADMIN 操作在 Cold wallet 上执行。

### 6.2 GUARDIAN 钱包异常

**处置**：
1. ADMIN 执行 `revokeRole(EMERGENCY_ROLE, old_guardian)`
2. ADMIN 执行 `grantRole(EMERGENCY_ROLE, new_guardian)`
3. 运行 `checkSystemState.ts` 验证角色状态

---

## 7. 快速参考

| 场景 | 第一步 | 使用脚本 / 函数 |
|---|---|---|
| 任何异常 | 先暂停入口 | `emergency_pause.ts` |
| 巡检确认 | 读取全状态 | `checkSystemState.ts` |
| 存款前 | 限额检查 | `checkLimits.ts` |
| 存档记录 | JSON 快照 | `exportLiveRunSnapshot.ts` |
| 解除暂停 | 恢复正常 | ADMIN：unpause + setMode(0) |
| 策略风险 | 全额撤回 | `manager.emergencyExit()` |
| 用户无法 redeem | 检查 pause / idle | `checkSystemState.ts` → divest |
