# docs/AAVE_MAIN_STRATEGY_BOUNDARY_V3.md — Aave V3 主策略边界

**版本：** V3 初版
**文档状态：** 已冻结（Phase 4 产出）
**最后更新：** 2026-04-01

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| P4-D1 | V3 初版唯一在线主策略为 AaveV3StrategyV01（Aave V3 Base 网络 USDC） | 已冻结 |
| P4-D2 | 第二策略仅以 IStrategyV02 接口形式预留，V3 初版不激活 | 已冻结 |
| P4-D3 | invest() 仅在 Normal 模式下执行；divest/emergencyExit 不受模式限制 | 已冻结 |
| P4-D4 | 70% 最大部署上限为链上硬约束（`MAX_STRATEGY_DEPLOY_BPS = 7000`），不可运行时修改 | 已冻结 |
| P4-D5 | emergencyExit() 资金只能归还到 vault（通过 StrategyManager 转发） | 已冻结 |

---

## 1. 策略身份与配置

| 属性 | 值 |
|------|----|
| 合约名称 | `AaveV3StrategyV01` |
| 底层协议 | Aave V3（Base L2） |
| 存款资产 | USDC（Base native USDC） |
| 持有凭证 | aUSDC（Aave Interest Bearing Token） |
| 收益机制 | aToken 余额随时间增长（Aave Supply APY） |
| 风险定位 | 低风险，保守生息 |
| 调用方 | 仅 `StrategyManagerV01`（`onlyManager` 修饰符硬约束） |

---

## 2. 资金流向

```
FundVaultV01
    │
    │  transferToStrategyManager(amount)
    ▼
StrategyManagerV01
    │
    │  invest(amount)  →  transfer to AaveV3StrategyV01
    ▼                         │
AaveV3StrategyV01             │  pool.supply(usdc, amount)
    │                         ▼
    │                    Aave V3 Pool (Base)
    │                         │  yield → aToken balance grows
    │  divest(amount)   ◄──────
    ▼
USDC back to StrategyManagerV01
    │
    │  returnToVault(amount)
    ▼
FundVaultV01
```

- 资金在 vault → manager → strategy → Aave 之间流转，`totalAssets()` 保持不变
- emergencyExit() 路径：strategy → manager → vault（自动转发）

---

## 3. 操作权限矩阵

| 操作 | 调用者 | 允许模式 | 说明 |
|------|--------|----------|------|
| `invest()` | DEFAULT_ADMIN_ROLE | Normal 模式 | 非 Normal 模式时 revert `NotInNormalMode` |
| `divest()` | DEFAULT_ADMIN_ROLE | 任意 | 不受 vault 模式限制 |
| `returnToVault()` | DEFAULT_ADMIN_ROLE | 任意 | 不受 vault 模式限制 |
| `emergencyExit()` | DEFAULT_ADMIN_ROLE | 任意 | 自动转发所有资金到 vault |
| `partialEmergencyExit()` | DEFAULT_ADMIN_ROLE | 任意 | 指定金额，自动转发到 vault |
| `setStrategy()` | DEFAULT_ADMIN_ROLE | Paused（manager） | 旧策略必须已全额回撤 |

---

## 4. 70% 部署上限机制

### 4.1 检查位置

`FundVaultV01.transferToStrategyManager()` 内：

```solidity
uint256 total = totalAssets();
uint256 strategyAssets = IStrategyManagerV01(strategyManager).totalManagedAssets();
if ((strategyAssets + amount) * BPS_DENOMINATOR > total * MAX_STRATEGY_DEPLOY_BPS)
    revert MaxDeployExceeded();
```

- `MAX_STRATEGY_DEPLOY_BPS = 7000`（常量，不可配置）
- 基于实时 `totalAssets()` 计算，随 PPS 变化自适应
- 防止 admin 在运行时绕过此上限

### 4.2 与储备区间的双重约束

```
可部署量 = min(availableToInvest(), 70% × totalAssets - currentDeployed)
```

- `availableToInvest()` = `totalAssets × (1 - reserveRatioBps/10000)`（软约束，可配置）
- `MAX_STRATEGY_DEPLOY_BPS`（硬约束，不可配置）
- 两者同时生效，取更严格者

---

## 5. totalUnderlying() 不过报原则

```solidity
// AaveV3StrategyV01
function totalUnderlying() external view override returns (uint256) {
    return aToken.balanceOf(address(this)) + underlyingToken.balanceOf(address(this));
}
```

- 仅计入有链上状态支撑的资产（aToken 账面余额 + 合约内 idle USDC）
- 不包含 Aave 激励代币（AAVE/stkAAVE）
- 不包含外部预估收益
- 若 Aave 暂停赎回，仍按 aToken 余额报告（偏保守，允许暂时低估）

### StrategyManager 软保护

```solidity
try IStrategyV01(strategy).totalUnderlying() returns (uint256 val) {
    strategyAssets = val;
} catch {
    strategyAssets = 0; // 保守回退：仅报告 idle 部分
}
```

- strategy 调用失败时不 revert vault 操作
- 报告结果偏低，不虚报资产

---

## 6. 绝对禁止行为

| 禁止行为 | 说明 |
|----------|------|
| 调用 `pool.borrow()` | 禁止任何借款操作 |
| 杠杆循环 | 禁止存入→借出→再存入等放大头寸行为 |
| 递归借贷 | 禁止嵌套借贷路径 |
| 与第三方 swap/AMM 协议交互 | 禁止非 Aave 的外部 DeFi 协议调用 |
| emergencyExit 资金流向非 vault 地址 | `manager` 地址为 immutable，emergencyExit 路径固定 |
| 在 strategy 内长期保留 idle USDC | 所有 invest/divest 结算后不得留存 idle 余额 |

---

## 7. 策略异常处理（5步）

| 步骤 | 动作 | 调用者 |
|------|------|--------|
| 1 | `vault.setMode(Paused)` — 阻止新增 invest | EMERGENCY_ROLE |
| 2 | `vault.pauseDeposits()` — 视情况暂停存款 | EMERGENCY_ROLE |
| 3 | 评估：`strategy.totalUnderlying()` + 小额 divest 测试 | Admin（链下） |
| 4 | `manager.divest(amount)` + `manager.returnToVault(amount)` — 分批回注 | DEFAULT_ADMIN_ROLE |
| 5 | `manager.emergencyExit()` — 全额撤出 + vault 进入 EmergencyExit | DEFAULT_ADMIN_ROLE |

详细判断标准见 `docs/STRATEGY_RULES_V3.md` §5。

---

## 8. Aave V3 合约地址（Base 网络）

*注：以下地址为部署参考，正式部署前须通过 Aave 官方文档核实。*

| 合约 | 地址 |
|------|------|
| Aave V3 Pool (Base) | 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5 |
| aUSDC (Base) | 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB |
| USDC (Base native) | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |

---

## 9. Phase 4+ 待实现项

| 项目 | 状态 |
|------|------|
| Aave V3 实际部署与集成测试（Base fork） | Phase 4：需 Hardhat fork 测试 |
| Aave 激励代币（AAVE/stkAAVE）处理策略 | Phase 4：不纳入 NAV，由 Admin 定期处理 |
| Aave 赎回流动性不足时的分批处理逻辑 | Phase 5：partialEmergencyExit 增强 |
