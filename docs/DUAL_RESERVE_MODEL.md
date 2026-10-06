# 双轨储备模型说明（D6）

状态：Phase 3 验收产出，设计决策记录
生成时间：2026-04-02
关联规范：fd/STEP1_FINALIZED_SPEC_CN.md §3

---

## 一、背景

合约中存在两套独立的储备控制机制，规范未明确区分，运营人员极易混淆。
本文档为 D6 缺口的正式说明，不涉及代码变更。

---

## 二、两套机制定义

### 机制 A — `reserveRatioBps`（管理员可配置）

| 属性 | 说明 |
|------|------|
| 默认值 | `10_000`（100%）|
| 作用范围 | `availableToInvest()` 计算 / `transferToStrategyManager()` 可转出上限 |
| 含义 | vault 内至少保留 `reserveRatioBps` 比例的资金不得转出 |
| 默认效果 | 默认 100% 时 `availableToInvest() = 0`，`transferToStrategyManager()` 任何金额均 revert `ReserveTooLow` |
| 修改方式 | `setReserveRatioBps(newBps)` — DEFAULT_ADMIN_ROLE |

### 机制 B — `RESERVE_FLOOR / TARGET / CEILING`（固定常量）

| 常量 | 值 | 作用 |
|------|-----|------|
| `RESERVE_FLOOR_BPS` | 1500 (15%) | 低于此值时 `rebalance()` pull 方向触发 |
| `RESERVE_TARGET_BPS` | 3000 (30%) | `rebalance()` 向此目标回注 |
| `RESERVE_CEILING_BPS` | 3500 (35%) | 超过此值时 `rebalance()` 发出 `RebalanceNeedsReview`，**不自动部署** |
| `MAX_STRATEGY_DEPLOY_BPS` | 7000 (70%) | strategy 总部署硬上限 |

这四个常量不可配置，与机制 A 完全独立。

---

## 三、两套机制的职责边界

```
机制 A (reserveRatioBps)
    控制 admin 手动部署通道
    └─ transferToStrategyManager() — 受 reserveRatioBps + MAX_STRATEGY_DEPLOY_BPS 双重约束

机制 B (RESERVE_FLOOR/TARGET/CEILING)
    控制 permissionless 自动回注通道
    └─ rebalance() pull 方向 — reserve < 15% 时从 strategy 拉回资金至 30% 目标
    └─ rebalance() 超过 35% — 仅发 RebalanceNeedsReview，不自动部署（§3 规范要求）
```

两套机制相互独立，不联动。

---

## 四、运营激活顺序

**正确的运营启动顺序：**

```
1. 部署合约（reserveRatioBps 默认 100%，externalTransfersEnabled 默认 false）
   ↓
2. admin 设置 reserveRatioBps（如设为 3000 = 30%）
   → 此后 transferToStrategyManager() 可转出最多 70% 资金
   ↓
3. admin 设置 externalTransfersEnabled = true（按需，启用外部转账通道）
   ↓
4. admin 调用 transferToStrategyManager(amount) 手动部署资金
   ↓
5. rebalance() 由任何人触发（cooldown 保护）
   → reserve < 15%：自动 pull 回 30% 目标
   → reserve > 35%：仅提醒，admin 须手动 transferToStrategyManager
```

---

## 五、常见运营陷阱

| 陷阱 | 原因 | 后果 |
|------|------|------|
| 忘记调低 `reserveRatioBps` | 误以为常量 B 已设好储备纪律 | `transferToStrategyManager()` 始终 revert `ReserveTooLow` |
| 误以为 rebalance() 会自动部署超额储备 | 混淆两套机制 | reserve > 35% 时只发事件，不实际移动资金 |
| 设置 `reserveRatioBps = 0` | 希望"全部可部署" | `availableToInvest()` = totalAssets，但仍受 MAX_STRATEGY_DEPLOY_BPS 70% 限制 |

---

## 六、Phase 3 修复记录

| 项目 | 修复内容 |
|------|---------|
| reserve > 35% 自动部署（规范偏离）| 已移除 `rebalance()` deploy 方向，改为 `emit RebalanceNeedsReview` |
| `checkUpkeep` 误报 | 已修正：仅 reserve < 15% 时返回 `upkeepNeeded = true` |
| pull 方向测试缺口 | 已补充 4 个专项测试（trigger、target band 恢复、divest 失败、checkUpkeep）|
