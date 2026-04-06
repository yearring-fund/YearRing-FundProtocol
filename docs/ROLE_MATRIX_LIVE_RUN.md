# ROLE_MATRIX_LIVE_RUN.md — Step3 角色权限矩阵

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）
状态：生效中

---

## 一、角色定义

| 角色 | 标识 | 实际钱包 | 用途 |
|---|---|---|---|
| **DEFAULT_ADMIN_ROLE** | `keccak256("DEFAULT_ADMIN_ROLE")` 的 bytes32 zero（OZ 约定） | `0x087ea7F67d9282f0bdC43627b855F79789C6824C`（ADMIN） | 所有管理操作，唯一能解除限制的角色 |
| **EMERGENCY_ROLE** | `keccak256("EMERGENCY_ROLE")` | `0xC8052cF447d429f63E890385a6924464B85c5834`（GUARDIAN） | 仅具"刹车"能力，不能恢复正常运营 |
| **TREASURY** | 不是 AccessControl 角色，是地址参数 | `0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705` | 管理费接收地址 |

> 角色分配来源：`deployments/base.json` + 链上 `hasRole()` 验证

---

## 二、Timelock 说明

**Step3 阶段无 Timelock。** 所有 DEFAULT_ADMIN_ROLE 操作均可由 ADMIN 钱包直接执行，无延迟保护。

这是已知设计决策：
- Step3 规模小（≤5 地址，≤20,000 USDC），操作纪律可通过人工流程保证
- V01 合约注释中已说明"生产环境建议通过 Timelock"（D2 治理规则）
- 是否引入 Timelock 属于 Step4 决策，不在 Step3 范围内

---

## 三、FundVaultV01 权限矩阵

| 操作 | DEFAULT_ADMIN_ROLE | EMERGENCY_ROLE | 任意地址 | 备注 |
|---|---|---|---|---|
| `deposit(amount, receiver)` | — | — | ✅ 需 receiver 在 allowlist | 白名单检查在 `_deposit()` hook |
| `redeem(shares, receiver, owner)` | — | — | ✅ 无限制 | **不检查 allowlist，退出始终可用** |
| `claimExitAssets(roundId, shares)` | — | — | ✅ EmergencyExit 模式下 | |
| `pauseDeposits()` | ✅ | ✅ | ❌ | 独立标志，不影响 redeem |
| `unpauseDeposits()` | ✅ | ❌ | ❌ | EMERGENCY_ROLE 不能自行解除 |
| `pauseRedeems()` | ✅ | ✅ | ❌ | 极端情况才用；慎用 |
| `unpauseRedeems()` | ✅ | ❌ | ❌ | |
| `setMode(Paused=1)` | ✅ | ✅ | ❌ | EMERGENCY_ROLE 只能设 Paused，不能设 EmergencyExit |
| `setMode(Normal=0)` | ✅ | ❌ | ❌ | |
| `setMode(EmergencyExit=2)` | ✅ | ❌ | ❌ | ADMIN 专属，结合 manager.emergencyExit() 使用 |
| `openExitModeRound(assets)` | ✅ | ❌ | ❌ | EmergencyExit 模式下开放用户按比例赎回 |
| `closeExitModeRound()` | ✅ | ❌ | ❌ | |
| `addToAllowlist(addr)` | ✅ | ❌ | ❌ | 零地址会 revert |
| `removeFromAllowlist(addr)` | ✅ | ❌ | ❌ | 移除不影响已有持仓退出 |
| `transferToStrategyManager(amount)` | ✅ | ❌ | ❌ | Normal 模式 + externalTransfersEnabled=true 才可用 |
| `setLimits` | 无此函数 | — | — | 限额在 StrategyManager 设置 |
| `setMgmtFeeBpsPerMonth(bps)` | ✅ | ❌ | ❌ | 上限 200 bps/月（合约强制） |
| `setTreasury(addr)` | ✅ | ❌ | ❌ | |
| `setModules(strategyManager)` | ✅ | ❌ | ❌ | |
| `setExternalTransfersEnabled(bool)` | ✅ | ❌ | ❌ | |
| `setReserveRatioBps(bps)` | ✅ | ❌ | ❌ | |
| `grantRole / revokeRole` | ✅ | ❌ | ❌ | 角色管理，谨慎操作 |

---

## 四、StrategyManagerV01 权限矩阵

| 操作 | DEFAULT_ADMIN_ROLE | EMERGENCY_ROLE | 备注 |
|---|---|---|---|
| `invest(amount)` | ✅ | ❌ | 需 `!paused`，受 `investCap` + `minIdle` 约束 |
| `divest(amount)` | ✅ | ❌ | 不被 pause 拦截 |
| `returnToVault(amount)` | ✅ | ❌ | |
| `emergencyExit()` | ✅ | ❌ | 全额从 Aave 撤回到 Vault，不被 pause 拦截 |
| `partialEmergencyExit(amount)` | ✅ | ❌ | |
| `setLimits(investCap, minIdle)` | ✅ | ❌ | 变更不影响用户持仓 / PPS |
| `setStrategy(addr)` | ✅ | ❌ | 需先 pause manager |
| `pause()` | ✅ | ✅ | EMERGENCY_ROLE 可刹车 |
| `unpause()` | ✅ | ❌ | EMERGENCY_ROLE 不能自行解除 |
| `setVault(addr)` | ✅ | ❌ | 高危操作，修改前须确认旧 vault 无资金 |
| `grantRole / revokeRole` | ✅ | ❌ | |

---

## 五、退出优先级保护总结

| 场景 | deposit | redeem | 说明 |
|---|---|---|---|
| 正常运营 | ✅ (需 allowlist) | ✅ | |
| `depositsPaused=true` | ❌ | ✅ | **redeem 不受影响** |
| `systemMode=Paused` | ❌ | ✅ | **redeem 不受影响** |
| `manager.paused=true` | ✅ | ✅ | manager pause 仅阻止 invest()，不影响 vault |
| allowlist 被移除 | ❌ | ✅ | **已有持仓可随时退出** |
| investCap 耗尽 | ✅ (脚本层拦截) | ✅ | 链上 cap 只影响 invest()，不影响 redeem |
| `redeemsPaused=true` | ✅ | ❌ | 极端情况，须 ADMIN 操作 |
| `systemMode=EmergencyExit` | ❌ | ❌ (改用 claimExitAssets) | 专用退出路径替代 redeem |

---

## 六、操作纪律（Step3 运营规范）

1. **GUARDIAN 只执行应急操作**：pauseDeposits / setMode(Paused) / manager.pause — 不执行任何会改变用户权益的操作
2. **ADMIN 是唯一的恢复操作者**：所有 unpause / setMode(Normal) / emergencyExit 须由 ADMIN 执行
3. **紧急情况首选 `scripts/step3/emergency_pause.ts`**：一键暂停存款入口，自动保留 redeem 路径
4. **所有管理操作均需记录** evidence（脚本自动保存，手动操作需补录）
5. **每次操作后运行 `scripts/step2/pause_check.ts`** 确认权限状态正常
6. **TREASURY 地址变更须双人确认**，不得在无见证情况下单独操作

---

## 七、权限状态验证命令

```bash
# 检查当前角色与 pause 状态（只读）
npx hardhat run scripts/step2/pause_check.ts --network base

# 查询所有限额、持仓状态
npx hardhat run scripts/step3/query_limits.ts --network base
```

---

*本文档为 Step3 角色权限的权威来源。如有疑问，以链上 `hasRole()` 查询为准。*
