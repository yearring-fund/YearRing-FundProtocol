# docs/PRODUCT_POSITIONING_V3.md — FinancialBase V3 产品定位规范

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D1 | 锁仓档位乘数采用档内线性插值（非固定基础乘数） | 已冻结 |
| D2 | Exit Round 与 EmergencyExit 模式共存（Exit Round 是 EmergencyExit 内的有序退出路径） | 已冻结 |
| D3 | 非紧急操作 Timelock 延迟 = 24 小时 | 已冻结 |
| D4 | 合规钩子仅文档+接口预留，V3 初版无代码实现 | 已冻结 |
| D5 | rebalance() 冷却 = 最短间隔 1 小时 | 已冻结 |
| D6 | EMERGENCY_ROLE 只能暂停；恢复 Normal 只能由 Admin 经 timelock 操作 | 已冻结 |

---

## 1. V3 定位

FinancialBase V3 是链上基金的初版正式运行形态，定位为：

- **单策略 USDC 保守生息基金**：唯一在线主策略为 Aave V3 USDC 低风险存款，持有 aUSDC 获取 Aave 供应利率。
- **受邀准入**：非无门槛（非 permissionless）。V3 初版采用邀请制白名单，仅受邀地址可参与存款。
- **初版正式运行（非演示）**：V2 为演示/测试阶段；V3 为首个正式运行版本，处理真实用户资产。
- **非完全去中心化**：Admin（multisig）权限在合约内明确存在，非匿名，有时间锁约束。

---

## 2. 目标用户

| 用户类型 | 说明 |
|----------|------|
| 受邀白名单参与者 | 由运营方邀请，钱包地址经 allowlist 审核 |
| 早期社区参与者 | 了解初版风险，愿意以 USDC 参与稳定生息 |

V3 初版明确排除：
- 匿名无门槛公众存款
- 高风险追求者（V3 只提供 Aave USDC 基础收益）
- 期望完全去中心化、无 admin 权限的用户

---

## 3. 必须实现 / 绝对不做 / 后续预留 / 不属于 V3 初版

### 3.1 必须实现（V3 初版上线前完成）

| 功能 | 说明 |
|------|------|
| ERC4626 Vault（fbUSDC） | 用户以 USDC 存款，持有 fbUSDC shares |
| Aave V3 USDC 主策略 | 唯一在线收益策略，低风险供款模式 |
| 储备三段区间 | Floor 15% / Target 30% / Ceiling 35%，链上强制 |
| `rebalance()` 函数 | permissionless，1小时冷却，仅补回到 target 30% |
| 三态状态机 | Normal / Paused / EmergencyExit |
| 锁仓+RWT 模块 | position-based，Bronze/Silver/Gold，线性乘数插值 |
| 管理费折扣返现 | 按日累计，随时可按已持有时长申领 |
| 邀请制白名单 | 仅白名单地址可存款 |
| EMERGENCY_ROLE | 只能 pause，与 Admin 操作权限分离 |
| 24小时 Timelock | 覆盖所有 DEFAULT_ADMIN_ROLE 参数操作 |
| EmergencyExit Exit Round | 快照+按比例申领的有序退出路径 |
| 前端状态披露 | 系统状态 / 存款赎回开放状态 / 储备区间 / admin 权限声明 |

### 3.2 绝对不做（V3 初版及后续均不允许）

| 禁止行为 | 原因 |
|----------|------|
| admin 手写 NAV / setTotalAssets / setPps | 破坏基于 share 的比例会计公正性 |
| adminMintShares / adminBurnUserShares | 直接侵害用户资产 |
| 将 RWT 价格上涨计入基金收益 | RWT 不属于 NAV，不影响 PPS |
| 杠杆循环、递归借贷 | 违反低风险单策略定位 |
| emergencyExit 资金流向非 vault 地址 | 违反资产托管安全边界 |
| 宣称完全去中心化 | admin/multisig 权限在 V3 明确存在 |
| 宣称无条件即时现金赎回 | 储备区间机制下无法保证 |

### 3.3 后续预留（接口/文档预留，代码不上线）

| 预留项 | 预计阶段 |
|--------|----------|
| 第二收益策略接口 | V4 |
| Chainlink Automation（checkUpkeep / performUpkeep） | V4 |
| 合规 hook（allowlist / blacklist / jurisdiction gating） | V4+ |
| RWA 路径接口（legal-holder / nominee / SPV） | V5+ |
| 完整 DAO 执行治理 | V5+ |

### 3.4 不属于 V3 初版正式运行

| 功能 | 说明 |
|------|------|
| 多策略路由 | V3 仅单策略 |
| 自动再平衡（Chainlink Automation） | 仅接口预留，V4 实现 |
| 公链/无门槛访问 | 邀请制准入 |
| 完整 DAO 投票执行 | 治理桥接为信号投票，不执行 |
| RWT 流动性挖矿 / 二级市场 | 不在基金功能范围内 |

---

## 4. 产品承诺边界

### 4.1 基础承诺

| 承诺 | 来源 | 说明 |
|------|------|------|
| 基础收益（Base Yield） | Aave V3 USDC 供款利率 | 随市场波动，不保证固定利率 |
| 锁仓返现（Fee Rebate） | 管理费折扣，按日累计 | 仅返还用户自身管理费的折扣部分 |
| RWT 奖励 | 锁仓时一次性发放 | 按仓位大小 × 档位乘数 × 锁仓天数计算 |

### 4.2 明确不承诺

- **不承诺价格保本**：NAV/PPS 随 Aave 收益变化，亦可能因 Aave 协议风险下降。
- **不承诺即时流动性**：赎回依赖储备区间状态，EmergencyExit 模式下走 Exit Round 有序退出。
- **不承诺 RWT 价值**：RWT 不计入 NAV，其市场价格波动不构成基金收益或亏损。

---

## 5. Admin / Multisig 权限声明

V3 初版合约内存在以下受约束的管理员权限：

| 权限 | 持有者 | 约束 |
|------|--------|------|
| 参数设置（费率、储备比例） | DEFAULT_ADMIN_ROLE（multisig） | 须经 24h Timelock |
| 策略切换 | DEFAULT_ADMIN_ROLE（multisig） | 须经 24h Timelock |
| 暂停系统 | EMERGENCY_ROLE | 仅能暂停，不能修改参数 |
| 升级 strategy 合约 | UPGRADER_ROLE | 仅可升级非核心合约；核心 vault 不可升级 |
| 治理提案创建 | PROPOSER_ROLE | 仅信号投票，不执行 |

**以上权限的存在为公开信息，前端必须明确展示。**

---

## 6. 与 V2 的继承关系

| 层级 | V2 状态 | V3 继承/变更 |
|------|---------|-------------|
| FundVaultV01（ERC4626 核心） | 已上线演示 | V3 继续使用，补充储备三段区间常量和状态机重命名 |
| StrategyManagerV01 | 已上线演示 | V3 增加 rebalance()、70% 硬上限、EMERGENCY_ROLE 接口 |
| AaveV3StrategyV01 | 已上线演示 | V3 作为唯一主策略，不变 |
| LockLedgerV02 | 已上线演示 | V3 继续使用，加入线性插值乘数逻辑 |
| LockRewardManagerV02 | 已上线演示 | V3 继续使用，RWT 计算公式接入线性乘数 |
| GovernanceSignalV02 | 已上线演示 | V3 增加 PROPOSER_ROLE 分离 |
| 合规 hook | V2 无实现 | V3 仅接口预留，无代码实现 |
| Timelock | V2 无实现 | V3 新增 TimelockController，24h 延迟 |
| 邀请制白名单 | V2 无实现 | V3 上线，链上 allowlist 地址检查 |

---

## 7. V3 初版与后续版本路线图（高层次）

| 版本 | 核心特征 |
|------|---------|
| V3 初版（当前） | 邀请制白名单 + 单策略 Aave + 锁仓/RWT + 24h Timelock + 三段储备区间 |
| V4 | Chainlink Automation + 第二策略接入 + 合规 hook 代码实现 |
| V5+ | 完整 DAO 治理执行 + RWA 路径 + permissionless 开放 |
