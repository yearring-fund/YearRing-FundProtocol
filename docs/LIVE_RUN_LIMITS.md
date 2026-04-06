# LIVE_RUN_LIMITS.md — Step3 运行参数权威来源

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）
状态：生效中

---

## 一、参与资格

| 条件 | 说明 |
|---|---|
| 准入方式 | 仅受邀地址（Allowlist 制度） |
| 当前白名单数量 | 5 个地址（见下表） |
| 白名单来源 | ADMIN 通过 `scripts/step3/allowlist_batch.ts` 写入链上 |
| 非白名单行为 | `deposit()` 在链上被拒绝（`isAllowed[receiver]` 检查） |
| 退出不受限 | `redeem()` 不检查 `isAllowed`，任何时候可赎回 |
| 白名单全局开关 | **V01 无全局开关**；白名单始终生效。"暂停所有存款"使用 `pauseDeposits()`（EMERGENCY_ROLE / ADMIN），不影响 redeem |

---

## 二、当前白名单地址

| 标识 | 地址 |
|---|---|
| User-A | `0xa7C381eA23E12B83500A5D3eEE850068740B0339` |
| User-B | `0x9d84145F057C2fd532250891E9b02BDe0C92CcB4` |
| User-C | `0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B` |
| User-D | `0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe` |
| User-E | `0x6248C59f517e096258C611578a19F80e594E379B` |

> 权威来源：链上 `FundVaultV01.isAllowed(address)`，以链上状态为准。

---

## 三、三类限额（Step3 核心参数）

| 限额类型 | 数值 | 执行层 | 口径说明 |
|---|---|---|---|
| **单地址累计持仓上限** | 2,000 USDC | 脚本层（软检查） | `convertToAssets(balanceOf(addr))` 估算当前持仓市值 + 本次存款额 |
| **单日新增总存入上限** | 5,000 USDC | 脚本层（软检查） | 按 UTC 自然日计算，记录于 `evidence/daily_deposits.json` |
| **存款触发 TVL 上限** | 20,000 USDC | 脚本层（软检查） | `vault.totalAssets() + 本次存款额 > 20,000 USDC` 则拒绝（`deposit.ts TVL_CAP`） |
| **策略部署上限** | 20,000 USDC | 链上（硬上限） | `StrategyManagerV01.investCap = 20,000 USDC`，`invest()` 时链上强制，触发 `CapExceeded` |

> **口径说明**：
> - `investCap`（链上）限制的是**向 Aave 策略部署的资金量**（`strategy.totalUnderlying ≤ investCap`），不直接限制 `totalAssets`。
> - `TVL_CAP`（脚本层）以 `vault.totalAssets()` 为口径，阻止存款导致 Vault 总资产超过 20,000 USDC。
> - 两者数值相同（20,000 USDC），在日常运营（ADMIN 定期 invest）中趋于一致，但技术口径不同。
>
> **注意**：per-user、TVL_CAP、daily 三类上限均为脚本层软检查（V01 合约无此逻辑）。`BYPASS_LIMITS=true` 可绕过，仅限 ADMIN 使用；BYPASS_LIMITS 操作不计入 daily tracker。

---

## 四、最小存款金额

| 参数 | 数值 | 执行层 |
|---|---|---|
| 最低单次存款 | 1 USDC | 脚本层检查（`deposit.ts` `MIN_DEPOSIT_USDC`） |

---

## 五、链上关键参数（权威：链上读取）

| 参数 | 设定值 | 链上合约 | 设置 tx block |
|---|---|---|---|
| `investCap` | 20,000 USDC | `StrategyManagerV01` | 44271104 |
| `minIdle` | 0 USDC | `StrategyManagerV01` | 44271104 |
| 白名单启用 | 是（`isAllowed` 检查在 `_deposit()` hook） | `FundVaultV01` | — |

---

## 六、合约地址（Step3 使用）

| 合约 | 地址 |
|---|---|
| FundVaultV01 | `0x8acaec738F9559F8b025c4372d827D3CD3928322` |
| StrategyManagerV01 | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` |
| AaveV3StrategyV01 | `0x621CC4189946128eF2d584F69bb994C84FcA612D` |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

> 权威来源：`deployments/base.json`

---

## 七、PPS 说明（Step3 启动时的特殊情况）

- Step2 结束后 Vault 残留微量 USDC（~0.0001 USDC）和未销毁 shares（~0.00012 fbUSDC）
- 导致当前 `pricePerShare ≈ 0.818 USDC/fbUSDC`（非 1.0）
- **不影响功能**：ERC4626 机制正常，新用户按当前 PPS 获得对应 shares
- 随着 Step3 新存款进入，PPS 会趋向均值后恢复正常区间
- 前端展示时已附注说明

---

## 八、日常查询方式

```bash
# 查询所有限额与白名单持仓状态
npx hardhat run scripts/step3/query_limits.ts --network base

# 实时监控快照（含进度条 + 预警，保存 evidence）
npx hardhat run scripts/step3/monitor.ts --network base
```

---

## 九、参数变更流程

1. 限额调整（investCap）：由 ADMIN 执行 `scripts/step3/set_invest_cap.ts`，链上生效
2. 白名单新增：由 ADMIN 执行 `scripts/step3/allowlist_add.ts`（单地址）或 `allowlist_batch.ts`（批量）
3. 脚本层限额调整（PER_USER_CAP / DAILY_CAP / TVL_CAP）：同步修改 `deposit.ts` 和 `monitor.ts` 中的常量，并更新本文档
4. 所有变更须更新 `docs/LIVE_RUN_LIMITS.md` 并记录操作日志

---

*本文档为 Step3 运行参数的权威来源。如脚本参数与本文档不一致，以链上状态为准，其次以本文档为准。*
