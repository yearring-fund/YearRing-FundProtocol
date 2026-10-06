# LIVE_RUN_OPERATIONS.md — Step3 日常运营操作流程

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）

---

## 一、角色分工

| 操作类别 | 执行人 | 钱包 |
|---|---|---|
| 日常巡检（只读） | ADMIN 或 GUARDIAN | 任意 |
| 存款协助（代用户执行） | ADMIN | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| Invest / Divest | ADMIN | 同上 |
| 白名单管理 | ADMIN | 同上 |
| 应急暂停（刹车） | GUARDIAN 或 ADMIN | `0xC8052cF447d429f63E890385a6924464B85c5834` |
| 解除暂停 | ADMIN only | 同上 |
| emergencyExit | ADMIN only | 同上 |

---

## 二、日常脚本与应急脚本对照

### 日常脚本（只读，无风险）

| 脚本 | 用途 | 频率 |
|---|---|---|
| `scripts/liveRun/checkSystemState.ts` | 系统全状态巡检 | 每日 |
| `scripts/liveRun/checkWhitelist.ts` | 白名单持仓核查 | 每次存款前 / 白名单变更后 |
| `scripts/liveRun/checkLimits.ts` | 限额利用率 | 每次存款前 |
| `scripts/liveRun/exportLiveRunSnapshot.ts` | 完整 JSON 存档 | 每周 / 重大操作后 |
| `scripts/step2/state.ts` | 精简状态快照 | 按需 |
| `scripts/step2/pause_check.ts` | 角色与 pause 状态核查 | 每次操作前 |
| `scripts/step3/monitor.ts` | 含进度条的监控 dashboard | 按需 |
| `scripts/step3/query_limits.ts` | 限额 + 持仓详情 | 按需 |

### 写入脚本（需 ADMIN 签名）

| 脚本 | 用途 | 风险级别 |
|---|---|---|
| `scripts/step2/deposit.ts` | 存款（含限额预检） | 低 |
| `scripts/step2/withdraw.ts` | 赎回 | 低 |
| `scripts/step2/invest.ts` | 资金 → Aave | 中 |
| `scripts/step2/divest.ts` | Aave → Manager | 中 |
| `scripts/step3/allowlist_add.ts` | 添加单个白名单地址 | 低 |
| `scripts/step3/set_invest_cap.ts` | 更新 investCap | 中 |

### 应急脚本（须谨慎）

| 脚本 | 用途 | 执行人 |
|---|---|---|
| `scripts/step3/emergency_pause.ts` | 一键暂停入口（不暂停 redeem） | GUARDIAN 或 ADMIN |
| `PAUSE_REDEEMS=true emergency_pause.ts` | 暂停全部操作（含 redeem） | ADMIN（极端情况） |

---

## 三、标准操作流程

### 3.1 存款前流程（每次）

```bash
# Step 1: 巡检系统状态
npx hardhat run scripts/liveRun/checkSystemState.ts --network base

# Step 2: 检查限额
npx hardhat run scripts/liveRun/checkLimits.ts --network base

# Step 3: 确认用户在白名单
npx hardhat run scripts/liveRun/checkWhitelist.ts --network base

# Step 4: 执行存款
AMOUNT=<金额> npx hardhat run scripts/step2/deposit.ts --network base
```

### 3.2 Invest 流程（定期，资金 → Aave）

```bash
# 前置：确认系统 Normal、manager 未 paused
npx hardhat run scripts/liveRun/checkSystemState.ts --network base

# 执行 invest
AMOUNT=<金额> npx hardhat run scripts/step2/invest.ts --network base

# 后置：确认策略余额
npx hardhat run scripts/liveRun/exportLiveRunSnapshot.ts --network base
```

**注意**：
- Invest 前确认 `investCap` 空间足够
- Step3 阶段建议保留 ≥ 30% idle（reserveRatioBps = 3000）

### 3.3 Divest 流程（定期或应用户 redeem 需求）

```bash
# 执行 divest（资金从 Aave 撤回到 Manager）
AMOUNT=<金额> npx hardhat run scripts/step2/divest.ts --network base
# divest.ts 自动执行 returnToVault
```

### 3.4 用户 redeem 协助流程

```bash
# 1. 确认 vault 有足够 idle USDC
npx hardhat run scripts/liveRun/checkSystemState.ts --network base
# 如 idle 不足：先 divest

# 2. 用户自行执行 redeem（或 ADMIN 协助）
npx hardhat run scripts/step2/withdraw.ts --network base
```

### 3.5 白名单管理流程

```bash
# 添加单个地址
ADDRESS=<addr> npx hardhat run scripts/step3/allowlist_add.ts --network base

# 验证白名单状态
npx hardhat run scripts/liveRun/checkWhitelist.ts --network base
```

### 3.6 参数变更流程（investCap / 脚本层限额）

**链上 investCap 变更**：
```bash
# 1. 确认新值合理（见 LIVE_RUN_LIMITS.md）
# 2. 执行
INVEST_CAP_USDC=<新值> npx hardhat run scripts/step3/set_invest_cap.ts --network base
# 3. 同步更新 docs/LIVE_RUN_LIMITS.md
```

**脚本层限额变更**（PER_USER_CAP / DAILY_CAP / TVL_CAP）：
1. 修改 `scripts/step2/deposit.ts` 中的常量
2. 同步修改 `scripts/step3/monitor.ts` 和 `scripts/step3/query_limits.ts`
3. 同步修改 `scripts/liveRun/lib.ts` 中的常量
4. 更新 `docs/LIVE_RUN_LIMITS.md`

---

## 四、操作纪律

1. **任何写入操作前**必须先运行一次 `checkSystemState.ts` 确认系统处于正常状态
2. **不得在未巡检的情况下执行 invest**
3. **所有操作后**均需检查 evidence 目录是否有记录
4. **应急脚本**不得在未确认异常的情况下执行
5. **BYPASS_LIMITS=true** 不得在常规操作中使用，仅限 ADMIN 在特殊情况下使用
6. **白名单变更**须与用户预先沟通，不得单方面移除活跃用户
7. **参数变更**须同步更新对应文档，不得出现文档与代码不一致

---

## 五、周期性操作建议

| 操作 | 建议频率 |
|---|---|
| 日常巡检（checkSystemState） | 每日 |
| 限额检查（checkLimits） | 每次存款前 |
| JSON 快照存档（exportLiveRunSnapshot） | 每周一次 |
| 收益核查（aToken 余额 vs totalUnderlying） | 每周一次 |
| Divest + 收益确认 | 视市场情况，建议每 2–4 周一次 |
| LIVE_RUN_LIMITS.md 同步 | 每次参数变更后 |

---

*本文档为 Step3 日常运营操作的规范来源。*
