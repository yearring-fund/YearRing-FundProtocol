# Step1 差异分析报告（Gap Analysis）

状态：Phase 0 验收产出，已冻结
生成时间：2026-04-01
对照规范：fd/STEP1_FINALIZED_SPEC_CN.md（已冻结）

---

## 说明

本文件记录当前仓库与《Step1 最终定稿规范》之间的全部已知差异。
Phase 0 本身不实现这些缺口，仅记录与分配。
各缺口的修复责任由对应 Phase 负责，Phase 0 不提前干预。

---

## 差异清单

### D1 — PROPOSER_ROLE 未应用于 GovernanceSignalV02

- **规范依据**：§6 "合约层建议角色：emergency role / upgrader role / proposer role"
- **现状**：
  - `PROPOSER_ROLE` 在 `FundVaultV01.sol:29` 定义为常量，但从未在任何合约中 grant 或 check
  - `GovernanceSignalV02.createProposal()` 使用 `onlyRole(DEFAULT_ADMIN_ROLE)` 而非 `PROPOSER_ROLE`
- **风险**：提案创建权未与管理员权限分离，权限边界弱于规范要求
- **性质**：权限分离缺口，非高危
- **负责阶段**：**Phase 4（权限/治理/安全边界）**
- **修复方向**：GovernanceSignalV02.createProposal() 改为 `onlyRole(PROPOSER_ROLE)`，并在部署/测试中正确 grant

---

### D2 — Timelock 未部署，非紧急操作即时执行

- **规范依据**：§6 "非紧急操作应经过 timelock 与公告，包括升级、重大参数调整、启用新 strategy 路径、迁移动作"
- **现状**：
  - `FundVaultV01` 构造参数注释写 `admin_ Timelock / DEFAULT_ADMIN_ROLE holder`，但仓库中无 Timelock 合约
  - `setMgmtFeeBpsPerMonth`、`setTreasury`、`setStrategy`、`setModules`、`openExitModeRound` 等敏感操作均即时生效
- **风险**：单签/多签地址即时执行所有管理员操作，无延迟保护，用户无法提前察觉参数变更
- **性质**：**上线前 P0 阻塞项**
- **负责阶段**：**Phase 4（权限/治理/安全边界）**
- **修复方向**：部署 OpenZeppelin TimelockController，将 DEFAULT_ADMIN_ROLE 持有方设为 Timelock 合约；非紧急操作通过 Timelock 排队执行

---

### D3 — 合规 hook 未实现（allowlist / blacklist / KYC）

- **规范依据**：§7 "V3 初版应采用邀请制白名单 + 钱包级 allowlist + 持续黑名单筛查"
- **现状**：
  - `FundVaultV01._deposit()` / `_withdraw()` 无任何 allowlist / blacklist 检查
  - 仅存在文档说明，无代码落地
- **风险**：任意地址均可 deposit，无用户准入控制，违反规范 §7 用户准入要求
- **性质**：**上线前 P0 阻塞项**
- **负责阶段**：**Phase 5（合规边界）**
- **修复方向**：在 `_deposit()` / `_withdraw()` 中增加 allowlist 检查 hook；提供 `setAllowlist()` / `setBlacklist()` 管理接口

---

### D4 — 前端 MODE_LABELS 使用旧标签（已修复）

- **规范依据**：§3 系统三态为 Normal / Paused / Emergency Exit
- **原状**：
  - `AdminConsole.tsx`：`const MODE_LABELS = ['Normal', 'Stress', 'Exit']`
  - `StrategySection.tsx`：`const MODE_LABELS = ['Normal', 'Stress', 'Exit']`
  - 按钮文字、描述文字均使用旧名称
- **修复内容（Phase 0 已完成）**：
  - `AdminConsole.tsx`：MODE_LABELS → `['Normal', 'Paused', 'EmergencyExit']`
  - `AdminConsole.tsx`：按钮标签 Stress→Paused，Exit→EmergencyExit
  - `AdminConsole.tsx`：描述文字更新为正式口径（Normal/Paused/EmergencyExit 各自行为）
  - `StrategySection.tsx`：MODE_LABELS → `['Normal', 'Paused', 'EmergencyExit']`
- **状态**：✅ **Phase 0 已修复**

---

### D5 — rebalance() 部署路径跳过 accrueManagementFee()

- **规范依据**：§2 "管理费在 vault 层按时间连续计提"
- **现状**：
  - `rebalance()` 在 reserve > CEILING 时直接 `safeTransfer(strategyManager, toDeploy)`，未先调用 `accrueManagementFee()`
  - 对比：`transferToStrategyManager()` 在转账前调用 `accrueManagementFee()`（FundVaultV01.sol:394）
- **风险**：rebalance 触发的资金转出改变 totalAssets 分布，但未结算本应在此之前计提的管理费，造成微量计提时序误差；随触发频率累积
- **性质**：技术缺口，非高危，但会计连续性不完整
- **负责阶段**：**Phase 5（会计连续性验收）**
- **修复方向**：在 `rebalance()` deploy 分支执行 `safeTransfer` 前插入 `accrueManagementFee()` 调用

---

### D6 — 双轨储备模型无文档说明

- **规范依据**：§3 储备区间 15%–35%，70% 上限
- **现状**：合约中存在两套独立的储备控制机制，规范未提及其区别，也无文档说明交互关系：
  1. **`reserveRatioBps`**（admin 可配置，默认 `10_000` = 100%）
     - 控制 `availableToInvest()` 计算
     - 控制 `transferToStrategyManager()` 可转出上限
     - 默认值 100% 意味着：`availableToInvest()` 始终返回 0，`transferToStrategyManager()` 无法转出任何资金，直到 admin 主动降低此值
  2. **`RESERVE_FLOOR_BPS / RESERVE_TARGET_BPS / RESERVE_CEILING_BPS`**（固定常量，15%/30%/35%）
     - 控制 `rebalance()` 的触发逻辑和目标方向
     - 与 `reserveRatioBps` 相互独立，不联动
- **运营风险**：
  - 管理员可能误以为"常量已设好储备纪律"而忘记调整 `reserveRatioBps`，导致资金永远无法通过 `transferToStrategyManager()` 部署
  - 两套机制边界关系不明，新运营人员极易误操作
- **性质**：文档缺口 + 运营认知风险，代码逻辑本身无 bug
- **负责阶段**：**Phase 3（申赎/流动性/储备纪律验收）**
- **修复方向**：Phase 3 验收报告中补充"双轨储备模型说明"，明确 `reserveRatioBps` 的用途、默认值含义、与常量区间的关系，以及运营时的配置顺序；同时评估是否需要在合约注释中补充说明

---

## 阶段分配汇总

| 缺口 | 内容摘要 | 负责阶段 | 优先级 |
|------|---------|---------|--------|
| D1 | PROPOSER_ROLE 未应用于治理合约 | Phase 4 | P3 |
| D2 | Timelock 未部署，管理员操作即时生效 | Phase 4 | P0（上线前） |
| D3 | 合规 hook 缺失，无用户准入控制 | Phase 5 | P0（上线前） |
| D4 | 前端旧标签 Stress/Exit | Phase 0 | ✅ 已修复 |
| D5 | rebalance() 跳过管理费结算 | Phase 5 | P2 |
| D6 | 双轨储备模型无文档说明 | Phase 3 | P3 |

---

## 不在本报告范围内的内容

- 合约编译错误或测试失败：不属于 Gap Analysis 范围
- V2.5 Beta 规划项：不在 Step1 规范范围内
- 前端 UI 美化、功能扩展：不在 Step1 规范范围内
