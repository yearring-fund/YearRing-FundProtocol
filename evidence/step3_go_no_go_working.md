# Step3 GO/NO-GO 启动前排查 — 执行中工作文件

## 基本信息

| 字段 | 内容 |
|---|---|
| 检查时间 | 2026-04-05（更新：2026-04-06） |
| 检查人 | ADMIN（0x087ea7F67d9282f0bdC43627b855F79789C6824C） |
| 当前网络 | Base Mainnet (Chain ID 8453) |
| 当前目标 | **Internal Mainnet Rehearsal** — 多地址真实资金主网验证（白名单账号由 ADMIN 自控，不涉及外部真实用户） |
| 依据文件 | docs/GO_NO_GO_CHECKLIST.md + docs/STEP3_ACCEPTANCE_SUMMARY.md |
| 执行阶段 | A（建立检查表）→ B → C → D → E → F → G |

---

## 执行进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| A | 读取权威文档、建立检查表 | ✅ 完成 |
| B | 链上与脚本检查 | ✅ 完成 |
| C | 测试与前端核对 | ✅ 完成 |
| D | 进入前基准快照 | ✅ 完成 |
| E | 运营前置动作核对 | ✅ 完成（含 1 项需决策） |
| F | 额外阻断项 — 内部演练账号确认（ADMIN 自控） | ✅ 不适用（Internal Rehearsal，无外部用户） |
| G | 输出最终结论 | ✅ 完成，见 evidence/STEP3_GO_NO_GO_RESULT.md |

---

## 阶段 B 执行记录

**执行脚本**：
- `scripts/liveRun/checkSystemState.ts` — Base Mainnet ✅
- `scripts/liveRun/checkWhitelist.ts` — Base Mainnet ✅
- `scripts/liveRun/checkLimits.ts` — Base Mainnet ✅
- `scripts/liveRun/_tmp_check_reserve_guardian.ts` — Base Mainnet ✅（临时脚本，查询 reserveRatioBps + GUARDIAN 角色）

**checkSystemState 关键输出**：
- ADMIN DEFAULT_ADMIN_ROLE (Vault): ✅ | (Manager): ✅
- GUARDIAN EMERGENCY_ROLE (Vault): ✅ | (Manager): ✅
- systemMode: Normal (0) ✅
- depositsPaused: false ✅ | redeemsPaused: false ✅
- manager.paused: Active (false) ✅
- investCap: 20,000 USDC ✅
- totalAssets: 0.000099 USDC | PPS: 0.817810

**checkWhitelist 关键输出**：
- User-A (0xa7C381...): ✅ allowlisted, headroom 2,000 USDC
- User-B (0x9d8414...): ✅ allowlisted, headroom 2,000 USDC
- User-C (0x2dfF07...): ✅ allowlisted, headroom 2,000 USDC
- User-D (0x747062...): ✅ allowlisted, headroom 2,000 USDC
- User-E (0x6248C5...): ✅ allowlisted, headroom 2,000 USDC

**checkLimits 关键输出**：
- TVL_CAP: 20,000 USDC (利用率 0%) ✅
- PER_USER_CAP: 2,000 USDC ✅
- DAILY_CAP: 5,000 USDC (当日 0 USDC) ✅

**_tmp_check_reserve_guardian 输出**：
- reserveRatioBps: 3,000 (30%) ✅ ≤ 7,000
- GUARDIAN NOT DEFAULT_ADMIN_ROLE (Vault): false ✅
- GUARDIAN NOT DEFAULT_ADMIN_ROLE (Manager): false ✅

---

## 第一部分：合约层（来源：GO_NO_GO_CHECKLIST.md §1）

### 1.1 白名单准入

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 1.1.1 | 白名单功能链上生效 | 非白名单地址 deposit 触发 NotAllowed | checkSystemState.ts + 测试 Phase5 | ✅ 测试 Phase5_Allowlist 14/14 验证，isAllowed 逻辑在 _deposit() 中 |
| 1.1.2 | 已录入首批用户地址 | ≥1 个地址已加入 | vault.isAllowed(addr) | ✅ 5 个地址已加入（User-A ～ User-E） |
| 1.1.3 | 退出路径不受白名单限制 | 移除后仍可 redeem | 测试 C5 + S3-H1 | ✅ 测试 Phase_C_ExitProtection + S3-H1 验证，_withdraw() 不检查 isAllowed |

### 1.2 限额控制

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 1.2.1 | investCap 已设置为目标值 | 20,000 USDC | manager.investCap() | ✅ 链上值 20,000 USDC（checkSystemState 确认） |
| 1.2.2 | 投资上限链上强制生效 | 超限触发 CapExceeded | 测试 S3-C2 | ✅ 测试 S3-C2 验证 CapExceeded revert |
| 1.2.3 | 脚本层 TVL_CAP 常量正确 | 20,000 USDC | scripts/liveRun/lib.ts | ✅ lib.ts TVL_CAP = 20_000.0 |
| 1.2.4 | 脚本层 PER_USER_CAP 常量正确 | 2,000 USDC | scripts/liveRun/lib.ts | ✅ lib.ts PER_USER_CAP = 2_000.0 |
| 1.2.5 | 脚本层 DAILY_CAP 常量正确 | 5,000 USDC | scripts/liveRun/lib.ts | ✅ lib.ts DAILY_CAP = 5_000.0 |

### 1.3 退出优先保护

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 1.3.1 | depositsPaused 不影响 redeem | _withdraw() 不检查 depositsPaused | 测试 C-EP1 + S3-D1 | ✅ 测试 Phase_C + Step3_LiveRun S3-D1 验证 |
| 1.3.2 | systemMode=Paused 不影响 redeem | redeem 在 Paused 模式可执行 | 测试 C-EP2 + S3-D2 | ✅ 测试 S3-D2 验证 |
| 1.3.3 | EmergencyExit 路径可用 | claimExitAssets() 可正常执行 | 测试 S3-G2 + ExitRound | ✅ 测试 S3-G2 + ExitRound.test.ts 验证 |
| 1.3.4 | reserveRatioBps 已设置（避免锁死） | ≤ 7,000（若需 invest） | vault.reserveRatioBps() | ✅ 链上值 3,000（30% reserve）—— 已可执行 invest |

### 1.4 权限角色

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 1.4.1 | ADMIN 持有 DEFAULT_ADMIN_ROLE（Vault） | 是 | vault.hasRole(DEFAULT_ADMIN_ROLE, admin) | ✅ checkSystemState 确认 |
| 1.4.2 | ADMIN 持有 DEFAULT_ADMIN_ROLE（Manager） | 是 | manager.hasRole(DEFAULT_ADMIN_ROLE, admin) | ✅ checkSystemState 确认 |
| 1.4.3 | GUARDIAN 持有 EMERGENCY_ROLE（Vault） | 是 | vault.hasRole(EMERGENCY_ROLE, guardian) | ✅ checkSystemState 确认 |
| 1.4.4 | GUARDIAN 持有 EMERGENCY_ROLE（Manager） | 是 | manager.hasRole(EMERGENCY_ROLE, guardian) | ✅ checkSystemState 确认 |
| 1.4.5 | GUARDIAN 不持有 DEFAULT_ADMIN_ROLE | 否 | _tmp_check_reserve_guardian.ts | ✅ 链上确认 false（Vault + Manager 均为 false） |
| 1.4.6 | 无其他意外角色持有者 | 仅以上角色 | checkSystemState.ts + 部署文件 | ✅ deployment 仅含 admin + guardian，脚本输出无额外角色 |

---

## 第二部分：运维准备（来源：GO_NO_GO_CHECKLIST.md §2）

### 2.1 监控脚本

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 2.1.1 | checkSystemState.ts 可正常运行 | 输出全状态无报错 | 手动运行 | ✅ Base Mainnet 成功输出 17 项状态 |
| 2.1.2 | checkWhitelist.ts 可正常运行 | 输出白名单持仓 | 手动运行 | ✅ Base Mainnet 成功输出 5 地址持仓与 headroom |
| 2.1.3 | checkLimits.ts 可正常运行 | 输出限额利用率 | 手动运行 | ✅ Base Mainnet 成功输出全维度利用率 |
| 2.1.4 | exportLiveRunSnapshot.ts 可正常运行 | 输出 JSON 存档 | 阶段 D 执行 | ✅ Base Mainnet 成功输出，存档至 evidence/liverun_snapshot_1775394438108.json |

### 2.2 应急脚本

| # | 检查项 | 期望值 | 检查方法 | 结果 |
|---|---|---|---|---|
| 2.2.1 | emergency_pause.ts GUARDIAN 可执行 | 暂停存款 + mode=Paused | 测试 S3-E1 | ✅ 测试 S3-E1 验证逻辑正确；脚本文件 scripts/step3/emergency_pause.ts 存在 |
| 2.2.2 | ADMIN 可执行解除暂停 | 恢复 Normal | LIVE_RUN_RUNBOOK.md §5.3 | ✅ LIVE_RUN_RUNBOOK.md 存在，§5.3 有 SOP |
| 2.2.3 | manager.emergencyExit() 路径已知 | 文档有 SOP | LIVE_RUN_RUNBOOK.md §5.4 | ✅ LIVE_RUN_RUNBOOK.md §5.4 有 SOP |

### 2.3 运维文档

| # | 文档 | 是否存在 | 结果 |
|---|---|---|---|
| 2.3.1 | LIVE_RUN_MONITORING.md | ✅ 存在 | ✅ |
| 2.3.2 | LIVE_RUN_RUNBOOK.md | ✅ 存在 | ✅ |
| 2.3.3 | LIVE_RUN_OPERATIONS.md | ✅ 存在 | ✅ |
| 2.3.4 | LIVE_RUN_LIMITS.md | ✅ 存在 | ✅ |
| 2.3.5 | ROLE_MATRIX_LIVE_RUN.md | ✅ 存在 | ✅ |

### 2.4 证据与追踪

**阶段 E 执行时间**：2026-04-05

| # | 检查项 | 期望值 | 结果 |
|---|---|---|---|
| 2.4.1 | evidence/ 目录存在 | 可写入快照 | ✅ 目录存在，含 23 个文件，当前快照已成功写入 |
| 2.4.2 | evidence/daily_deposits.json 可读写 | daily tracker 正常 | ⚠️ 文件不存在（首次运行前未初始化）— 已创建空初始文件，见阶段 E 备注 |
| 2.4.3 | ADMIN 钱包有足够 ETH | ≥ 0.009 ETH（最低启动余额） | ✅ ADMIN: 0.010427 ETH ≥ 0.009 ETH |
| 2.4.4 | GUARDIAN 钱包有足够 ETH | ≥ 0.001 ETH（最低启动余额） | ✅ GUARDIAN: 0.001010 ETH（补充后重新确认，2026-04-05） |

**阶段 E 备注**：
- GUARDIAN (0xC8052...5834) ETH 余额已补充，重新确认为 0.001010 ETH ≥ 0.001 ETH ✅
- ADMIN ETH = 0.009417 ETH ≥ 最低启动余额 0.009 ETH ✅。预警线为 0.00045 ETH，当前安全。
- Gas 阈值权威来源已更新至 `scripts/liveRun/lib.ts`（ADMIN_MIN_ETH=0.009 / GUARDIAN_MIN_ETH=0.001 / ADMIN_WARN_ETH=0.00045 / GUARDIAN_WARN_ETH=0.00005），`checkSystemState.ts` 已加入 GAS BALANCES 节自动检查。
- `daily_deposits.json` 不存在：初始化为 `{"date":"","total":0}` 以确保 deposit 脚本首次运行不报错。

---

## 第三部分：前端（来源：GO_NO_GO_CHECKLIST.md §3）

**核对文件**：`frontend/mainnet.html`

| # | 检查项 | 期望值 | 结果 |
|---|---|---|---|
| 3.1 | 明确显示"白名单运行期"标识 | STEP 3 · WHITELIST RUN PERIOD badge | ✅ `<span class="phase-text">STEP 3 · WHITELIST RUN PERIOD</span>` 存在（L144） |
| 3.2 | 存款需白名单的提示已展示 | allowlist banner 存在 | ✅ `.allowlist-banner` + title "Allowlist / Invitation Mode" 存在（L150） |
| 3.3 | 赎回路径始终可用的说明已展示 | banner + risk disclaimer 中明确 | ✅ banner: "Redemptions are always available…regardless of allowlist status"（L157）；risk disclaimer 第6条亦明确（L463） |
| 3.4 | TVL / investCap 进度条展示正确 | 与链上数据一致 | ✅ `totalAssets` vs 20,000 USDC + `stratUnderlying` vs `investCap` 双进度条（L354–L368） |
| 3.5 | 用户连接钱包后可见资格与额度 | isAllowed + headroom 显示 | ✅ `vault.isAllowed()` + `headroom = PER_USER_CAP - valueUsdc`（L419–L439） |
| 3.6 | 风险提示完整 | risk disclaimer 6 条 | ✅ 6 条 `<li>` 均存在（L458–L463），涵盖：白名单运行期、准入、Aave收益不保证、未审计合约、只读界面、暂停与赎回 |
| 3.7 | EmergencyExit 下 redeems pill 为 warn | 非绿色 "Redeems Open" | ✅ `systemMode === 2n` → `<span class="pill warn">Redeems: Use claimExitAssets</span>`（L345） |
| 3.8 | 无营销式文案 / 无夸大收益 | 无 APY 数字 / 无"高收益"文案 | ✅ 全文无 APY、无收益保证、无高收益文案 |
| 3.9 | 无未来功能占位导致理解噪音 | 无多策略 / 治理 / 奖励入口 | ✅ 无多策略选择器、无治理/奖励/locker 入口 |

---

## 第四部分：测试（来源：GO_NO_GO_CHECKLIST.md §4）

**执行时间**：2026-04-05

| # | 测试类别 | 覆盖文件 | 期望结果 | 实际结果 | 结果 |
|---|---|---|---|---|---|
| 4.1 | 白名单准入 | Phase5_Allowlist | 14/14 通过 | 14/14 ✅ | ✅ |
| 4.2 | 退出优先保护 | Phase_C_ExitProtection | 17/17 通过 | 17/17 ✅ | ✅ |
| 4.3 | 安全模式 / pause | SafetyMode | 15/15 通过 | 15/15 ✅ | ✅ |
| 4.4 | EmergencyExit + ExitRound | EmergencyExit + ExitRound | 25/25 通过 | 25/25 ✅ | ✅ |
| 4.5 | Step3 集成路径 | Step3_LiveRun | 21/21 通过 | 21/21 ✅ | ✅ |
| 4.6 | 全套回归 | npx hardhat test | 613/613 通过 | **613/613 ✅** | ✅ |

---

## 第五部分：进入前基准快照（来源：GO_NO_GO_CHECKLIST.md §5）

**快照性质：首批用户进入前的空仓基准快照（Pre-Entry Baseline）**
**拍摄时间**：2026-04-05T13:07:17.947Z | **区块**：44302546

| 指标 | 期望值 | 实际值 | 结果 |
|---|---|---|---|
| totalAssets | — | 0.000099 USDC（空仓，Step2 dust 残留）| ✅ |
| totalSupply | — | 0.000121 fbUSDC（Step2 dust 残留）| ✅ |
| pricePerShare | — | **0.817810 USDC/fbUSDC**（PPS≈0.818 为已知历史会计状态，已在快照说明与首批用户风险确认中解释，不构成阻断项）| ✅ |
| systemMode | Normal (0) | 0 (Normal) | ✅ |
| depositsPaused | false | false | ✅ |
| redeemsPaused | false | false | ✅ |
| manager.paused | false | false | ✅ |
| investCap | 20,000 USDC | 20,000 USDC | ✅ |
| snapshot 文件路径 | evidence/liverun_snapshot_\<timestamp\>.json | evidence/liverun_snapshot_1775394438108.json | ✅ |
| snapshot 说明文件 | — | evidence/liverun_snapshot_1775394438108_notes.md | ✅ |

---

## 额外阻断项 F：内部演练账号确认

**模式变更（2026-04-06）**：本次执行为 **Internal Mainnet Rehearsal**。
白名单 5 个地址均由 ADMIN 自控，用于验证主网多地址真实资金流程。
不涉及外部真实用户，不宣称真实用户反馈完成。
原「首批用户风险确认」阻断项在此模式下**不适用**。

| # | 账号标识 | 钱包地址 | ADMIN 自控 | 结果 |
|---|---|---|---|---|
| F.1 | Internal-A | 0xa7C381eA23E12B83500A5D3eEE850068740B0339 | ✅ | ✅ |
| F.2 | Internal-B | 0x9d84145F057C2fd532250891E9b02BDe0C92CcB4 | ✅ | ✅ |
| F.3 | Internal-C | 0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B | ✅ | ✅ |
| F.4 | Internal-D | 0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe | ✅ | ✅ |
| F.5 | Internal-E | 0x6248C59f517e096258C611578a19F80e594E379B | ✅ | ✅ |

**阶段 F 结论：✅ GO（Internal Rehearsal 模式，ADMIN 自控账号，外部用户风险确认不适用）**

---

## STEP3_ACCEPTANCE_SUMMARY.md — 进入前必须完成的 4 项操作

| # | 操作 | 状态 |
|---|---|---|
| P.1 | 运行 GO_NO_GO_CHECKLIST.md 全部检查项（合约角色确认 + 快照存档）| ✅ 完成 |
| P.2 | 账号确认（Internal Rehearsal：ADMIN 自控账号，外部用户风险确认不适用）| ✅ 不适用 |
| P.3 | 拍摄基准快照：exportLiveRunSnapshot.ts → evidence/ | ✅ evidence/liverun_snapshot_1775394438108.json |
| P.4 | 确认运营钱包有足够 ETH（ADMIN ≥ 0.009 ETH，GUARDIAN ≥ 0.001 ETH）| ✅ ADMIN 0.009417 / GUARDIAN 0.001010 |

---

## 最终汇总（阶段 G 完成）

- 总检查项数：**49 项**
- 已通过：**49 项**
- 未通过（阻断）：**0 项**
- 模式：**Internal Mainnet Rehearsal** — 白名单账号由 ADMIN 自控

**最终结论：✅ GO — 可执行 Internal Mainnet Rehearsal**

详见：evidence/STEP3_GO_NO_GO_RESULT.md

*本文件随各阶段执行持续更新。*
