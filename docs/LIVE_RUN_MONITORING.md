# LIVE_RUN_MONITORING.md — Step3 监控规范

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）

---

## 一、监控目标

| 监控类别 | 目的 |
|---|---|
| 系统状态 | 确认系统处于 Normal 模式，无意外 pause |
| 资金安全 | 确认 totalAssets 守恒，无异常流失 |
| 限额使用 | 确认 TVL / investCap / per-user / daily 均在阈值内 |
| 策略健康 | 确认 Aave V3 aToken 余额与 totalUnderlying 一致 |
| 角色状态 | 确认 ADMIN / GUARDIAN 角色仍正确持有 |

---

## 二、巡检频率

| 场景 | 频率 | 使用脚本 |
|---|---|---|
| 日常运营巡检 | 每日一次（UTC 08:00 建议时间） | `checkSystemState.ts` |
| 存款前检查 | 每次存款前必须执行 | `checkLimits.ts` |
| 白名单变更后 | 变更完成后立即执行 | `checkWhitelist.ts` |
| 周期性存档 | 每周一次或重大操作后 | `exportLiveRunSnapshot.ts` |
| 应急事件后 | 任何异常处置完成后 | `checkSystemState.ts` + `exportLiveRunSnapshot.ts` |

---

## 三、监控命令

```bash
# 日常巡检：角色 + 系统状态 + NAV + 限额汇总
npx hardhat run scripts/liveRun/checkSystemState.ts --network base

# 白名单状态与各用户持仓
npx hardhat run scripts/liveRun/checkWhitelist.ts --network base

# 所有限额利用率
npx hardhat run scripts/liveRun/checkLimits.ts --network base

# 完整 JSON 快照存档（自动保存到 evidence/）
npx hardhat run scripts/liveRun/exportLiveRunSnapshot.ts --network base

# 精简监控（含进度条，带 5 用户持仓详情）
npx hardhat run scripts/step3/monitor.ts --network base
```

---

## 四、阈值与预警级别

### 4.1 系统状态

| 状态 | 正常 | 预警 | 告警（立即处置） |
|---|---|---|---|
| systemMode | Normal (0) | — | Paused (1) 或 EmergencyExit (2) |
| depositsPaused | false | — | true（非预期） |
| redeemsPaused | false | — | true（非预期） |
| manager.paused | false | — | true（非预期） |

### 4.2 限额利用率

| 限额 | 正常 | 预警（≥80%） | 告警（≥100%） |
|---|---|---|---|
| TVL / TVL_CAP | < 80% | 80–99% | ≥ 100% → 停止新存款 |
| stratDep / investCap | < 80% | 80–99% | ≥ 100% → 不可再 invest |
| dailyUsed / DAILY_CAP | < 80% | 80–99% | ≥ 100% → 当日不可再存款 |
| 单用户 value / PER_USER_CAP | < 80% | 80–99% | ≥ 100% → 该用户不可再存款 |

### 4.3 NAV 完整性

| 指标 | 正常范围 | 异常信号 |
|---|---|---|
| pricePerShare | 稳定或缓慢上升（收益累积） | 突然大幅下降（>5%）→ 立即调查 |
| totalAssets | 与 stratUnderlying + vault idle 之和一致 | 差值 > 1 USDC → 调查 |
| vault idle USDC | 应等于 vault.balanceOf(vaultAddr) | 差异 → 调查 |

### 4.4 角色异常

| 异常 | 处置 |
|---|---|
| ADMIN 不持有 DEFAULT_ADMIN_ROLE | 立即停止所有运营操作，调查钱包安全 |
| GUARDIAN 不持有 EMERGENCY_ROLE | ADMIN 重新授权，记录原因 |

### 4.5 Gas 余额（ETH）

| 钱包 | 最低启动余额 | 预警线（5%） | 含义 |
|---|---|---|---|
| ADMIN | **0.009 ETH** | 0.00045 ETH | 低于预警线时 `checkSystemState.ts` 输出 ⛔，需补充后再执行操作 |
| GUARDIAN | **0.001 ETH** | 0.00005 ETH | 低于预警线时 `checkSystemState.ts` 输出 ⛔，GUARDIAN 将无法执行 emergency_pause |

**状态说明**（`checkSystemState.ts` GAS BALANCES 节）：
- `✅ OK`：余额 ≥ 最低启动余额
- `⚠️ LOW`：余额 ≥ 预警线但 < 最低启动余额，建议补充
- `⛔ CRITICAL`：余额 < 预警线，必须补充后再执行链上操作

**常量来源**：`scripts/liveRun/lib.ts` — `ADMIN_MIN_ETH / GUARDIAN_MIN_ETH / ADMIN_WARN_ETH / GUARDIAN_WARN_ETH`

---

## 五、可读取的核心指标清单

| 指标 | 读取方式 | 合约 |
|---|---|---|
| totalAssets | `vault.totalAssets()` | FundVaultV01 |
| totalSupply (fbUSDC) | `vault.totalSupply()` | FundVaultV01 |
| pricePerShare | `vault.pricePerShare()` | FundVaultV01 |
| systemMode | `vault.systemMode()` | FundVaultV01 |
| depositsPaused | `vault.depositsPaused()` | FundVaultV01 |
| redeemsPaused | `vault.redeemsPaused()` | FundVaultV01 |
| isAllowed(addr) | `vault.isAllowed(addr)` | FundVaultV01 |
| user shares | `vault.balanceOf(addr)` | FundVaultV01 |
| user value | `vault.convertToAssets(shares)` | FundVaultV01 |
| investCap | `manager.investCap()` | StrategyManagerV01 |
| manager idle | `manager.idleUnderlying()` | StrategyManagerV01 |
| manager paused | `manager.paused()` | StrategyManagerV01 |
| strategy deployed | `strategy.totalUnderlying()` | AaveV3StrategyV01 |
| daily deposits | `evidence/daily_deposits.json` | local file |

---

## 六、监控输出存档

所有 `exportLiveRunSnapshot.ts` 输出保存至 `evidence/liverun_snapshot_<timestamp>.json`。

建议保留所有快照文件作为运营记录，不定期清理。

---

*本文档为 Step3 监控规范的权威来源。*
