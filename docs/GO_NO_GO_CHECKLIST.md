# GO_NO_GO_CHECKLIST.md — Step3 白名单运行进入决策清单

生成时间：2026-04-05

适用阶段：Step3 启动前 / 扩容前 / 任何重大参数变更后

---

## 使用说明

- **启动 GO/NO-GO 评审**：首批用户进入前必须完成此清单
- **扩容 GO/NO-GO 评审**：TVL 上限调整 / 白名单扩容前重新评审
- **恢复 GO/NO-GO 评审**：任何 pause 解除后、重大事件处置完毕后
- 评审人：ADMIN（必须），GUARDIAN（建议参与）
- 所有 ❌ 必须转为 ✅ 后，方可标记 GO

---

## 第一部分：合约层（资金安全与准入控制）

### 1.1 白名单准入

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| 白名单功能链上生效 | 非白名单地址 deposit 触发 `NotAllowed` | `checkSystemState.ts` + 测试 Phase5 | ☐ |
| 已录入首批用户地址 | ≥1 个地址已加入 | `vault.isAllowed(addr)` | ☐ |
| 退出路径不受白名单限制 | 移除后仍可 redeem | 测试 C5 + S3-H1 | ☐ |

### 1.2 限额控制

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| investCap 已设置为目标值 | 20,000 USDC | `manager.investCap()` | ☐ |
| 投资上限链上强制生效 | 超限触发 `CapExceeded` | 测试 S3-C2 | ☐ |
| 脚本层 TVL_CAP 常量正确 | 20,000 USDC | `scripts/step2/deposit.ts` | ☐ |
| 脚本层 PER_USER_CAP 常量正确 | 2,000 USDC | `scripts/step2/deposit.ts` | ☐ |
| 脚本层 DAILY_CAP 常量正确 | 5,000 USDC | `scripts/step2/deposit.ts` | ☐ |

### 1.3 退出优先保护

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| depositsPaused 不影响 redeem | `_withdraw()` 不检查 `depositsPaused` | 测试 C-EP1 + S3-D1 | ☐ |
| systemMode=Paused 不影响 redeem | redeem 在 Paused 模式可执行 | 测试 C-EP2 + S3-D2 | ☐ |
| EmergencyExit 路径可用 | `claimExitAssets()` 可正常执行 | 测试 S3-G2 + ExitRound | ☐ |
| reserveRatioBps 已设置（避免 100% idle 锁死） | ≤ 7,000（若需 invest） | `vault.reserveRatioBps()` | ☐ |

### 1.4 权限角色

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| ADMIN 持有 DEFAULT_ADMIN_ROLE（Vault） | 是 | `vault.hasRole(DEFAULT_ADMIN_ROLE, admin)` | ☐ |
| ADMIN 持有 DEFAULT_ADMIN_ROLE（Manager） | 是 | `manager.hasRole(DEFAULT_ADMIN_ROLE, admin)` | ☐ |
| GUARDIAN 持有 EMERGENCY_ROLE（Vault） | 是 | `vault.hasRole(EMERGENCY_ROLE, guardian)` | ☐ |
| GUARDIAN 持有 EMERGENCY_ROLE（Manager） | 是 | `manager.hasRole(EMERGENCY_ROLE, guardian)` | ☐ |
| GUARDIAN 不持有 DEFAULT_ADMIN_ROLE | 否 | 测试 C-RB3 | ☐ |
| 无其他意外角色持有者 | 仅以上角色 | `checkSystemState.ts` | ☐ |

---

## 第二部分：运维准备（监控与应急）

### 2.1 监控脚本

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| `checkSystemState.ts` 可正常运行 | 输出全状态无报错 | 手动运行 | ☐ |
| `checkWhitelist.ts` 可正常运行 | 输出白名单持仓 | 手动运行 | ☐ |
| `checkLimits.ts` 可正常运行 | 输出限额利用率 | 手动运行 | ☐ |
| `exportLiveRunSnapshot.ts` 可正常运行 | 输出 JSON 存档 | 手动运行 | ☐ |

### 2.2 应急脚本

| 检查项 | 期望值 | 检查方法 | 结果 |
| --- | --- | --- | --- |
| `emergency_pause.ts` GUARDIAN 可执行 | 暂停存款 + mode=Paused | 测试 S3-E1 | ☐ |
| ADMIN 可执行解除暂停（unpause + setMode=0） | 恢复 Normal | LIVE_RUN_RUNBOOK.md §5.3 | ☐ |
| `manager.emergencyExit()` 路径已知 | 文档有 SOP | LIVE_RUN_RUNBOOK.md §5.4 | ☐ |

### 2.3 运维文档

| 文档 | 是否存在且已审阅 | 结果 |
| --- | --- | --- |
| `LIVE_RUN_MONITORING.md` |  | ☐ |
| `LIVE_RUN_RUNBOOK.md` |  | ☐ |
| `LIVE_RUN_OPERATIONS.md` |  | ☐ |
| `LIVE_RUN_LIMITS.md` |  | ☐ |
| `ROLE_MATRIX_LIVE_RUN.md` |  | ☐ |

### 2.4 证据与追踪

| 检查项 | 期望值 | 结果 |
| --- | --- | --- |
| `evidence/` 目录存在 | 可写入快照 | ☐ |
| `evidence/daily_deposits.json` 可读写 | daily tracker 正常 | ☐ |
| ADMIN 钱包有足够 ETH 支付 gas | ≥ 0.009 ETH（最低启动余额） | ☐ |
| GUARDIAN 钱包有足够 ETH 支付 gas | ≥ 0.001 ETH（最低启动余额） | ☐ |

---

## 第三部分：前端（用户可见层）

| 检查项 | 期望值 | 结果 |
| --- | --- | --- |
| 明确显示"白名单运行期"标识 | STEP 3 · WHITELIST RUN PERIOD badge | ☐ |
| 存款需白名单的提示已展示 | allowlist banner 存在 | ☐ |
| 赎回路径始终可用的说明已展示 | banner + risk disclaimer 中明确 | ☐ |
| TVL / investCap 进度条展示正确 | 与链上数据一致 | ☐ |
| 用户连接钱包后可见资格与额度 | isAllowed + headroom 显示 | ☐ |
| 风险提示完整 | risk disclaimer 6 条 | ☐ |
| EmergencyExit 下 redeems pill 为 warn | 非绿色 "Redeems Open" | ☐ |
| 无营销式文案 / 无夸大收益 | 无 APY 数字 / 无"高收益"文案 | ☐ |
| 无未来功能占位导致理解噪音 | 无多策略 / 治理 / 奖励入口 | ☐ |

---

## 第四部分：测试

| 测试类别 | 覆盖文件 | 全部通过 | 结果 |
| --- | --- | --- | --- |
| 白名单准入 | Phase5_Allowlist | 14/14 | ☐ |
| 退出优先保护 | Phase_C_ExitProtection | 17/17 | ☐ |
| 安全模式 / pause | SafetyMode | 15/15 | ☐ |
| EmergencyExit + ExitRound | EmergencyExit + ExitRound | 25/25 | ☐ |
| Step3 集成路径 | Step3_LiveRun | 21/21 | ☐ |
| 全套回归 | `npx hardhat test` | 613/613 | ☐ |

---

## 第五部分：系统初始状态确认（进入前快照）

在正式进入白名单运行前，必须通过 `exportLiveRunSnapshot.ts` 拍摄一份基准快照，并确认：

| 指标 | 基准值 | 记录时间 |
| --- | --- | --- |
| totalAssets |  |  |
| pricePerShare |  |  |
| totalSupply |  |  |
| systemMode | Normal (0) |  |
| depositsPaused | false |  |
| redeemsPaused | false |  |
| manager.paused | false |  |
| investCap | 20,000 USDC |  |
| 快照文件路径 | evidence/liverun_snapshot_<timestamp>.json |  |

---

## 决策矩阵

| 条件 | 决策 |
| --- | --- |
| 第一~四部分全部 ✅ | **GO** — 可进入白名单运行 |
| 第一部分有任何 ❌ | **NO-GO** — 阻断项，必须修复后重新评审 |
| 第二或第三部分有 ❌ | **有条件 GO** — 评估风险后决策，建议先修复 |
| 第四部分有 ❌ | **NO-GO** — 必须先通过全套测试 |

---

## 最终决策记录

| 字段 | 填写 |
| --- | --- |
| 评审日期 | YYYY-MM-DD |
| 评审人 |  |
| 决策结论 | GO / NO-GO / 有条件 GO |
| 阻断项（如有） |  |
| 附加条件（如有） |  |
| 首批参数确认 | TVL_CAP=20,000 / PER_USER=2,000 / DAILY=5,000 / investCap=20,000 / ADMIN_MIN_ETH=0.009 / GUARDIAN_MIN_ETH=0.001 |
| 签字 / 确认方式 |  |

---

*本文档为 Step3 GO/NO-GO 评审的权威清单，每次评审后留存已填写版本至 `evidence/` 目录。*
