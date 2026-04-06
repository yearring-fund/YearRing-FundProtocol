# Step2 执行报告（主报告）

状态：**通过**

验收时间：2026-04-04

执行链：Base 主网（Chain ID 8453）

---

## 1. Step2 唯一目标

在 Base 主网以真实 USDC 完成以下最小闭环：

**用户钱包 → Vault → Aave V3 Strategy → Vault → 用户钱包**

结论：**已完成** ✓

---

## 2. 合约地址

| 合约 | 地址 |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| FundVaultV01 | `0x8acaec738F9559F8b025c4372d827D3CD3928322` |
| StrategyManagerV01 | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` |
| AaveV3StrategyV01 | `0x621CC4189946128eF2d584F69bb994C84FcA612D` |
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |

---

## 3. 角色地址

| 角色 | 地址 |
|---|---|
| ADMIN (DEFAULT_ADMIN_ROLE) | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| GUARDIAN (EMERGENCY_ROLE) | `0xC8052cF447d429f63E890385a6924464B85c5834` |
| TREASURY | `0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705` |

---

## 4. 完整交易记录

| 动作 | tx hash | block | status |
|---|---|---|---|
| allowlist ADMIN | `0xe0f591a2757a00989d71875e493739e75a90c33351c5acc6959acd27c74f6b22` | — | ✓ |
| grant EMERGENCY_ROLE (vault) | `0xf2da0324baa75a6ca8041c4fa3b40a4ba25764d8cbfed1aa618ea78510e1b1ca` | — | ✓ |
| grant EMERGENCY_ROLE (manager) | `0x7de7be2d156a3999b2a51906ab5b533513a7a2d558fab495095c6e1acdb3ea9e` | — | ✓ |
| approve USDC | `0xe81cb0f40daab001d70656bd07f49f6681b56130bc74efe3314bc68f7373139b` | — | ✓ |
| deposit 148.9 USDC | `0x1d787c03989ab6edf5d7731997b3f35a36a5433b224499d0092ddd44d75bd39c` | 44215769 | ✓ |
| transferToStrategyManager 104.23 USDC | `0x31fcf858db32f7acc345d99ada28ae7e2e93461c60ef25b24c290f586e7dc8df` | 44215843 | ✓ |
| invest → Aave V3 104.23 USDC | `0x58f8b47009fd4f9abb12e6d939dc29a0f8fa11973064e8b808c1866380f36930` | 44216000 | ✓ |
| divest (partial) 49 USDC | `0xd3b14940ec0a124834efc9a4dce2326201c6b67fbeaf172b0e92b4cbe472e170` | 44216662 | ✓ |
| returnToVault 50 USDC | `0x0017bdf366a2b4569703b79b5da725ca9902c0776f829becdf81eab4dc6dbdab` | 44216664 | ✓ |
| redeem (partial) 50 fbUSDC | `0xc3b377335770febcaa3192c592af420f25a5194de910d7429938812118fc120c` | 44216726 | ✓ |
| divest (full) 54.23 USDC | `0x2804acf3fc4ef47518729b3b676fb74c1f28d6007d58536ac0ec55f8f764c37c` | 44216815 | ✓ |
| returnToVault 54.23 USDC | `0x8ac1aea3d049804a299363e9bbdcfccc3bddcabefd25bc8338a3c451aedf9611` | 44216818 | ✓ |
| divest dust 0.000128 USDC | `0xc144999853ef0574918b046d0395ba33fb5ed7e381d848bb8d70ba72934bac91` | 44216993 | ✓ |
| returnToVault dust | `0x2a192fa324f3c43f2b8eba76b8257eb720e77a7ee8916cb1bf796266e70dafcc` | 44216995 | ✓ |
| redeem (full) 98.9 fbUSDC | `0xce07eed16919516978f6c48f7ab9a4edfc9f87406c979f0652a8cbe0cb4ec750` | 44217051 | ✓ |

---

## 5. 关键状态快照对比

| 阶段 | 用户 USDC | 用户 Shares | Vault Total | Strategy | aToken |
|---|---|---|---|---|---|
| 初始 | 148.922446 | 0 | 0 | 0 | 0 |
| post-deposit | 0.022446 | 148.9 | 148.9 | 0 | 0 |
| post-invest | 0.022446 | 148.9 | 148.9 | 104.230001 | 104.230000 |
| post-partial-withdraw | 50.022483 | 98.9 | 98.900086 | 54.230122 | 54.230123 |
| post-full-divest | 50.022483 | 98.9 | 98.900091 | 0.000128 | 0.000128 |
| post-dust-cleanup | 50.022483 | 98.9 | 98.900091 | 0 | 0 |
| **最终** | **148.922475** | **0** | **0.000099** | **0** | **0** |

---

## 6. 收益证明

| 时间点 | aToken 余额 | 与 invest 时差值 |
|---|---|---|
| invest 完成（block 44216000）| 104.230000 | — |
| +7 分钟读取 | 104.230035 | +0.000035 USDC |
| +14 分钟读取 | 104.230071 | +0.000071 USDC |
| 全程净收益（用户） | — | **+0.000029 USDC** |

收益来源：Aave V3 链上 aToken accrual，非模拟，非人工填数，非奖励代币。

---

## 7. pause / emergencyExit 最小能力

| 能力 | 触发者 | 当前状态 |
|---|---|---|
| vault.pauseDeposits() | EMERGENCY_ROLE 或 DEFAULT_ADMIN_ROLE | 可用 ✓ |
| vault.pauseRedeems() | EMERGENCY_ROLE 或 DEFAULT_ADMIN_ROLE | 可用 ✓ |
| vault.setMode(Paused) | EMERGENCY_ROLE 或 DEFAULT_ADMIN_ROLE | 可用 ✓ |
| vault.setMode(Normal) | DEFAULT_ADMIN_ROLE only | 可用 ✓ |
| manager.pause() | EMERGENCY_ROLE 或 DEFAULT_ADMIN_ROLE | 可用 ✓ |
| manager.emergencyExit() | DEFAULT_ADMIN_ROLE | 可用 ✓ |

**异常处理原则（本轮固化）：**

> 先停、再查、必要时手动撤回。
> 不做自动恢复、不做自动重试、不做自动化运维编排。

emergencyExit 撤回路径：
1. `manager.emergencyExit()` → 从 Aave 全额 withdraw 到 StrategyManager，自动 forward 到 Vault
2. `vault.setMode(EmergencyExit)` → 用户通过 `claimExitAssets()` 按 snapshot 比例取回

---

## 8. 最终通过判定（Step2ExecuteOrder.md §1.5）

| 条件 | 状态 |
|---|---|
| 1. 主网参数与权限正确 | ✅ |
| 2. 真实 USDC 已进入 Aave V3 | ✅ block 44216000 |
| 3. Strategy 与 Vault 资产口径连续可解释 | ✅ 全程 diff < 0.000001 |
| 4. 至少完成一次部分退出 | ✅ block 44216726 |
| 5. 至少完成一次全部退出 | ✅ block 44217051 |
| 6. 用户资金成功回到钱包 | ✅ 148.922475 USDC |
| 7. pause / emergencyExit 最小能力已确认 | ✅ |
| 8. 证据包完整 | ✅ |

**Step2 总结论：通过**
