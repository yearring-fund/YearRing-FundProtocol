# docs/RESERVED_SECOND_STRATEGY_NOTES_V3.md — 第二策略预留说明

**版本：** V3 初版
**文档状态：** 已冻结（Phase 4 产出）
**最后更新：** 2026-04-01

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| P4-R1 | V3 初版不激活第二策略，StrategyManager 代码中无多策略路由路径 | 已冻结 |
| P4-R2 | 第二策略以 `IStrategyV02` 接口形式预留，不可由运行时 StrategyManager 激活 | 已冻结 |
| P4-R3 | 前端仅可展示"第二策略通道预留，当前未激活"，不得暗示即将上线 | 已冻结 |

---

## 1. V3 初版边界

V3 初版中，`StrategyManagerV01` 仅持有一个 `strategy` 插槽（`address public strategy`）。

- 不存在策略数组
- 不存在多策略资金路由逻辑
- `setStrategy()` 强制要求旧策略完全撤出后方可切换（`OldStrategyNotEmpty` 错误）

**结论：V3 代码层面不可能同时激活两个策略。**

---

## 2. 预留接口位置

```
contracts/interfaces/IStrategyV02.sol
```

此接口仅作文档性标注，定义未来第二策略必须实现的函数签名：

```solidity
interface IStrategyV02 {
    function invest(uint256 amount) external;
    function divest(uint256 amount) external returns (uint256 withdrawn);
    function totalUnderlying() external view returns (uint256);
    function emergencyExit() external;
    function partialEmergencyExit(uint256 amount) external;
    function underlying() external view returns (address);
}
```

---

## 3. 第二策略候选（V4+ 参考）

| 候选协议 | 类型 | 上线前置条件 |
|----------|------|-------------|
| Compound V3 USDC（Base） | 保守生息 | 独立审计 + 储备模型验证 |
| Morpho Base USDC | 聚合生息 | 独立审计 + 储备模型验证 |
| 国债 RWA 通道（SPV） | RWA | 法律结构确认 + 独立审计 |

上线条件（全部满足方可接入）：
1. 通过独立合约审计
2. 完成 V4 多策略储备模型验证
3. Admin 通过 Timelock 执行 `setStrategy()` 切换

---

## 4. 前端展示要求

前端**禁止**：
- 展示第二策略为"开发中"、"即将上线"等正面承诺
- 将第二策略候选收益写入"核心承诺基础收益"

前端**允许**：
- 展示："多策略通道已预留接口，当前未激活"
- 展示产品路线图中的 V4 目标（明确标注为非承诺）

---

## 5. StrategyManager 升级路径

V4+ 若需多策略支持，应升级为 `StrategyManagerV02`，新增：
- 策略注册表（mapping / array）
- 权重分配机制
- 独立 investCap 与 minIdle 配置

升级必须通过 Timelock 执行，且需完成新版本审计。
