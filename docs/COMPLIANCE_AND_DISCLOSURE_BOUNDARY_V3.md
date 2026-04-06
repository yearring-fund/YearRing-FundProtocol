# docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md — FinancialBase V3 合规与披露边界

**版本：** V3 初版
**文档状态：** 已冻结
**最后更新：** 2026-03-30

---

## 冻结决策

| 编号 | 决策 | 状态 |
|------|------|------|
| D4 | 合规 hook = 文档 + 接口预留，V3 初版无代码实现 | 已冻结 |
| D_COM_1 | V3 初版准入模型 = 邀请制白名单，非无门槛 permissionless | 已冻结 |
| D_COM_2 | RWA 路径接口预留，V3 不实现 | 已冻结 |
| D_COM_3 | 不得宣称该产品为证券承销替代品 | 已冻结 |

---

## 1. V3 初版准入模型

### 1.1 邀请制白名单

- V3 初版采用**邀请制（Invitation-only）**准入，非无门槛公开访问
- 仅经邀请且经运营方审核的钱包地址可参与存款
- 白名单管理由链上 allowlist 合约（或 vault 存款前置检查）执行

### 1.2 白名单机制实现要求（V3 初版上线前完成）

| 要求 | 说明 |
|------|------|
| allowlist 存储 | 合约内维护 `mapping(address => bool) isAllowed` |
| 存款前置检查 | `_beforeDeposit(address depositor)` 检查 `isAllowed[depositor]` |
| 白名单管理权 | 由 `DEFAULT_ADMIN_ROLE` 通过 Timelock 操作（添加/移除地址） |
| 移除白名单效果 | 移除后不影响已有持仓，仅阻止新存款 |

---

## 2. 合规 Hook 接口预留（V3 无代码实现）

以下合规机制在 V3 初版**仅预留接口和文档**，不实现任何代码逻辑：

### 2.1 预留接口列表

| 接口 | 预留方式 | V3 实现状态 |
|------|----------|------------|
| `IComplianceHook.isAllowed(address)` | 接口文件 | 仅接口声明，无实现 |
| `IBlacklist.isBlacklisted(address)` | 接口文件 | 仅接口声明，无实现 |
| `IJurisdictionGate.isPermitted(address, jurisdiction)` | 接口文件 | 仅接口声明，无实现 |

### 2.2 合规 Hook 调用点（V3 预留位置）

在以下位置预留注释占位，V4 实现时在此处接入合规 hook：

```solidity
// V3: 仅白名单检查
// V4: 接入 IComplianceHook (allowlist + blacklist + jurisdiction)
function _beforeDeposit(address depositor) internal view {
    require(isAllowed[depositor], "NotWhitelisted");
    // TODO(V4): complianceHook.isAllowed(depositor)
    // TODO(V4): blacklist.isBlacklisted(depositor)
    // TODO(V4): jurisdictionGate.isPermitted(depositor, userJurisdiction)
}
```

### 2.3 为什么 V3 不实现合规 Hook

- V3 初版采用邀请制白名单，已经是有效的准入控制
- 合规 hook 需要接入 Chainalysis、Elliptic 等链下数据源，需额外 oracle 或 API 集成
- V3 时间线内不具备此集成条件
- 合规 hook 的接入须经法律顾问审核，确保不引入新的法律定性风险

---

## 3. 前端必须展示的信息（强制要求）

### 3.1 系统状态

| 展示项 | 内容要求 |
|--------|---------|
| 当前系统状态 | 明确展示 "Normal" / "Paused" / "EmergencyExit" 三种状态之一 |
| 状态含义说明 | 每种状态下，简要说明用户当前可以做什么、不能做什么 |

### 3.2 存款/赎回开放状态

| 展示项 | 内容要求 |
|--------|---------|
| 存款状态 | 明确展示 "存款：开放" 或 "存款：已暂停" 状态标签 |
| 赎回状态 | 明确展示 "赎回：开放" 或 "赎回：已暂停" 状态标签 |
| EmergencyExit 下的赎回 | 展示 "退出申领：进行中（Exit Round）" 替代常规赎回状态 |

### 3.3 Admin/multisig/upgrade 权限声明

前端必须在显眼位置展示以下内容（建议放在页面底部或"关于"/风险披露区域）：

> 本协议由 multisig 多签钱包管理。参数修改须经 24 小时时间锁（TimelockController）。紧急暂停权限由独立 EMERGENCY_ROLE 持有。Strategy 合约可通过 UPGRADER_ROLE 升级，核心 Vault 合约不可升级。以上权限的存在为公开透明信息。

### 3.4 储备区间状态（非即时现金数字）

| 展示项 | 内容要求 |
|--------|---------|
| 当前储备率 | 以百分比形式展示（如 "当前储备率：32%"） |
| 区间状态标签 | "在目标区间内" / "低于下沿（15%）" / "高于上沿（35%）" |
| 三段区间参考线 | 展示 15% / 30% / 35% 三条参考线（可视化图表或文字） |
| 禁止展示 | vault 合约 USDC 绝对余额作为"可赎回金额" |

### 3.5 治理声明

| 展示项 | 内容要求 |
|--------|---------|
| 治理类型说明 | 明确标注 "治理 = 信号投票，结果不自动执行" |
| 提案执行方 | 说明 "提案执行需由 multisig 经 Timelock 手动处理" |
| V3 非完全 DAO | 在治理页面明确说明"V3 初版非完全 DAO 治理" |

### 3.6 收益分层展示

前端必须将以下三类收益**分开独立展示**，不合并：

| 收益类型 | 说明 |
|----------|------|
| 基础收益（Base Yield） | 来自 Aave V3 USDC 供款的 APY |
| 管理费返现（Fee Rebate） | 按锁仓档位折扣的管理费返还（fbUSDC） |
| RWT 奖励（RWT Reward） | 锁仓时一次性发放的 RewardToken 数量 |

---

## 4. 绝对不得声称的内容

### 4.1 关于流动性

| 禁止声明 | 原因 |
|----------|------|
| "无条件即时现金赎回" | 储备区间机制下，vault idle 可能不足以覆盖大额即时赎回 |
| "随时全额提取" | EmergencyExit 模式下改为 Exit Round 有序退出 |
| "USDC 始终足额可取" | 资产部署在 Aave，需要 divest 流程才能回到 vault |

### 4.2 关于去中心化

| 禁止声明 | 原因 |
|----------|------|
| "完全去中心化" | Admin/multisig 权限明确存在 |
| "无 admin 控制" | EMERGENCY_ROLE 和 DEFAULT_ADMIN_ROLE 均存在 |
| "代码即法律，无人可干预" | EMERGENCY_ROLE 可暂停，Admin 可经 Timelock 修改参数 |

### 4.3 关于 RWT

| 禁止声明 | 原因 |
|----------|------|
| "RWT 价格上涨是基金收益" | RWT 不计入 NAV，其价格变化与 PPS 无关 |
| "RWT 保值或保底" | RewardToken 为固定供应代币，不保证价值 |
| "持有 RWT 即获得基础收益加成" | 锁仓额外奖励仅为管理费折扣和 RWT，不是基础收益率提升 |

### 4.4 关于产品定性

| 禁止声明 | 原因 |
|----------|------|
| "本产品是证券承销替代品" | 法律风险；V3 为实验性 DeFi 协议 |
| "本产品提供法定证券" | 同上 |
| "国债收益直接分发" | V3 无 RWA 路径实现，第一策略为 Aave |

---

## 5. RWA 路径接口预留（V3 不实现）

以下 RWA 相关路径在 V3 仅作文档记录，不实现任何代码：

### 5.1 预留接口占位

```solidity
// contracts/interfaces/IRwaHolder.sol — V3 仅接口声明
interface IRwaHolder {
    /// @notice 法律持有人地址（nominee / legal entity）
    function legalHolder() external view returns (address);

    /// @notice SPV 合同标识符（链下法律文件哈希或 IPFS CID）
    function spvIdentifier() external view returns (bytes32);

    /// @notice 底层 RWA 资产是否经过法律确认
    function isLegallyVerified() external view returns (bool);
}
```

### 5.2 RWA 路径启用条件（V5+）

RWA 路径上线须满足以下条件，V3 均不满足：

| 条件 | 说明 |
|------|------|
| 法律结构 | 需设立 SPV 或 nominee 结构持有现实资产 |
| 合规审查 | 须经法律顾问就所在司法管辖区完成合规审查 |
| Oracle 接入 | 需要链下资产价值的可信 oracle 喂价 |
| 赎回流程 | 现实资产赎回周期与链上赎回语义的协调机制 |

### 5.3 明确声明

- V3 初版第一策略为 Aave V3 USDC，不涉及任何现实资产
- 不得将 V3 描述为"国债直接投资通道"或"证券上链"
- RWA 为技术路线图上的远期探索，非承诺

---

## 6. 合规 Hook 实现路线图（仅记录，非 V3 承诺）

| 版本 | 预计合规能力 |
|------|------------|
| V3 初版 | 邀请制白名单（allowlist） |
| V4 | 链上 blacklist / sanctions screening hook（接入第三方数据） |
| V4+ | 司法管辖区 gating hook（基于 geolocation oracle 或 ZK 证明） |
| V5+ | RWA 合规持有结构（SPV / nominee / 法律文件 on-chain hash） |

---

## 7. 合规披露汇总声明模板

以下为前端风险披露区域的参考文本：

> **风险披露**
>
> FinancialBase V3 是基于 Base 网络的实验性 DeFi 协议，当前处于邀请制初版运行阶段。
>
> - 本协议不保证资产增值或资本保全。基础收益来自 Aave V3 USDC 存款，随市场利率波动。
> - 赎回依赖协议储备区间状态。紧急情况下采用 Exit Round 有序退出机制。
> - RWT（奖励代币）不计入基金净值（NAV），其价格变化不构成基金收益或亏损。
> - 本协议由 multisig 多签钱包管理，核心参数修改须经 24 小时时间锁。
> - 治理投票为信号层投票，结果不自动执行，须由 admin 人工处理。
> - 本协议不是证券，不构成投资建议，亦非证券承销替代品。
> - 参与前请充分理解智能合约风险、协议风险及流动性风险。
