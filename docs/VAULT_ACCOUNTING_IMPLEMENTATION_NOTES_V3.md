# docs/VAULT_ACCOUNTING_IMPLEMENTATION_NOTES_V3.md — Vault 会计实现注记

**版本：** V3 初版
**文档状态：** 已冻结（Phase 3 产出）
**最后更新：** 2026-04-01

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| P3-D1 | EmergencyExit 模式下封锁 `redeem()`，强制走 `claimExitAssets()` | 已冻结 |
| P3-D2 | EmergencyExit 模式下暂停管理费计提，且时钟持续推进（防止重回 Normal 后追溯计费） | 已冻结 |
| P3-D3 | `totalAssets()` = vault USDC 余额 + `strategyManager.totalManagedAssets()`（含策略资产） | 已冻结 |
| P3-D4 | PPS 使用 ERC4626 标准计算：`convertToAssets(10^decimals())`，不手动维护 | 已冻结 |
| P3-D5 | RWT 为独立 ERC20，不计入 `totalAssets()`，价格变化不影响 PPS | 已冻结 |

---

## 1. PPS（每份净值）计算

### 1.1 公式

```
PPS = totalAssets() / totalShares

// 合约实现（ERC4626 标准）：
pricePerShare() = convertToAssets(10 ** decimals())
               = totalAssets() × 10^18 / totalSupply()
               （含 _decimalsOffset = 12 的精度放大）
```

### 1.2 初始 PPS = 1 USDC

- 合约使用 `_decimalsOffset() = 12`，shares 精度为 18 位，USDC 精度为 6 位
- 首次存入 N USDC 时：
  - `totalAssets = N × 10^6`
  - `totalSupply = N × 10^18`（offset 提升）
  - `PPS = N × 10^6 × 10^18 / (N × 10^18) = 10^6 = 1 USDC` ✓

### 1.3 PPS 影响因素

| 事件 | PPS 变化 |
|------|---------|
| 普通存款 | 不变（按当前 PPS 发行 shares） |
| 普通赎回 | 不变（按当前 PPS 销毁 shares） |
| strategy 产生收益 | 上升 |
| strategy 发生亏损 | 下降 |
| 管理费计提（mint shares 给 treasury） | 下降（稀释） |
| 资金在 vault / manager / strategy 间移动 | **不变**（totalAssets 不变） |
| RWT 价格变化 | **不变**（RWT 不计入 totalAssets） |
| EmergencyExit 模式（无管理费计提） | 不下降（无稀释） |

---

## 2. totalAssets 计算链

```
totalAssets()
  = IERC20(usdc).balanceOf(vault)
  + IStrategyManagerV01(strategyManager).totalManagedAssets()

totalManagedAssets()
  = IERC20(usdc).balanceOf(strategyManager)          // idle in manager
  + IStrategyV01(strategy).totalUnderlying()           // deployed to Aave
```

### 2.1 保守报告原则

- `strategy.totalUnderlying()` 调用失败时（网络异常、合约升级后），`totalManagedAssets()` 仅报告 idle 部分，不报告 strategy 部分
- 这会导致 PPS 短暂低估，但不会虚报资产
- 操作人应在 strategy 恢复前保持 Paused 模式，避免新存款以低 PPS 购入

### 2.2 不允许的 totalAssets 变形

| 禁止行为 | 原因 |
|---------|------|
| 将 vault 的即时 USDC 余额作为 totalAssets 对外暴露 | 忽略了在策略中的资产 |
| 将 RWT、governance token 纳入 totalAssets | 违反 NAV 口径 |
| 管理员直接调整 totalAssets 变量 | 合约无此接口，架构级禁止 |

---

## 3. 两条退出路径语义

### 3.1 常规赎回 `redeem(shares, receiver, owner)`

| 属性 | 说明 |
|------|------|
| 可用模式 | Normal、Paused |
| 价格基准 | 当前 PPS（= totalAssets / totalSupply） |
| 资产来源 | vault 即时 USDC 余额 |
| 限制 | 若 vault 余额不足，redeem 失败（用户须等待 operator 回撤） |
| 在 EmergencyExit 模式下 | **封锁**，revert `UseClaimExitAssets` |

### 3.2 紧急申领 `claimExitAssets(roundId, sharesToBurn)`

| 属性 | 说明 |
|------|------|
| 可用模式 | 仅 EmergencyExit（round 处于 open 状态） |
| 价格基准 | 本轮 `availableAssets / snapshotTotalSupply`（可能与 PPS 不同） |
| 资产来源 | admin 显式划拨到本轮的资产池 |
| 限制 | 用户申领量不超过快照余额；round 关闭后停止 |
| 快照隔离 | 仅计入 round 开立时刻之前的 shares |

### 3.3 为何两条路径不能同时开放

若在 EmergencyExit 模式下同时开放 `redeem()` 和 `claimExitAssets()`：

- `redeem()` 按 PPS 计算，要求 vault 有流动性
- `claimExitAssets()` 按 pro-rata 划拨池计算，与 PPS 无关
- 两套定价并存会导致：
  - 先走 `redeem()` 的用户可能获得更高价（或失败）
  - 剩余用户的 `claimExitAssets()` 比例被扭曲
- 结论：EmergencyExit 模式必须唯一化退出路径 → 封锁 `redeem()`

---

## 4. 管理费计提规则

### 4.1 正常计提

```
feeShares = totalSupply × mgmtFeeBpsPerMonth × elapsed
            / (BPS_DENOMINATOR × SECONDS_PER_MONTH)
```

- mint 给 treasury，稀释 PPS（经济等价于按 AUM 收费）
- 任何人可调用 `accrueManagementFee()`；同一 block 内幂等

### 4.2 EmergencyExit 模式下暂停

- `accrueManagementFee()` 在 EmergencyExit 模式下直接 `return`，不 mint
- `lastFeeAccrual = block.timestamp` 同时推进，确保重回 Normal 模式后不追溯计费
- 逻辑依据：EmergencyExit 为风险事件，不应在期间对用户收取管理费；admin 若需恢复服务，应手动触发模式切换

### 4.3 模式切换时的费用边界

| 切换方向 | 费用行为 |
|---------|---------|
| Normal → EmergencyExit | 切换前最后一次 accrueManagementFee 发生在 setMode() 调用的那一 block（自然截断） |
| EmergencyExit → Normal | 无追溯费用；费用从 setMode(Normal) 那一刻起重新开始计算 |

---

## 5. 储备区间与 rebalance 会计

详见 `docs/LIQUIDITY_AND_EXIT_RULES_V3.md` 与 `docs/ROLE_AND_STATE_MACHINE_MATRIX_V3.md`。

关键会计不变式：**资金在 vault / manager / strategy 三者之间移动，不改变 `totalAssets()`，不改变 PPS。**

---

## 6. 待补充（Phase 4+）

| 项目 | 状态 |
|------|------|
| Aave V3 实际收益如何反映到 totalUnderlying() | Phase 4：AaveV3StrategyV01 对齐 |
| strategy 亏损时的用户通知机制 | Phase 4：事件 + 前端展示 |
| 管理费率修改时的费用结算顺序 | 已实现：setMgmtFeeBpsPerMonth 先 accrueManagementFee 再修改费率 |
