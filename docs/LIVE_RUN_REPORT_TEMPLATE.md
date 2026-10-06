# LIVE_RUN_REPORT_TEMPLATE.md — Step3 运营周期报告模板

生成时间：2026-04-05
适用阶段：Step3（白名单受邀试运营）

---

## 使用说明

本模板用于每次运营周期结束后生成归档报告，也适用于重大事件后的即时报告。
报告文件名建议：`evidence/report_<YYYYMMDD>.md`

---

## 报告基本信息

| 字段 | 填写 |
|---|---|
| 报告类型 | 周期性 / 事件驱动 |
| 报告时间 | YYYY-MM-DD HH:MM UTC |
| 报告周期 | YYYY-MM-DD 至 YYYY-MM-DD |
| 报告人 | ADMIN / 操作员 |
| 链 | Base Mainnet (Chain ID 8453) |

---

## 一、系统健康状况

| 指标 | 快照值 | 评价 |
|---|---|---|
| systemMode | Normal / Paused / EmergencyExit | |
| depositsPaused | true / false | |
| redeemsPaused | true / false | |
| manager.paused | true / false | |
| ADMIN 持有 DEFAULT_ADMIN_ROLE | 是 / 否 | |
| GUARDIAN 持有 EMERGENCY_ROLE | 是 / 否 | |

> 快照来源：`npx hardhat run scripts/liveRun/checkSystemState.ts --network base`

---

## 二、NAV 与资产状况

| 指标 | 周期起 | 周期末 | 变化 |
|---|---|---|---|
| totalAssets (USDC) | | | |
| totalSupply (fbUSDC) | | | |
| pricePerShare (USDC/fbUSDC) | | | |
| vault idle USDC | | | |
| stratUnderlying (Aave) | | | |
| managerIdle | | | |
| investCap 利用率 | | | |

> 注：PPS 持续下降 > 5% 为异常信号，需立即调查（见 LIVE_RUN_RUNBOOK.md §4.1）

---

## 三、限额利用率

| 限额类型 | 当前已用 | 上限 | 利用率 | 状态 |
|---|---|---|---|---|
| TVL_CAP | | 20,000 USDC | | Normal / Warning / AT CAP |
| investCap（链上） | | 20,000 USDC | | Normal / Warning / AT CAP |
| DAILY_CAP（当日） | | 5,000 USDC | | Normal / Warning / AT CAP |

> 超过 80% 为预警，达到 100% 需停止对应操作

---

## 四、本周期用户活动

| 事件类型 | 次数 | 总金额（USDC） | 说明 |
|---|---|---|---|
| 存款（deposit） | | | |
| 赎回（redeem） | | | |
| 白名单新增 | | — | |
| 白名单移除 | | — | |

### 用户持仓摘要

| 用户（匿名） | 持仓 fbUSDC | 估值 USDC | 持仓变化 |
|---|---|---|---|
| User 1 | | | |
| User 2 | | | |
| User 3 | | | |
| User 4 | | | |
| User 5 | | | |

---

## 五、策略表现

| 指标 | 值 | 说明 |
|---|---|---|
| Aave V3 USDC 供应 APY（期间均值） | | 来自 Aave UI / API |
| aToken 余额 vs totalUnderlying 差值 | | > 1 USDC 需调查 |
| 本周期 PPS 变动 | | 正常应为正值或零 |

---

## 六、本周期操作记录

| 时间（UTC） | 操作 | 执行人 | 金额（如有） | 结果 | 证据文件 |
|---|---|---|---|---|---|
| | deposit | ADMIN | | 成功 / 失败 | |
| | invest | ADMIN | | 成功 / 失败 | |
| | divest + returnToVault | ADMIN | | 成功 / 失败 | |

---

## 七、异常与事件

| 编号 | 时间 | 描述 | 影响 | 处置措施 | 是否关闭 |
|---|---|---|---|---|---|
| INC-001 | | | | | 是 / 否 |

> 无异常填写：本周期无异常事件。

---

## 八、参数变更记录

| 参数 | 变更前 | 变更后 | 原因 | 执行人 |
|---|---|---|---|---|
| investCap | | | | |
| reserveRatioBps | | | | |
| PER_USER_CAP（脚本层） | | | | |

> 无变更填写：本周期无参数变更。

---

## 九、下周期行动项

| 优先级 | 行动项 | 负责人 | 计划完成时间 |
|---|---|---|---|
| 高 | | | |
| 中 | | | |
| 低 | | | |

---

## 十、总体评价

| 维度 | 评价 | 备注 |
|---|---|---|
| 系统稳定性 | 正常 / 轻微异常 / 严重异常 | |
| 资金安全 | 正常 / 需关注 / 告警 | |
| 用户体验 | 顺畅 / 有摩擦 / 需改进 | |
| 是否继续运行 | 建议继续 / 暂停评估 / 立即暂停 | |

---

*本模板为 Step3 周期性运营报告的标准格式，每次报告归档至 `evidence/` 目录。*
