# MetricsLayerV02 — Protocol Metrics

## 1. 指标设计摘要

MetricsLayerV02 是 V02 协议的只读数据层，目标是支撑三类使用场景：

| 场景 | 需要的指标 |
|---|---|
| Grant 申请材料 | TVL、锁仓率、tier 分布 |
| 产品 Demo / 录屏 | 锁仓比例、积分累积、early exit 行为 |
| 前端 Dashboard | 单次 RPC 拿到 snapshot，脚本输出 JSON 供静态展示 |

**核心叙事对应关系**：

- `lockedRatioBps` → 证明"用户选择承诺，不是纯流动性挖矿"
- Tier breakdown (byCount + byShares) → 证明"用户在不同期限档位都有参与，不是只选最短档"
- `totalActivePoints` → 证明"积分机制真实运转，有持续累积"
- `earlyExitCount` → 证明"早退机制存在但用户克制使用，设计合理"

**分层设计原因**：

合约层只做 O(1) 查询，原因是迭代全部 lockId 的 gas 代价在生产环境不可控；链下脚本承担 O(n) 聚合，在 demo/报告阶段完全够用，且输出 JSON 格式方便复用。

---

## 2. 推荐优先实现的 metrics 列表

按叙事重要性排序：

| 优先级 | 指标 | 叙事支撑 | 实现层 | V2 状态 |
|---|---|---|---|---|
| P0 | `totalTVL` | 协议规模基准 | 合约 snapshot() | ✅ 已实现 |
| P0 | `lockedRatioBps` | 用户承诺深度 | 合约 snapshot() | ✅ 已实现 |
| P0 | Tier breakdown (byCount) | 期限选择分布 | 脚本迭代 | ✅ 已实现 |
| P0 | Tier breakdown (byShares) | 资金期限分布 | 脚本迭代 | ✅ 已实现 |
| P1 | `totalLockedShares` | 锁仓绝对量 | 合约 snapshot() | ✅ 已实现 |
| P1 | `totalLocksEver` | 历史参与总量 | 合约 snapshot() | ✅ 已实现 |
| P1 | `earlyExitCount` | 早退行为频率 | 脚本迭代 | ✅ 已实现 |
| P1 | `totalActivePoints` | 积分系统活跃度 | 脚本迭代 | ✅ 已实现 |
| P2 | `maturedNotUnlocked` | 用户粘性（到期未取） | 脚本迭代 | ✅ 已实现 |
| P2 | `normalUnlocked` | 正常解锁完成率 | 脚本迭代 | ✅ 已实现 |
| P3 | `totalPointsIssued`（全量历史） | 协议激励总量 | 需全量事件 | ❌ V2 不做，推迟 V3 |
| P3 | user distribution / top lockers | 用户集中度分析 | 需 owner 遍历 | ❌ V2 不做，推迟 V3 |
| P3 | `averageLockDuration` | 平均承诺时长 | 需迭代计算 | ❌ V2 不做，推迟 V3 |

---

## 3. Solidity view / script / JSON 输出方案

三层各司其职，数据从链上流向 JSON 文件：

```
链上合约 (Solidity view)
    │
    │  MetricsLayerV02.snapshot()   ← 单次 staticcall，4 个字段
    │  LockLedgerV02.getLock(id)    ← 脚本逐 id 调用
    │  LockBenefitV02.tierOf(id)    ← 脚本逐 id 调用
    │  LockPointsV02.pointsOf(id)   ← 脚本逐 id 调用
    ▼
链下脚本 (scripts/metrics.ts)
    │
    │  collectMetrics() — 迭代 0..nextLockId-1，聚合 tier breakdown + lifecycle
    │  printMetrics()   — 格式化输出到 console
    │  saveJson()       — 写入 metrics_output.json
    ▼
JSON 文件 (metrics_output.json)
```

### 层一：Solidity view 接口

`MetricsLayerV02.snapshot()` 返回 `ProtocolSnapshot` struct，一次 staticcall 获取：

```solidity
struct ProtocolSnapshot {
    uint256 totalTVL;           // vault.totalAssets()         — USDC 6-dec
    uint256 totalLockedShares;  // ledger.totalLockedShares()  — fbUSDC 18-dec
    uint256 lockedRatioBps;     // totalLockedShares×1e4 / totalSupply — bps
    uint256 totalLocksEver;     // ledger.nextLockId()          — 历史总数
}
```

脚本另外直接调用各合约的原子 view（不经过 MetricsLayerV02）：

| 调用 | 用途 |
|---|---|
| `ledger.getLock(id)` | 读取 `owner / shares / unlockAt / unlocked / earlyExited` |
| `benefit.tierOf(id)` | 判断 Bronze / Silver / Gold |
| `points.pointsOf(id)` | 读取当前积分（仅活跃仓位） |

### 层二：脚本聚合逻辑

```
for id in 0..totalLocksEver-1:
    pos = getLock(id)
    if earlyExited  → earlyExitCount++; skip
    if unlocked     → normalUnlocked++;  skip

    // 活跃仓位
    activeLocks++
    if now >= unlockAt → maturedNotUnlocked++
    tier = tierOf(id)  → tierBreakdown[tier].count++, .shares += pos.shares
    totalActivePoints += pointsOf(id)
```

### 层三：JSON 输出结构

`metrics_output.json` 完整 schema（所有 bigint 字段同时提供原始值和 `_formatted` 可读字符串）：

```jsonc
{
  "generatedAt": "2026-03-28T00:00:00.000Z",   // ISO 8601 时间戳

  "snapshot": {                                  // 来自 MetricsLayerV02.snapshot()
    "totalTVL":                    "4500000000",
    "totalTVL_formatted":          "4500.00 USDC",
    "totalLockedShares":           "3500000000000000000000",
    "totalLockedShares_formatted": "3500.0000 fbUSDC",
    "lockedRatioBps":              "7777",
    "lockedRatio_pct":             "77.77%",
    "totalLocksEver":              "4"
  },

  "tierBreakdown": {                             // 来自脚本迭代（仅活跃仓位）
    "byCount":  { "Bronze": 1, "Silver": 1, "Gold": 1 },
    "byShares": {
      "Bronze": "1000000000000000000000", "Bronze_formatted": "1000.0000 fbUSDC",
      "Silver": "2000000000000000000000", "Silver_formatted": "2000.0000 fbUSDC",
      "Gold":   "500000000000000000000",  "Gold_formatted":   "500.0000 fbUSDC"
    }
  },

  "lifecycleStats": {                            // 来自脚本迭代
    "activeLocks":                  3,
    "earlyExitCount":               1,
    "normalUnlocked":               0,
    "maturedNotUnlocked":           0,
    "totalActivePoints":            "900000000",
    "totalActivePoints_formatted":  "900.00 pts"
  }
}
```

**设计约定**：
- bigint 字段（链上值）以字符串存储，避免 JSON number 精度丢失
- 每个 bigint 字段配套 `_formatted` 供 UI 直接展示
- `snapshot` 块可单独被前端消费（无需 O(n) 迭代）
- `tierBreakdown` 和 `lifecycleStats` 仅在脚本运行后可用

---

## 设计原则

| 层级 | 职责 | 实现位置 |
|---|---|---|
| 合约层 | O(1) 原子指标打包，单次 staticcall | `contracts/MetricsLayerV02.sol` |
| 脚本层 | 迭代所有 lockId，聚合 tier breakdown / lifecycle stats | `scripts/metrics.ts` |
| 输出层 | console 格式化 + `metrics_output.json` 结构化 JSON | `scripts/metrics.ts` |

合约不持有状态，不写入任何 storage，无权限控制。

---

## snapshot() — O(1) 字段

| 字段 | 数据来源 | 单位 |
|---|---|---|
| `totalTVL` | `FundVaultV01.totalAssets()` | USDC 6-decimal |
| `totalLockedShares` | `LockLedgerV02.totalLockedShares()` | fbUSDC 18-decimal |
| `lockedRatioBps` | `totalLockedShares × 10000 / vault.totalSupply()` | bps（空 vault 返回 0） |
| `totalLocksEver` | `LockLedgerV02.nextLockId()` | 历史总锁仓数（含已解锁） |

---

## scripts/metrics.ts — 聚合指标

| 指标 | 计算方式 | 说明 |
|---|---|---|
| Tier breakdown (byCount) | 遍历 0..nextLockId-1，按 `LockBenefitV02.tierOf()` 分组 | 仅活跃仓位计入 |
| Tier breakdown (byShares) | 同上，累计 `pos.shares` | |
| earlyExitCount | 统计 `pos.earlyExited == true` | |
| normalUnlocked | 统计 `pos.unlocked && !pos.earlyExited` | |
| maturedNotUnlocked | 统计 `block.timestamp >= pos.unlockAt && !pos.unlocked` | |
| totalActivePoints | 累计 `LockPointsV02.pointsOf(lockId)` for active locks | |

---

## 运行方式

```bash
# 自部署模式（默认）：部署全套合约 + 填充示例数据 + 输出指标
npx hardhat run scripts/metrics.ts

# 未来扩展：连接已有合约（需实现 deployments/ 读取逻辑）
METRICS_MODE=existing npx hardhat run scripts/metrics.ts
```

输出：
- Console：格式化指标
- `metrics_output.json`：结构化 JSON（含 formatted 字段）

---

## 示例输出（deploy mode，4500 USDC TVL）

```
TVL              : 4500.00 USDC
Total Locked     : 3500.0000 fbUSDC
Locked Ratio     : 77.77%
Total Locks Ever : 4

Active Lock Tier Distribution:
  Bronze : 1 lock,  1000 fbUSDC
  Silver : 1 lock,  2000 fbUSDC
  Gold   : 1 lock,   500 fbUSDC

Early Exit Count : 1
Active Points    : 900.00 pts
```

---

## 已知限制

- `totalLocksEver` 含历史已解锁仓位，非当前活跃数（活跃数在脚本 `activeLocks` 字段）
- 链上 `snapshot()` 不含 tier breakdown（O(n) 操作，生产环境不适合放合约层）
- `METRICS_MODE=existing` 尚未实现，需配合 `deployments/` 地址文件

*文档版本：v1.1 | 日期：2026-03-28 | 变更：补充指标设计摘要（§1）和优先级列表（§2）*
