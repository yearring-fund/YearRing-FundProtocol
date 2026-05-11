# YearRing Fund Protocol — Closed Beta 用户说明

> 版本：Closed Beta v1  
> 链：Base Mainnet（Chain ID: 8453）  
> 最后更新：2026-05-07

---

## 1. 当前阶段

本协议处于 **closed beta（封闭测试）阶段**。

参与需要通过 allowlist 审核。Closed beta 的目的，是在受控条件下验证 YearRing Core Vault、allowlist、Aave V3 strategy、lock / points / rebate 等核心链上流程在小规模真实环境下的表现。

Closed beta 不是公开发布，也不代表协议已经进入正式运营阶段。

---

## 2. 合约状态

所有合约已部署在 Base 主网，并完成了内部主网演练与基础链上流程验证。

**合约尚未经过外部安全审计。** 这是已知限制，不会在 closed beta 阶段内消除。协议代码处于早期验证阶段，存在未被发现的漏洞的可能性。

核心合约地址：

| 合约 | 地址 |
|---|---|
| YearRing Core Vault (yrCORE) | `0x2D2C7BbE92571FF28A23e44d19232e9137F3a310` |
| TreasuryV02 | `0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083` |
| LockPointsRebateManager | `0x03987638d7a0522c2e1521714e46D486628c87a0` |
| PointsToken (YRPTS) | `0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c` |

所有合约可在 [basescan.org](https://basescan.org) 查询。

---

## 3. 准入方式

存款前需通过 allowlist。

allowlist 由管理员通过 Safe 多签钱包调用 `vault.addToAllowlist()` 操作。未在 allowlist 内的地址无法存款。

---

## 4. 初始策略

当前唯一运行的策略是 **Aave V3 USDC（Base 主网）**。

存款资产为 USDC。用户存入 USDC 后，协议可将部分资产通过 Aave V3 USDC supply market 部署，以获得可变供应利率收益。

协议设有 **30% 目标闲置储备**（`reserveRatioBps = 3000`）。这是一个管理目标，不是固定的赎回保障——集中的大额同步赎回仍有可能超出当前闲置储备。

---

## 5. 收益说明

协议无法保证任何收益。

实际收益取决于 Aave V3 的实时 USDC 供应利率，该利率随市场供需变化。利率可能升高，也可能降低，也可能接近零。

协议收取管理费：**4 bps/月（约 0.48%/年）**。管理费通过协议会计机制计入 Treasury，不会要求用户额外转账支付，但会降低用户的净收益，并可能反映在 vault share 的净值表现中。

---

## 6. 锁仓、Points 与 Rebate

### 锁仓

用户可将 yrCORE（vault shares）锁定一段时间（最长 365 天）以获得 Points（YRPTS）和 rebate 资格。锁仓是可选操作。

### 提前退出（Early Exit）

锁仓期内如需提前退出：

- 用户需将本次锁仓所得的全部 YRPTS **归还给 Treasury**（全额，不支持部分归还）
- Rebate 按比例结算
- yrCORE 解锁返还

提前退出不能选择性地保留部分 Points。

### 正常到期解锁

锁仓到期后正常解锁：Points（YRPTS）由用户保留，无需归还。

### Rebate

Rebate 是协议对锁仓行为的激励机制：管理费的一部分以 yrCORE shares 形式返还给符合条件的锁仓用户。Rebate 金额取决于锁仓规模、时长和 Treasury 的实际余额，不保证固定金额。

---

## 7. Points（YRPTS）的阶段性含义

YRPTS 是协议在 closed beta 阶段用于记录用户参与度的积分代币，为 ERC-20 格式。

**YRPTS 不是已确认的协议原生代币，不代表股权、债权、收益权、治理权，也不构成任何未来空投、兑换或经济权益的承诺。**

GovernanceSignal（治理信号）功能在 closed beta 阶段处于**非约束性**模式：投票结果仅作信号记录，不触发任何链上执行。前端界面会标注这一限制。

---

## 8. 管理员权限

全部管理员权限由 **Safe 多签钱包**控制：

- 地址：`0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8`
- 配置：Base Safe L2 v1.4.1，门限 2/2

部署者 EOA 已于 2026-05-07 撤销全部管理员角色。

管理员权限的操作范围包括：调整储备比例、pauseDeposits/unpauseDeposits、策略 invest/divest、allowlist 管理等。

Closed beta 阶段**无 timelock**：管理员操作即时生效，无延迟。

---

## 9. 风险提示

在参与前，请确认你已理解以下内容：

- 合约未经外部审计，存在未知漏洞风险
- 收益不固定，可能为零
- 本金不受保障：智能合约漏洞、策略风险、外部协议风险或极端市场情况都可能导致本金损失
- Aave V3 本身也存在流动性风险、智能合约风险和市场风险
- 提前退出将损失本次锁仓获得的全部 Points
- 协议处于早期测试阶段，参数可能由管理员调整

**请仅投入你可以承受全部损失的小额资金。**

---

## 10. 合约可见性

所有合约均已在 Basescan 开源并验证。用户可自行查阅合约代码，协议不依赖黑盒逻辑。

---

*YearRing Fund Protocol — Closed Beta 用户说明*  
*仅供 allowlist 封闭测试参与者阅读。*  
*SiLugang — 2026-05-07*
