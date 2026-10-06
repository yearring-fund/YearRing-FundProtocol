# docs/ACCOUNTING_AND_NAV_RULES_V3.md — FinancialBase V3 会计与 NAV 规则

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D_NAV_1 | PPS = totalAssets / totalShares，遵循 ERC4626 标准，admin 不得手写覆盖 | 已冻结 |
| D_NAV_2 | RWT 不计入 NAV，RWT 价格变化不影响 PPS | 已冻结 |
| D_NAV_3 | 管理费通过 mint shares 到 treasury 收取（稀释方式），不直接扣减用户 USDC | 已冻结 |
| D_NAV_4 | 禁止接口：setTotalAssets / setPps / adminMintShares / adminBurnUserShares | 已冻结 |

---

## 1. 核心 NAV 公式

### 1.1 每份额价格（PPS）

```
PPS = totalAssets() / totalSupply()
    = convertToAssets(10 ** decimals())   ← ERC4626 标准实现
```

- `totalSupply()` = 所有已流通 fbUSDC shares（含 treasury 持有的管理费 shares）
- `totalAssets()` = 所有由 vault 控制的 USDC 净资产，见 1.2 节
- PPS 的小数精度：基础单位为 USDC（6位小数）；shares 为 18 位小数（`_decimalsOffset() = 12`）

### 1.2 初始 PPS

- 当 vault 首次部署、`totalSupply() == 0` 时，首笔存款按 1 USDC/share 铸造
- ERC4626 中 `_decimalsOffset() = 12` 保证铸造精度：存入 1 USDC（1e6）铸出 1e18 shares
- 初始 PPS 不需要 admin 手动设置，自动由首笔存款建立

---

## 2. totalAssets 构成

### 2.1 完整链式定义

```
totalAssets()
  = vault idle USDC
  + strategyManager.totalManagedAssets()

totalManagedAssets()
  = strategyManager idle USDC
  + strategy.totalUnderlying()

strategy.totalUnderlying()   ← AaveV3StrategyV01 实现
  = aToken.balanceOf(strategy)   ← 含 Aave 已累计利息
  + idle USDC in strategy        ← 赎回后尚未转回时的短暂持有
```

### 2.2 各层级说明

| 层级 | 代表资产 | 变动原因 |
|------|----------|----------|
| vault idle USDC | 直接在 vault 合约内的 USDC | 存款流入、赎回流出、strategy 回注 |
| strategyManager idle USDC | 在 SM 合约内但未部署到 strategy 的 USDC | invest() 前短暂持有 |
| aToken.balanceOf(strategy) | Aave 池中的存款凭证（含实时利息） | Aave 每区块更新余额 |
| idle USDC in strategy | strategy 合约内赎回中间态 | divest/emergencyExit 后短暂存在 |

### 2.3 包含与排除

| 资产类型 | 计入 totalAssets | 原因 |
|----------|------------------|------|
| Vault 内 USDC | ✅ 是 | 直接持有 |
| SM 内 USDC | ✅ 是 | 中间传输态 |
| Aave aUSDC（含实时利息） | ✅ 是 | strategy.totalUnderlying() 的主体 |
| Strategy 内临时 USDC | ✅ 是 | 赎回归路中间态 |
| RewardToken (RWT) | ❌ 否 | 独立代币，不代表 USDC 价值 |
| fbUSDC shares（锁定中） | ❌ 否（已通过 PPS 反映） | shares 是债权凭证，不是资产 |
| 第二策略资产（预留） | ❌ 否（V3 初版无第二策略） | 未上线不计入 |

---

## 3. 收益和亏损的自动反映机制

- Aave 的利息通过 aToken rebasing 实时累加，无需 admin 触发
- `strategy.totalUnderlying()` 读取 `aToken.balanceOf(strategy)` 即反映当前利息
- `totalAssets()` 的增长 → PPS 自动上升 → 所有持有 fbUSDC 的用户按比例受益
- Aave 协议风险导致的损失（如清算缺口）→ `aToken` 余额下降 → `totalAssets()` 减少 → PPS 自动下降

**禁止任何 admin 操作绕过上述自动机制，直接修改 PPS 或 totalAssets 的读取结果。**

---

## 4. 管理费收取方式

### 4.1 收取机制（稀释方式）

- 管理费不直接从用户 USDC 中扣除
- 通过向 treasury 铸造新 fbUSDC shares 的方式收取
- 铸造新 shares → totalSupply 增加 → 所有现有用户的 PPS 被稀释
- 稀释效果等同于按比例扣费，但无需逐用户操作

### 4.2 管理费计算公式

```
feeShares = totalShares × mgmtFeeBps × elapsedTime
            / (BPS_DENOMINATOR × SECONDS_PER_MONTH)
```

- `mgmtFeeBps`：每月管理费比率（bps），上限 `MAX_MGMT_FEE_BPS_PER_MONTH = 200`（即 2%/月）
- `elapsedTime`：距上次收费的秒数
- `feeShares` mint 到 treasury 地址

### 4.3 管理费折扣返现

- 锁仓用户可获得管理费折扣，由 `LockBenefitV02.feeDiscountFromDuration()` 计算
- 折扣以 fbUSDC shares 形式从 treasury 转给用户（非 USDC）
- 返现不影响 totalAssets，仅是 treasury shares 转移
- 不属于 NAV 会计范畴，不影响 PPS

---

## 5. 禁止接口清单

以下接口**绝对不得**在 V3 任何版本中出现：

| 禁止接口 | 禁止原因 |
|----------|----------|
| `setTotalAssets(uint256)` | 允许 admin 手写 NAV，破坏基于 share 的公正性 |
| `setPps(uint256)` | 允许 admin 直接覆盖 PPS，同上 |
| `adminMintShares(address, uint256)` | 无对应 USDC 资产支撑的 shares 铸造，稀释其他用户 |
| `adminBurnUserShares(address, uint256)` | 直接销毁用户持有的 shares，侵害用户资产 |
| `overrideTotalUnderlying(uint256)` | 覆写 strategy 报告的资产量，同等于手写 NAV |

---

## 6. PPS 边界条件与精度说明

### 6.1 防攻击保护

- ERC4626 `_decimalsOffset() = 12` 提供 10^12 的放大倍数，防止通过微量首存操作的通胀攻击（inflation attack）
- 首笔存款最小有效金额建议为 1 USDC（1e6），铸出 1e18 shares

### 6.2 精度损失

- `convertToAssets()` 和 `convertToShares()` 在整数除法时存在向下取整
- 赎回时轻微精度损失（通常 < 1 wei）属于正常，不构成会计错误
- 累计管理费铸造使用独立的时间戳追踪，防止重复计费

### 6.3 totalAssets 取值时机

- 每次链上调用时实时计算，不缓存
- Aave aToken 余额在同一区块内不会更新（区块时间为最小粒度）

---

## 7. RWT 排除 NAV 的技术依据

- `RewardToken` 为独立 ERC20 合约，与 `FundVaultV01` 无资产绑定关系
- `FundVaultV01.totalAssets()` 不引用 `RewardToken` 合约
- RWT 价格变化不影响 `aToken.balanceOf()` 或 vault 内 USDC 余额
- 锁仓时发放 RWT 仅改变 treasury 的 RWT 余额，不改变 USDC 或 aToken 余额
- 若 RWT 在二级市场价格归零，所有 fbUSDC 持有者的 PPS 不受影响

---

## 8. 会计完整性校验原则

| 校验项 | 期望行为 |
|--------|---------|
| 存款后 PPS | 存款前后 PPS 不变（存 USDC → mint 等值 shares） |
| 赎回后 PPS | 赎回前后 PPS 不变（burn shares → 返还等值 USDC） |
| 管理费铸造后 PPS | PPS 轻微下降（稀释效果），降幅等于实际管理费率 |
| Aave 利息累积后 PPS | PPS 上升，与 aToken 余额增量严格对应 |
| 发放 RWT 后 PPS | PPS 不变 |
| EmergencyExit 模式下 PPS | PPS 继续有效，Exit Round 按 PPS 快照计算申领金额 |
