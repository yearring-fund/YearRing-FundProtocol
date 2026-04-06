# docs/STRATEGY_RULES_V3.md — FinancialBase V3 策略规则

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D_STR_1 | V3 初版唯一在线主策略为 Aave V3 USDC 低风险生息 | 已冻结 |
| D_STR_2 | 第二策略仅接口+文档预留，V3 初版不上线 | 已冻结 |
| D_STR_3 | 70% 最大部署上限为链上硬约束（不可由 admin 运行时绕过） | 已冻结 |
| D_STR_4 | strategy.totalUnderlying() 必须不过报（不得返回高于实际持有资产的数值） | 已冻结 |
| D_STR_5 | emergencyExit() 资金只能归还到 vault（不可流向任意地址） | 已冻结 |

---

## 1. V3 初版唯一主策略

### 1.1 策略身份

| 属性 | 值 |
|------|----|
| 策略名称 | AaveV3StrategyV01 |
| 底层协议 | Aave V3（Base 网络） |
| 存款资产 | USDC |
| 持有凭证 | aUSDC（Aave Interest Bearing USDC） |
| 收益来源 | Aave USDC 供款利率（Supply APY） |
| 风险定位 | 低风险，保守生息 |
| 部署网络 | Base L2 |

### 1.2 策略操作集合（V3 允许的操作）

| 操作 | 函数 | 允许条件 |
|------|------|---------|
| 存入 USDC 到 Aave 获取 aUSDC | `invest()` | Normal 模式 + 不超过 70% 上限 |
| 从 Aave 赎回 aUSDC 为 USDC | `divest(amount)` | 任何模式（含 Paused） |
| 将 USDC 从 strategy 归还到 SM | `returnToVault(amount)` | 任何模式 |
| 全额紧急退出 | `emergencyExit()` | 仅 EmergencyExit 模式或 Admin 授权 |
| 部分紧急退出 | `partialEmergencyExit(amount)` | 仅 EmergencyExit 模式或 Admin 授权 |

### 1.3 strategy.totalUnderlying() 不过报原则

```
totalUnderlying() = aToken.balanceOf(strategy) + idle USDC in strategy
```

- 仅计入有链上状态支撑的资产
- 不得包含待领未到账的激励代币预估值
- 不得包含锁定中无法立即赎回的资产（须标注说明）
- 若 Aave 暂时限制赎回，仍按账面 aToken 余额报告，但须 emit 事件说明流动性状态

---

## 2. 70% 最大部署上限

### 2.1 链上强制检查

```
maxDeployable = totalAssets() × MAX_STRATEGY_DEPLOY_BPS / BPS_DENOMINATOR
              = totalAssets() × 70%

currentDeployed = strategyManager.totalManagedAssets()

require(currentDeployed + newInvestAmount <= maxDeployable, "ExceedsDeploymentCap");
```

- 此检查在 `invest()` 调用路径上执行
- `MAX_STRATEGY_DEPLOY_BPS = 7000` 为**常量**，不可由 admin 在运行时修改
- 检查基于 `totalAssets()` 实时值，随 PPS 变化自适应

### 2.2 与储备上沿的关系

| 约束 | 来源 | 关系 |
|------|------|------|
| strategy 部署 ≤ 70% | `MAX_STRATEGY_DEPLOY_BPS` 常量 | 硬上限，不可配置 |
| vault 储备 ≥ 35% 时不主动 invest | `RESERVE_CEILING_BPS` | 软约束，通过 invest() 前置检查 |
| vault 储备目标 = 30% | `RESERVE_TARGET_BPS` | rebalance() 的回撤目标 |

两个约束同时生效，取更严格者：70% 部署上限保证至少 30% 在 vault，储备上沿 35% 保证高于目标时不额外投资。

---

## 3. 禁止行为

以下行为在 V3 所有合约版本中均**绝对禁止**，包含在 strategy 合约内：

| 禁止行为 | 说明 |
|----------|------|
| 杠杆循环（Loop/Recursive leverage） | 禁止通过借出→再存入→再借出等方式放大头寸 |
| 递归借贷（Recursive borrowing） | 禁止在 Aave 上调用 `borrow()` 或任何借款类函数 |
| 高频主动交易 | 禁止频繁买卖、套利或 MEV 相关操作 |
| 高风险协议交互 | 禁止与非主流、未经审计的 DeFi 协议交互 |
| 资金流向非 vault 地址 | `emergencyExit()` 的资金只能归还到 vault，不可流向任意地址 |
| strategy 内保留长期现金 | 资金应在 invest/divest 完成后立即结算，不得在 strategy 内长期停留 |
| 第二策略上线 | V3 初版仅一个主策略；第二策略合约不得被 strategyManager 激活 |

---

## 4. 第二策略预留接口

V3 仅在以下层面预留第二策略路径，**不实现任何代码逻辑**：

### 4.1 接口文件（预留）

```solidity
// contracts/interfaces/IStrategyV02.sol — V3 初版仅定义接口
interface IStrategyV02 {
    function invest(uint256 amount) external;
    function divest(uint256 amount) external;
    function totalUnderlying() external view returns (uint256);
    function emergencyExit() external;
}
```

### 4.2 文档占位

- 第二策略候选：预留为 Compound V3 USDC 或其他保守生息协议
- 上线条件：V4 开发周期内完成审计 + 储备模型验证后方可接入
- V3 代码中 StrategyManager 不得有任何路由到第二策略的代码路径

### 4.3 明确声明

- 前端禁止将第二策略展示为"即将上线"或"开发中"的积极承诺
- 前端仅可展示："第二策略通道预留，当前未激活"

---

## 5. Strategy 异常处理流程（5步）

当 strategy 出现异常（Aave 暂停、合约漏洞、资产异常减少等）时，按以下顺序处理：

### 步骤 1：停止新增部署

- EMERGENCY_ROLE 调用 vault 进入 Paused 模式
- 阻断所有新的 `invest()` 操作
- 已在 strategy 内的资金不受影响

### 步骤 2：暂停常规交互

- 视情况暂停 vault 存款（`depositsPaused = true`）
- 评估是否需要进入 EmergencyExit 模式

### 步骤 3：评估可回撤资产

- 调用 `strategy.totalUnderlying()` 查看账面余额
- 尝试小额 `divest()` 验证 Aave 流动性是否可用
- 生成链下评估报告，决定是否触发 partialEmergencyExit 或 emergencyExit

### 步骤 4：资金回注 vault

- 若 Aave 流动性正常：执行 `strategyManager.divest(amount)` + `returnToVault(amount)` 分批回注
- 若 Aave 流动性受限：执行 `strategyManager.partialEmergencyExit(amount)` 分批处理
- 回注资金自动增加 vault idle USDC，储备率恢复

### 步骤 5：紧急路径

- 若常规回注路径失败：Admin（经 Timelock 或紧急绕过机制）调用 `strategyManager.emergencyExit()`
- strategy 将所有 aUSDC 赎回为 USDC 并转回 vault
- vault 进入 EmergencyExit 模式，开启 Exit Round
- 用户通过 Exit Round 申领 USDC

### 5.1 步骤间的判断标准

| 判断点 | 触发条件 |
|--------|---------|
| 进入步骤 2 | 策略异常持续 > 1 小时或损失超过阈值（实现时确定具体值） |
| 进入步骤 3 | 需要评估损失规模时 |
| 进入步骤 4 | 评估完成，确定可回撤量 |
| 进入步骤 5 | 常规回撤失败，或评估发现重大资产损失 |

---

## 6. partial / full emergencyExit 均支持

### 6.1 partialEmergencyExit(uint256 amount)

- 从 strategy 赎回指定 `amount` USDC，归还到 vault
- 可多次调用，分批处理
- 适用于 Aave 流动性受限、需要分批赎回的场景

### 6.2 emergencyExit()（全额）

- 将 strategy 内所有 aUSDC 赎回为 USDC，全部归还 vault
- 执行后 `strategy.totalUnderlying() == 0`
- 归还目标地址只能是 vault 合约地址（不可配置为任意地址）

### 6.3 资金流向约束

```solidity
// strategy.emergencyExit() 内部约束
require(msg.sender == strategyManager, "OnlyStrategyManager");
// 资金只能转到 vault 地址（hardcoded at strategy deploy time）
usdc.safeTransfer(vault, amount);
```

- `vault` 地址在 strategy 部署时通过构造函数设置为不可变（`immutable`）
- strategy 合约内不存在可修改 vault 地址的函数
