# docs/LIQUIDITY_AND_EXIT_RULES_V3.md — FinancialBase V3 流动性与退出规则

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D2 | Exit Round 与 EmergencyExit 模式共存；Exit Round 是 EmergencyExit 内的有序退出路径 | 已冻结 |
| D5 | rebalance() 冷却 = 最短间隔 1 小时 | 已冻结 |
| D_LIQ_1 | rebalance() 为 permissionless，仅补回到 target 30%，失败 emit 事件不 revert | 已冻结 |
| D_LIQ_2 | checkUpkeep() / performUpkeep() 接口预留，V4 Chainlink Automation 实现 | 已冻结 |

---

## 1. 储备三段区间

### 1.1 常量定义

| 常量名 | 值（bps） | 百分比 | 含义 |
|--------|-----------|--------|------|
| `RESERVE_FLOOR_BPS` | 1500 | 15% | 储备下沿：低于此值触发回撤 |
| `RESERVE_TARGET_BPS` | 3000 | 30% | 储备目标中心：rebalance() 补回到此值 |
| `RESERVE_CEILING_BPS` | 3500 | 35% | 储备上沿：高于此值不得主动再投资 |
| `MAX_STRATEGY_DEPLOY_BPS` | 7000 | 70% | strategy 最大部署上限（链上强制） |

### 1.2 储备率计算

```
currentReserveRatio = vaultIdleUSDC / totalAssets()
```

其中 `vaultIdleUSDC` = vault 合约内直接持有的 USDC 余额（不含 strategy 内资产）。

### 1.3 三区间行为规则

| 当前储备率区间 | 系统行为 |
|--------------|---------|
| 储备 < 15% （低于下沿） | `rebalance()` 被允许调用并触发从 strategy 回撤 |
| 15% ≤ 储备 ≤ 35%（在区间内） | `rebalance()` 调用为 no-op，不执行任何操作 |
| 储备 > 35%（高于上沿） | 不得向 strategy 主动投资；`invest()` 被阻断 |
| 任何情况下 | strategy 总部署不得超过 totalAssets() × 70%（链上硬检查） |

---

## 2. rebalance() 函数规则

### 2.1 设计原则

- **permissionless**：任何地址均可调用，无角色限制
- **1小时冷却**：两次成功调用间隔不得少于 3600 秒（`lastRebalanceAt` 状态变量追踪）
- **no-op 优先**：若储备率在 [15%, 35%] 区间内，函数立即返回，不执行任何操作
- **仅补回到 target**：rebalance() 不追求将储备最大化，也不追求最优化；只是补回到 30% target center
- **失败不 revert**：若 strategy 回撤失败（如 Aave 暂时流动性不足），emit 一个失败事件，不 revert 整笔交易

### 2.2 rebalance() 执行逻辑

```
if (block.timestamp < lastRebalanceAt + 3600) return; // 冷却期内，静默返回
lastRebalanceAt = block.timestamp;

currentReserve = vaultIdleUSDC / totalAssets();

if (currentReserve >= RESERVE_FLOOR_BPS && currentReserve <= RESERVE_CEILING_BPS):
    emit RebalanceSkipped(currentReserve);
    return; // 在区间内，no-op

if (currentReserve < RESERVE_FLOOR_BPS):
    // 计算需从 strategy 回撤多少以达到 RESERVE_TARGET_BPS（30%）
    targetIdleUSDC = totalAssets() × RESERVE_TARGET_BPS / BPS_DENOMINATOR;
    shortfall = targetIdleUSDC - vaultIdleUSDC;
    // 调用 strategyManager.divest(shortfall) + returnToVault(shortfall)
    // 若失败，emit RebalanceFailed(reason)，不 revert
```

### 2.3 rebalance() 不处理的情况

- 储备高于 35%（上沿）时，rebalance() 不向 strategy 主动投资；这由 admin 操作（invest()）控制
- admin 主动调用 invest() 时，系统检查 strategy 部署是否超过 70% 和 35% 上沿

### 2.4 V4 接口预留

```solidity
// V4 Chainlink Automation 接口占位（V3 初版不实现）
function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory);
function performUpkeep(bytes calldata) external;
```

V3 中以上两个函数仅为接口声明，函数体为空或 `revert("V4NotImplemented")`。

---

## 3. 常规赎回（Normal 模式）

### 3.1 赎回路径

```
用户 → redeem(shares, receiver, owner) → ERC4626 标准
     → vault 根据 PPS 计算 USDC 数量
     → 若 vault idle USDC 充足 → 直接转出
     → 若不足 → 暂时无法完成（非回滚 rebalance 路径）
```

### 3.2 赎回条件

| 条件 | 要求 |
|------|------|
| 系统状态 | Normal 模式下赎回开放 |
| redeemsPaused | 必须为 false |
| 用户持有 | shares ≥ 赎回量 |
| vault 现金 | 须有足够 idle USDC；不足时赎回失败（不自动触发 strategy 回撤） |
| 锁仓中的 shares | 不可赎回，须等待锁仓到期或走 earlyExit 流程 |

### 3.3 Paused 模式下的赎回

- Paused 模式：**赎回仍然开放**（与 V1 行为一致）
- 新存款被阻断；现有持有者可继续赎回
- invest() 被阻断

### 3.4 赎回与即时现金池的分离原则

- 前端不得将 `vaultIdleUSDC`（即时现金）显示为"可赎回总量"
- 前端展示储备区间状态（当前储备率 vs. 15/30/35% 区间），而非绝对现金数字
- 赎回是否可完成取决于当时 idle 余额与赎回量的实时比较

---

## 4. EmergencyExit 模式与 Exit Round

### 4.1 状态转移

```
Normal → (EMERGENCY_ROLE pause) → Paused
Paused → (EMERGENCY_ROLE trigger) → EmergencyExit
Normal → (可直接) → EmergencyExit  [特殊路径，仅 Admin 经 Timelock]
EmergencyExit → (Admin 经 Timelock 恢复) → Normal [需评估完成后方可]
```

### 4.2 EmergencyExit 模式下的行为

| 操作 | 是否允许 |
|------|---------|
| 新存款 | ❌ 完全阻断 |
| 常规 ERC4626 赎回 | ❌ 阻断（改用 Exit Round 路径） |
| strategy emergencyExit | ✅ 触发从 strategy 回撤资金到 vault |
| Exit Round 申领 | ✅ 按快照比例申领 USDC |
| 锁仓 shares 参与 Exit Round | ✅ 见 4.4 节 |

### 4.3 Exit Round 机制（快照 + 按比例申领）

1. **开启 Exit Round**：Admin 调用 `openExitRound()`，触发 ERC20 快照（记录每个地址持有的 shares）
2. **资金回注**：EMERGENCY_ROLE 触发 strategy `emergencyExit()`，将 aUSDC 赎回为 USDC 并归还 vault
3. **用户申领**：用户调用 `claimExitAssets(roundId)`，按快照中自己的 shares 比例获取 USDC
4. **关闭 Exit Round**：Admin 调用 `closeExitRound(roundId)`，此后该轮次不再接受申领

```
用户可申领 USDC = totalRoundUSDC × (用户快照 shares / 总快照 shares)
```

### 4.4 锁仓 shares 在 EmergencyExit 下的处理

| 情形 | 处理规则 |
|------|---------|
| 锁仓 shares 持有人 | 其 shares 计入 ERC20 快照（LockLedger 合约持有的 shares 不属于个人地址） |
| LockLedger 代持的 shares | LockLedger 合约地址出现在快照中，由 Admin/协议规则处理 |
| 用户的锁仓仓位 | 在 EmergencyExit 模式下，用户需通过 LockLedger 的 EmergencyExit 接口（若已实现）或等待协议处理 |
| 已到期锁仓 | 用户可正常 unlock() 取回 shares，然后参与 Exit Round 申领 |

**注意：** EmergencyExit 下 LockLedger 持有的 shares 的精确处理规则须在实现阶段确定并在 `LIQUIDITY_AND_EXIT_RULES_V3.md` 补充。本文档标记为：**实现待确认项**。

### 4.5 Exit Round 与常规赎回的语义差异

| 维度 | 常规赎回（Normal） | Exit Round（EmergencyExit） |
|------|------|------|
| 触发条件 | 用户主动，ERC4626 | 协议触发，快照后申领 |
| 金额计算 | 实时 PPS × shares | 按快照比例分配实际回收 USDC |
| 时间性 | 即时 | 需等待 strategy 资金回注完成 |
| shares 销毁 | 赎回时 burn | 申领时 burn（或协议统一 burn） |
| 适用状态 | Normal / Paused | 仅 EmergencyExit |

---

## 5. 净值与可兑付性分离原则

- **PPS（净值）**：反映 totalAssets / totalShares，是会计层面的每份额价值
- **可兑付性（Liquidity）**：反映当前 vault idle USDC 与待兑付赎回量的关系
- 两者相互独立：PPS 可以很高，但当前 idle 不足时赎回仍需等待
- 前端必须分开展示这两个维度，不得合并为单一"可取现金"数字
- `rebalance()` 的触发条件基于储备率（不是 PPS），两者不绑定

---

## 6. 储备区间状态的前端展示要求

前端必须展示以下信息（非绝对现金数字）：

| 展示项 | 内容 |
|--------|------|
| 当前储备率 | `vaultIdleUSDC / totalAssets()` 百分比 |
| 区间状态标签 | "在区间内" / "低于下沿（15%）" / "高于上沿（35%）" |
| 目标中心值 | 30%（参考值） |
| 最大策略部署 | 70%（硬上限） |

**前端禁止展示：** vault 合约当前 USDC 绝对余额作为"可赎回池大小"。
