# Phase 5 验收报告 — 合规 Hook

状态：**不通过**

验收时间：2026-04-02

关联命令：`step1p5check.md`

对照规范：`fd/STEP1_FINALIZED_SPEC_CN.md §7`、`docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md`

---

## 1. 本阶段验收结论摘要

V3 初版 C-minimal 合规要求分为两层：

| 层级 | 内容 | V3 要求 | 当前状态 |
| --- | --- | --- | --- |
| **Layer 1：邀请制 allowlist** | `mapping isAllowed` + deposit 前置检查 | 必须在上线前实现（§1.2 明确） | ❌ 完全未实现 |
| **Layer 2：合规 hook 体系** | IComplianceHook / IBlacklist / 司法管辖区 gate | V4+ 接口预留（D4 冻结） | ✅ 接口预留，符合规范 |

Layer 1 是 V3 上线前阻塞项，当前合约完全没有 allowlist 逻辑。**Phase 5 不通过。**

---

## 2. 本阶段目标对照表

| 验收目标 | 规范要求 | 实现状态 | 结论 |
| --- | --- | --- | --- |
| allowlist 真实拦截 deposit | `_beforeDeposit` 检查 `isAllowed[depositor]` | 无任何 allowlist 检查，任意地址均可 deposit | ❌ 未实现 |
| allowlist 拦截 redeem | 规范未明确强制（redeem 为已存入用户操作） | 无 | ⚠️ 规范未明确 |
| allowlist 拦截 claimExitAssets | 规范未明确强制 | 无 | ⚠️ 规范未明确 |
| blacklist 真实生效 | V4 接口预留（D4 冻结） | 无代码实现，符合 D4 决策 | ✅ 可接受 |
| restricted / blocked 行为区分 | V4 合规 hook 中实现 | 接口文档已定义 Layer 2 占位符 | ✅ 文档已预留 |
| 邀请制落到钱包级 | `mapping(address => bool) isAllowed` | 未实现 | ❌ 未实现 |
| 黑名单允许合理退出 | 规范：blacklist 允许合理 exit 路径 | V4 预留，V3 无 blacklist | ✅ D4 允许推迟 |
| hook 可为 RWA 复用 | 接口预留文档已说明 V4 扩展路径 | `COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §6` 记录 | ✅ 路线图存在 |

---

## 3. 实际改动文件清单

**Phase 5 无任何代码改动。**

以下为与本阶段检查直接相关的已有文件（均为现状）：

| 文件 | 类型 | Phase 5 相关内容 | 合规要求状态 |
| --- | --- | --- | --- |
| `contracts/FundVaultV01.sol` | 核心逻辑 | `_deposit()` 钩子中无 allowlist 检查 | ❌ 缺 allowlist |
| `docs/COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md` | 文档 | D4 冻结决策 + §1.2 allowlist 实现要求 + V4 hook 路线图 | 文档完整，代码未跟上 |
| `contracts/interfaces/` | 接口 | 无 IComplianceHook / IBlacklist 接口文件 | V4 预留，文档已说明 |

---

## 4. 与 Step1 定稿规范的逐条一致性检查（§7 合规边界）

### §7.1 邀请制白名单（V3 必须实现）

```
规范（COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §1.2）：
  V3 初版上线前完成：
    - allowlist 存储：mapping(address => bool) isAllowed
    - 存款前置检查：_beforeDeposit(address depositor) 检查 isAllowed[depositor]
    - 白名单管理权：DEFAULT_ADMIN_ROLE 经 Timelock 操作
```

实际代码（FundVaultV01.sol `_deposit`）：

```solidity
function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
    if (depositsPaused || systemMode != SystemMode.Normal) revert DepositsArePaused();
    accrueManagementFee();
    super._deposit(caller, receiver, assets, shares);
    // ← 无任何 allowlist 检查
}
```

**结论：❌ 完全偏离** — V3 规范明确要求上线前完成 allowlist，当前任意地址可无限制 deposit。

---

### §7.2 合规 Hook 体系（V4 接口预留）

```
规范（D4 冻结决策）：
  合规 hook = 文档 + 接口预留，V3 初版无代码实现
```

预留位置（`COMPLIANCE_AND_DISCLOSURE_BOUNDARY_V3.md §2.2` 已定义）：

- `IComplianceHook.isAllowed(address)` — V4 接入点
- `IBlacklist.isBlacklisted(address)` — V4 接入点
- `IJurisdictionGate.isPermitted(address, jurisdiction)` — V4 接入点

**结论：✅ 符合** — D4 决策明确 V3 无代码实现，规范内部一致，文档路线图清晰。

---

### §7.3 规范内部范围边界说明

```
D4（冻结）：合规 hook = 文档 + 接口预留，V3 初版无代码实现
§1.2（同文档）：allowlist 机制是"V3 初版上线前完成"要求
```

两者不矛盾：

- **D4** 的"无代码实现"指 Layer 2 合规 hook 体系（需外部 oracle/API 集成的重型机制）
- **§1.2** 要求的是 Layer 1 简单 allowlist（纯链上 `mapping`，无外部依赖）

**Layer 1 allowlist 是 V3 必须项，当前未实现。**

---

## 5. 关键逻辑自查

### allowlist / blacklist 入口矩阵（当前状态）

| 操作入口 | allowlist 检查 | blacklist 检查 | 规范要求 |
| --- | --- | --- | --- |
| `deposit()` | ❌ | ❌ | allowlist 必须（V3） |
| `redeem()` | ❌ | ❌ | 规范未明确强制 |
| `claimExitAssets()` | ❌ | ❌ | 规范未明确强制 |
| `transferFrom()`（份额转让） | ❌ | ❌ | 规范未明确 |
| `rebalance()` | ❌ | ❌ | 无需（permissionless 公共调用） |
| `castVote()` | ❌ | ❌ | 无需（仅信号，持 RWT 即可） |

**allowlist 最关键拦截入口：`deposit()`** — 邀请制的核心是阻止非白名单用户存款。

---

### restricted vs blocked 设计意图（规范定义，未落地）

| 状态 | 含义 | 影响操作 | 规范层级 |
| --- | --- | --- | --- |
| `restricted`（未在 allowlist） | 尚未完成 KYC/onboarding | 阻止 deposit；已有持仓可 redeem | V3 Layer 1 |
| `blocked`（在 blacklist） | 制裁/黑名单目标 | 阻止 deposit + 可能限制 redeem | V4 Layer 2 |

**关键区别**：blocked 用户的已有资产不应被没收，规范明确"黑名单允许合理退出路径"。

---

### 误封风险评估（Layer 1 实现时需注意）

| 风险场景 | 影响 | 缓解方式 |
| --- | --- | --- |
| admin 误移除用户 allowlist | 用户无法 deposit，已有持仓可 redeem | 移除白名单仅阻止新存款，不影响已有份额（§1.2 明确） |
| Timelock 24h 延迟影响紧急 allowlist 操作 | 新用户无法即时加入 | 接受为运营成本，或单独设 allowlist 管理员走快速路径 |
| 误将合约地址排除 | 合约间调用可能受阻 | allowlist 仅检查存款发起地址（`caller`），不拦截合约内部流转 |

---

## 6. 测试覆盖检查

**当前：allowlist 相关测试为零。**

| 测试项 | 要求 | 现状 |
| --- | --- | --- |
| 非白名单地址 deposit 应 revert `NotAllowed` | V3 必须 | ❌ 无测试（功能未实现） |
| 白名单地址 deposit 成功 | V3 必须 | ❌ 无测试 |
| 移除白名单后 deposit 失败 | V3 必须 | ❌ 无测试 |
| 移除白名单后 redeem 仍可用 | V3 应确认 | ❌ 无测试 |
| addToAllowlist / removeFromAllowlist 权限校验 | V3 必须 | ❌ 无测试 |
| blacklist 阻止 deposit | V4 | N/A |
| blacklist 允许 redeem（退出路径） | V4 | N/A |

---

## 7. 未完成项与遗留风险

| 编号 | 类型 | 描述 | 级别 |
| --- | --- | --- | --- |
| **C1** | **必修项** | `FundVaultV01._deposit()` 中未实现 allowlist 检查 | **P0 — 上线前阻塞** |
| **C2** | **必修项** | allowlist storage（`mapping(address => bool) isAllowed`）未添加 | **P0 — 上线前阻塞** |
| **C3** | **必修项** | allowlist 管理接口（`addToAllowlist / removeFromAllowlist`）未实现 | **P0 — 上线前阻塞** |
| **C4** | **必修项** | allowlist 测试套件缺失 | **P0 — 阻塞** |
| D4-V4 | 接口预留 | IComplianceHook / IBlacklist 合约接口文件未单独创建 | P2 — V4 实现时补充 |
| D_COM_2 | 接口预留 | RWA 路径接口（IRwaHolder）未创建 | P2 — V5+ 范围 |

---

## 8. 是否建议进入下一阶段

**不建议。需先完成 Phase 5 patch1。**

C1–C4 属于同一功能单元（allowlist），改动范围明确、代码量小，建议作为 patch1 立即修复：

1. `contracts/FundVaultV01.sol`
   - 添加 `mapping(address => bool) public isAllowed`
   - 添加自定义错误 `NotAllowed()`
   - 添加 `addToAllowlist(address) / removeFromAllowlist(address)`（`onlyRole(DEFAULT_ADMIN_ROLE)`）
   - `_deposit()` 中加入 `if (!isAllowed[caller]) revert NotAllowed()`
2. `test/Phase5_Allowlist.test.ts`（新增）
   - 非白名单 revert、白名单成功、移除后行为、管理权限校验

---

## 9. 最终验收结论

**Phase 5：不通过**

```
❌ 不通过原因（C1–C4）：
  - FundVaultV01._deposit() 无任何准入检查
  - 任意地址可无限制存款，违反邀请制白名单规范
  - 无 allowlist storage、无管理接口、无测试

✅ 可接受项（规范允许推迟）：
  - Layer 2 合规 hook 体系（IComplianceHook / IBlacklist）—— D4 冻结，V4 范围
  - RWA 路径 —— D_COM_2，V5+ 范围
  - 前端披露模板 —— docs/ 已完整定义

⚠️ 待关注（V4 实现时）：
  - blacklist 用户退出路径设计（blocked 不没收资产原则）
  - restricted vs blocked 行为矩阵的代码落地
```

