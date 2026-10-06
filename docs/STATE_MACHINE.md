# UserStateEngineV02 — State Machine

## 定位

状态引擎是纯 view 层，从 `LockLedgerV02` 的现有字段推导状态，不写入任何存储，不影响资产会计。

---

## 状态定义

| 状态 | 值 | 含义 | V2 可达 |
| --- | --- | --- | --- |
| `Normal` | 0 | 无活跃锁仓，或仓位已正常解锁 | ✅ |
| `LockedAccumulating` | 1 | 锁仓中，到期时间未到，积分累积中 | ✅ |
| `Matured` | 2 | 已过到期时间，可调用 `unlock()` | ✅ |
| `EarlyExit` | 3 | 提前解锁退出，points 清零，principal 返还 | ✅ |

---

## 推导规则（per-lock）

```
getLock(lockId).owner == address(0)  →  Normal   （仓位不存在）
getLock(lockId).unlocked == true     →  Normal   （已完成解锁）
unlocked == false && now < unlockAt  →  LockedAccumulating
unlocked == false && now >= unlockAt →  Matured
提前解锁                              →  EarlyExit（V3+ 实现）
```

---

## 状态迁移图

```
        lock()
Normal ──────────► LockedAccumulating
  ▲                       │
  │           time passes │ (now >= unlockAt)
  │                       ▼
  │    unlock()        Matured
  └────────────────────────
                           │  earlyExitWithReturn()
                           ▼  (LockRewardManagerV02)
                       EarlyExit
```

---

## 用户聚合状态

`userStateOf(owner)` 遍历用户所有历史仓位，返回优先级最高的状态：

```
EarlyExit > LockedAccumulating > Matured > Normal
```

示例：用户有两个仓位，一个 Matured、一个 LockedAccumulating → 返回 `LockedAccumulating`。

---

## 合约接口

```solidity
// 单个仓位状态
function lockStateOf(uint256 lockId) external view returns (LockState);

// 用户聚合状态（最高优先级）
function userStateOf(address owner) external view returns (LockState);
```

两个函数均为纯 view，无 gas 消耗（只读调用）。

---

## 设计约束

- 状态全部由 `LockPosition` 字段 + `block.timestamp` 推导，**不存储任何状态值**
- 与资产会计（`totalAssets` / `shares`）**零耦合**
- `EarlyExit` 通过 `LockRewardManagerV02.earlyExitWithReturn()` 触发，principal 全额返还，points 清零，reward tokens 原数归还 treasury
