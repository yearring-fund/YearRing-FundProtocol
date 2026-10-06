# docs/LOCK_RWT_RULES_V3.md — FinancialBase V3 锁仓与 RWT 规则

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D1 | 锁仓档位乘数采用档内线性插值（较长锁仓时长对应该档内更高乘数） | 已冻结 |
| D_LRW_1 | 锁仓对象为 fbUSDC shares，不是 raw USDC | 已冻结 |
| D_LRW_2 | 锁仓 shares 继续参与 NAV/PPS 变化（不脱离 vault 会计） | 已冻结 |
| D_LRW_3 | 单用户最多 5 个活跃仓位（MAX_LOCKS_PER_USER = 5） | 已冻结 |
| D_LRW_4 | RWT 在建仓时一次性发放；早退须全额返还 RWT | 已冻结 |
| D_LRW_5 | 早退时已形成的管理费返现保留，不须退还 | 已冻结 |
| D_LRW_6 | RWT 不计入 NAV，其价格变化不影响 PPS | 已冻结 |
| D_LRW_7 | Gold 档位上限乘数确认为 2.5×（25000 bps） | 已冻结 |

---

## 1. 锁仓对象与 NAV 参与

### 1.1 锁仓对象

- 用户锁仓的是 **fbUSDC shares**（FundVaultV01 发行的 ERC4626 份额），不是 USDC 本身
- 用户在锁仓前须先向 vault 存款获取 fbUSDC，然后将 fbUSDC approve 给 LockLedger

### 1.2 NAV 参与机制

- 锁仓 shares 转入 `LockLedgerV02` 合约，但**不影响** vault 的 `totalSupply()`
- vault `totalAssets()` 不因锁仓操作变化
- PPS 变化对锁仓 shares 和未锁仓 shares 效果完全相同：

```
锁仓期间用户净值 = pos.shares × PPS(t)
```

- 锁仓到期 unlock 时，用户取回的是原始 shares 数量，但每份 share 的 USDC 价值已按 Aave 收益变化

### 1.3 不为锁仓用户创建第二套 NAV

- 锁仓期间不提供额外的基础收益率提升
- 锁仓奖励仅包含：管理费折扣返现 + RWT，不包括额外 Aave 利息加成

---

## 2. 锁仓仓位系统（position-based）

### 2.1 仓位数据结构

```solidity
struct LockPosition {
    address owner;       // 仓位所有者
    uint256 shares;      // 锁仓 fbUSDC shares 数量
    uint64  lockedAt;    // 锁仓时间戳
    uint64  unlockAt;    // 到期时间戳
    bool    unlocked;    // 是否已解锁
    bool    earlyExited; // 是否已早退
}
```

### 2.2 多仓位支持

- 同一用户可同时持有最多 5 个活跃锁仓仓位
- `MAX_ACTIVE_LOCKS_PER_USER = 5`（常量，V3 不变）
- 每个仓位独立计算 RWT 奖励和管理费返现
- 每个仓位独立处理到期解锁或早退

---

## 3. 锁仓档位与时长范围

### 3.1 三档定义

| 档位 | 最短锁仓天数 | 最长锁仓天数 | 说明 |
|------|------------|------------|------|
| Bronze | 30 天 | 89 天 | 短期锁仓 |
| Silver | 90 天 | 179 天 | 中期锁仓 |
| Gold | 180 天 | 365 天 | 长期锁仓 |

- 锁仓时长以秒为单位存储（`duration` 参数为秒数）
- Bronze 下沿：`MIN_LOCK_DURATION = 30 days = 30 × 86400 秒`
- Gold 上沿：`MAX_LOCK_DURATION = 365 days = 365 × 86400 秒`
- 不接受低于 Bronze 下沿或高于 Gold 上沿的锁仓时长

### 3.2 档位分配边界

| 判断条件（以秒为单位） | 档位 |
|---------------------|------|
| 30d ≤ duration < 90d | Bronze |
| 90d ≤ duration < 180d | Silver |
| 180d ≤ duration ≤ 365d | Gold |

---

## 4. 线性插值乘数（D1 冻结决策）

### 4.1 设计原则

在同一档位内，锁仓时长越长，乘数越高。采用线性插值计算，不是固定的单一乘数。

### 4.2 各档位基础值与上限值

| 档位 | 最短天数（minDays） | 最长天数（maxDays） | 基础乘数（baseMult） | 上限乘数（maxMult） |
|------|-----------------|-----------------|------------------|------------------|
| Bronze | 30 | 89 | 1.0× | 1.3× |
| Silver | 90 | 179 | 1.3× | 1.8× |
| Gold | 180 | 365 | 1.8× | **2.5×** |

### 4.3 线性插值公式

```
multiplier = baseMult + (maxMult - baseMult) × (lockDays - minDays) / (maxDays - minDays)
```

**具体展开：**

```
// Bronze: 30d → 1.0×, 89d → 1.3×
Bronze multiplier = 1.0 + 0.3 × (lockDays - 30) / (89 - 30)
                  = 1.0 + 0.3 × (lockDays - 30) / 59

// Silver: 90d → 1.3×, 179d → 1.8×
Silver multiplier = 1.3 + 0.5 × (lockDays - 90) / (179 - 90)
                  = 1.3 + 0.5 × (lockDays - 90) / 89

// Gold: 180d → 1.8×, 365d → 2.5×
Gold multiplier = 1.8 + 0.7 × (lockDays - 180) / (365 - 180)
               = 1.8 + 0.7 × (lockDays - 180) / 185
```

### 4.4 合约实现方式（bps 表示）

为避免浮点数运算，乘数在合约内以 bps（1/10000）表示：

| 档位 | baseMult（bps） | maxMult（bps） |
|------|---------------|--------------|
| Bronze | 10000 | 13000 |
| Silver | 13000 | 18000 |
| Gold | 18000 | 25000 |

```
multiplierBps = baseMult_bps + (maxMult_bps - baseMult_bps) × (durationSeconds - minSeconds)
                / (maxSeconds - minSeconds)
```

**说明：** Gold 档位上限乘数 2.5×（25000 bps）已确认冻结。

### 4.5 档位交界处的连续性

- Bronze 上沿（89天，1.3×）与 Silver 基础（90天，1.3×）连续，无跳跃
- Silver 上沿（179天，1.8×）与 Gold 基础（180天，1.8×）连续，无跳跃
- Gold 内部从 1.8× 至 2.5×（待确认），线性增长

---

## 5. RWT 计算公式

### 5.1 RWT 发放公式

```
RWT_amount = lockedUSDCValue × durationDays × multiplierBps
             / REWARD_DENOMINATOR

REWARD_DENOMINATOR = 10_000 × 500
                   = 5_000_000

lockedUSDCValue = convertToAssets(shares)   // USDC 6位小数
RWT_amount (raw) = lockedUSDCValue × USDC_TO_TOKEN_SCALE × durationDays × multiplierBps
                   / REWARD_DENOMINATOR

USDC_TO_TOKEN_SCALE = 10^12  // 桥接 USDC(6位) → RWT(18位) 小数差
```

**示例：**
- 锁仓 10,000 USDC（= 10,000 × 10^6 = 10^10 raw USDC）
- 锁仓 90 天（Silver 基础，乘数 1.3× = 13000 bps）
- RWT = (10^10 × 10^12 × 90 × 13000) / 5,000,000
- 结果为 18 位小数的 RWT 数量

### 5.2 发放时机

- 建仓时（`lockWithReward()` 调用时）一次性从 treasury 转给用户
- 后续不再追加发放
- treasury 须预先 approve 足量 RWT 给 LockRewardManager

---

## 6. 管理费折扣返现

### 6.1 返现计算公式

```
rebateShares = pos.shares × mgmtFeeBps × discountBps × elapsed
               / (BPS_DENOMINATOR² × SECONDS_PER_MONTH)

// discountBps: 由 LockBenefitV02.feeDiscountFromDuration() 返回，基于锁仓档位
// elapsed: 自上次领取至今（或至 unlockAt，取较小值）的秒数
// mgmtFeeBps: vault 当前每月管理费率（bps）
```

### 6.2 返现累计与领取规则

| 规则 | 说明 |
|------|------|
| 累计方式 | 按秒线性累计，不按月批次 |
| 领取时机 | 任意时刻调用 `claimRebate(lockId)` |
| 领取单位 | fbUSDC shares（非 USDC） |
| 来源 | 从 treasury 持有的 fbUSDC 转出 |
| 上限 | 不超过用户实际应付管理费的折扣部分 |
| 锁仓到期后 | 不再累计；上限为到期时刻 |

### 6.3 已形成返现在早退时保留

- 早退（`earlyExitWithReturn()`）时，系统先自动结算截至当前的所有已累计返现
- 已发放的返现不须退还
- 未来（早退后）将不再继续累计（仓位已关闭）

---

## 7. 早退规则

### 7.1 早退流程

```
用户调用 earlyExitWithReturn(lockId):
  1. 检查仓位有效性（未到期、未已退出）
  2. 自动结算截至当前的所有已累计返现（rebateShares 转给用户）
  3. 从用户拉取全额 RWT（issuedRewardTokens[lockId]）归还 treasury
  4. 若用户 RWT allowance 不足 → revert（早退被阻断）
  5. 调用 LockLedger.earlyExitFor() → 返还 shares 给用户
  6. 仓位标记为 earlyExited = true
```

### 7.2 早退条件汇总

| 条件 | 规则 |
|------|------|
| 仓位状态 | 未到期（`block.timestamp < unlockAt`） |
| RWT 返还 | 必须全额（`issuedRewardTokens[lockId]`），不允许部分返还 |
| 已累计返现 | 保留，自动结算后转给用户 |
| 阻断条件 | 用户 RWT balance 或 allowance 不足时，早退失败（不可强制执行） |

### 7.3 早退的 shares 归还

- `earlyExitFor()` 将 LockLedger 内的 shares 全额转回用户地址
- 用户可继续持有这些 shares，或向 vault 赎回为 USDC

---

## 8. RWT 不计入 NAV

- RWT 为独立 ERC20 代币（`RewardToken`），与 vault 资产池无绑定关系
- RWT 发放来自 treasury 预先持有的固定供应量
- RWT 价格在二级市场的涨跌不影响 `totalAssets()` 或 PPS
- 前端展示 RWT 奖励时须与 base yield 和 fee rebate **分开单独展示**
- 禁止在前端或任何文档中将 RWT 价格上涨描述为基金收益

---

## 9. 参数汇总表

| 参数 | 值 | 状态 |
|------|----|------|
| `MIN_LOCK_DURATION` | 30 天（30 × 86400 秒） | 已冻结 |
| `MAX_LOCK_DURATION` | 365 天（365 × 86400 秒） | 已冻结 |
| `MAX_ACTIVE_LOCKS_PER_USER` | 5 | 已冻结 |
| Bronze 范围 | 30d – 89d | 已冻结 |
| Silver 范围 | 90d – 179d | 已冻结 |
| Gold 范围 | 180d – 365d | 已冻结 |
| Bronze 乘数范围 | 1.0× – 1.3× | 已冻结 |
| Silver 乘数范围 | 1.3× – 1.8× | 已冻结 |
| Gold 乘数范围 | 1.8× – **2.5×** | 已冻结 |
| `REWARD_DENOMINATOR` | 5,000,000（10,000 × 500） | 已冻结 |
| `USDC_TO_TOKEN_SCALE` | 10^12 | 已冻结 |

---

## 10. 参数冻结确认记录

| 项目 | 确认值 | 说明 |
|------|-------|------|
| Gold 档位上限乘数 | 2.5×（25000 bps） | 经济模型验证通过：20M RWT 总供应量支持约 10.96M USDC @ Gold 最大锁仓 1 年 |
