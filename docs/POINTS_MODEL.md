# LockPointsV02 — Points Model

## 定位

Points 是协议忠诚度积分，衡量用户的长期承诺度。

- **不是资产**：不可转让，不影响 Vault 会计，不计入 `totalAssets()`
- **不是 shares**：不参与 ERC4626 任何逻辑
- **V2 不对外展示**：合约已实现，前端暂不接入，供 V3+ 扩展使用

---

## 累积公式

```
points(lockId) = lockedUSDCValue × elapsed_days × multiplierBps / (10000 × 50)
```

| 变量 | 说明 |
| --- | --- |
| `lockedUSDCValue` | `FundVaultV01.convertToAssets(lockedShares)`，查询时实时读取 |
| `elapsed_days` | `(now - lockedAt) / 1 days`，unlock 后封顶为 `(unlockAt - lockedAt) / 1 days` |
| `multiplierBps` | 由 `LockBenefitV02` 提供，取决于锁仓档位 |

与奖励代币公式相同，含义为：**每天每 50 USDC 锁仓量，按档位乘数累积积分**。

---

## 档位乘数

| 档位 | 时长范围 | multiplierBps | 日积分（每 100 USDC） |
| --- | --- | --- | --- |
| Bronze | [30, 90) 天 | 10000 | 2 points/day |
| Silver | [90, 180) 天 | 13000 | 2.6 points/day |
| Gold | [180, 365] 天 | 18000 | 3.6 points/day |

---

## 关键规则

**积累阶段**：lock 创建后按时间线性增长，每过 1 天增加一档对应的积分量。

**解锁后冻结**：调用 `unlock()` 后，elapsed 封顶为实际锁仓时长，points 不再增长。

**无销毁**：V2 中 points 只增不减，不存在消耗/销毁逻辑。

---

## 合约接口

```solidity
// 单个仓位的积分
function pointsOf(uint256 lockId) external view returns (uint256);

// 用户所有仓位积分之和（含已解锁的冻结积分）
function totalPointsOf(address owner) external view returns (uint256);
```

两个函数均为纯 view，无 gas 消耗（只读调用），无状态写入。

---

## V3+ 扩展方向

- **奖励 boost**：`totalPointsOf` 作为权重参与 RewardToken 分配比例计算
- **治理权重**：points 映射为投票权
- **资格门槛**：`points > X` 解锁特定活动或白名单

扩展时只需新增消费 points 的模块，`LockPointsV02` 本身不需要修改。
