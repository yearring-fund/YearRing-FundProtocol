# STEP3_DOC_ALIGNMENT_NOTE.md — Step3 文档口径统一说明

生成时间：2026-04-06

---

## 一、改写前的口径冲突

在 2026-04-06 之前，以下文档存在相互矛盾的表述：

| 冲突点 | 原表述（冲突） | 出现位置 |
|---|---|---|
| Step3 定义 | "受控真实白名单运行" / "首批真实用户进入前" | GO_NO_GO_CHECKLIST.md、STEP3_ACCEPTANCE_SUMMARY.md |
| 阻断项 F | 与真实用户逐条完成风险确认（USER_FEEDBACK_TEMPLATE.md §二）| STEP3_GO_NO_GO_Command.md（fd/）|
| 用户风险确认 | 5 位真实用户 R1–R6 确认状态 ❌ 待确认 | evidence/user_risk_confirmation_status.md |
| 最终结论 | ❌ NO-GO（因用户未确认） | evidence/step3_go_no_go_working.md（阶段 F 行）|
| 决策矩阵 | "GO — 可进入白名单运行" | GO_NO_GO_CHECKLIST.md |
| §六操作清单 | "与首批用户完成风险确认（USER_FEEDBACK_TEMPLATE.md §二）"列为演练前必须完成项 | STEP3_ACCEPTANCE_SUMMARY.md |

以上表述混淆了 Step3（内部演练）与 Step4（真实用户进入）的边界，导致：
1. Step3 的 GO/NO-GO 被一个属于 Step4 的阻断项（外部用户风险确认）卡住
2. 任何阅读文档的人都会误认为 Step3 的目的是接纳真实用户

---

## 二、改写后如何统一

### 统一原则

所有文档统一采用以下定义：

| 阶段 | 正式名称 | 定义 |
|---|---|---|
| Step3 | **Internal Mainnet Rehearsal**（内部主网演练）| 白名单 5 个地址均由 ADMIN 自控，用于验证主网多地址真实资金的存入、投资、赎回完整流程。不涉及外部真实用户，不代表真实用户反馈完成。 |
| Step4 | **首批真实用户进入** | 面向外部真实用户开放。需额外完成：真实用户逐条风险确认（USER_FEEDBACK_TEMPLATE.md §二）、用户反馈留档、反馈结论汇总。 |

### 各文件变更摘要

| 文件 | 变更内容 |
|---|---|
| `docs/GO_NO_GO_CHECKLIST.md` | 标题改为"Internal Mainnet Rehearsal GO/NO-GO 清单"；决策矩阵改为"可执行 Internal Mainnet Rehearsal"；1.1 中"首批用户地址"改为"内部演练地址（ADMIN 自控）"；注释明确真实用户确认属于 Step4 |
| `docs/STEP3_ACCEPTANCE_SUMMARY.md` | Step3 目标改为"用于 Internal Mainnet Rehearsal"；§六删除"与首批用户完成风险确认"，替换为"确认白名单地址由 ADMIN 自控"；§七"首批运行参数"改为"演练参数"；§八结论更新为 ✅ GO |
| `evidence/step3_go_no_go_working.md` | 当前目标改为"Internal Mainnet Rehearsal"；阶段 F 由 ❌ 改为 ✅（不适用）；最终汇总改为 49/49 通过 |
| `evidence/user_risk_confirmation_status.md` | 标题与结论改为 Internal Rehearsal 模式，5 个账号标记为 ADMIN 自控 ✅ |
| `evidence/STEP3_GO_NO_GO_RESULT.md` | 新建，最终结论 ✅ GO，明确 Internal Mainnet Rehearsal 定义与下一步动作 |
| `frontend/index.html` | vmeta 改为"Internal Mainnet Rehearsal" |

---

## 三、Step3 与 Step4 的正式边界

```
┌─────────────────────────────────────────────────────────┐
│  Step3 — Internal Mainnet Rehearsal                     │
│                                                         │
│  参与方：ADMIN 自控的 5 个内部地址                        │
│  目的：  验证主网多地址真实资金完整流程                    │
│  结束条件：演练完成，流程验证无误                          │
│                                                         │
│  不需要：                                               │
│    × 外部用户风险确认                                    │
│    × USER_FEEDBACK_TEMPLATE.md §二                      │
│    × 用户反馈留档                                        │
└──────────────────────┬──────────────────────────────────┘
                       │ Step3 完成后
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step4 — 首批真实用户进入                                │
│                                                         │
│  参与方：外部真实用户（非 ADMIN 控制）                    │
│  目的：  正式接纳首批外部用户，收集真实反馈               │
│  额外需要：                                             │
│    ✓ 每位用户逐条完成风险确认（R1–R6）                   │
│    ✓ USER_FEEDBACK_TEMPLATE.md §二 留档                 │
│    ✓ 用户反馈汇总与结论                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 四、权威文件三角一致性确认

以下三份文件在改写后口径完全一致，任何人阅读后都不会误认为 Step3 已完成真实用户运行：

| 文件 | Step3 定义 | 最终结论 |
|---|---|---|
| `docs/GO_NO_GO_CHECKLIST.md` | Internal Mainnet Rehearsal | GO — 可执行演练 |
| `docs/STEP3_ACCEPTANCE_SUMMARY.md` | Internal Mainnet Rehearsal | ✅ GO |
| `evidence/STEP3_GO_NO_GO_RESULT.md` | Internal Mainnet Rehearsal | ✅ GO |

---

*本文件为一次性口径统一说明，记录改写前后的差异与决策依据，不随后续运营更新。*
