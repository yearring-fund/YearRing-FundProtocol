# Closed Beta Frontend Status Report

> 生成日期：2026-05-07  
> 仓库：yearring-fund/YearRing-FundProtocol (origin) / SiLugang/YearRing-FundProtocol (personal)  
> 当前分支：main（跟踪 origin/main，同步，有未提交本地改动）  
> 执行范围：只读检查，不修改任何代码

---

## 一、前端目录判定

仓库中存在**两个独立前端目录**：

| 目录 | 技术栈 | 合约地址 | 用途判定 |
|---|---|---|---|
| `frontend/` | React 18 · Vite 5 · wagmi v2 · viem v2 · 自定义 CSS | Closed Beta 新部署地址（2026-05-05 自动生成） | **Closed Beta 目标前端** |
| `org-setup/yearring-app/` | React 18 · Vite · wagmi v3 · Tailwind · shadcn-like | V01/V02 旧演示地址（FundVaultV01 旧地址） | 旧演示 App，**不是** closed beta 目标 |

**判定依据**：
- `frontend/src/contracts/addresses.ts` 第 1 行注释：`// Closed Beta deployment addresses — base — 2026-05-05T16:10:02.920Z`，与 `deployments/closed_beta_base.json` 地址一一对应。
- `org-setup/yearring-app/src/lib/contracts.ts` 第 7 行：`FundVaultV01: '0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54'`，是旧演示地址，与 closed beta 不符。
- git status 中 `frontend/` 文件有改动追踪，`org-setup/yearring-app/` 无改动记录。

**本报告后续所有检查均针对 `frontend/` 目录。**

---

## 二、Part 1 — 前端基础状态检查表

### 2.1 技术栈

| 检查项 | 当前状态 | 文件位置 |
|---|---|---|
| React / TypeScript | React 18.2 · TS 5.3 | `frontend/package.json` |
| 构建工具 | Vite 5.1 | `frontend/package.json` |
| 链上读写 | wagmi 2.9 · viem 2.9 | `frontend/package.json` |
| UI 框架 | 无 Tailwind / shadcn，自定义 CSS | `frontend/src/` |
| RPC 配置 | `http()` 默认（无自定义 RPC URL） | `frontend/src/wagmiConfig.ts:9` |
| 链 ID 锁定 | Base Mainnet 8453 ✓ | `frontend/src/wagmiConfig.ts` |

### 2.2 合约地址与 ABI 配置

| 检查项 | 当前状态 | 文件位置 |
|---|---|---|
| 地址配置文件 | `addresses.ts`，12 个合约地址全部为 closed beta 部署地址 | `frontend/src/contracts/addresses.ts` |
| ABI 配置文件 | `abis.ts`，手写 fragment ABI | `frontend/src/contracts/abis.ts` |
| USDC 地址 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` ✓ | `addresses.ts:5` |
| StrategyManagerV01 地址 | ❌ 缺失（在 `closed_beta_base.json` 有，未导入） | 见 §三.5 |
| AaveV3StrategyV01 地址 | ❌ 缺失（在 `closed_beta_base.json` 有，未导入） | 见 §三.5 |
| Timelock 地址 | ❌ 缺失（在 `docs/ADMIN_MIGRATION_RECORD.md:24` 有） | 见 §三.6 |
| Safe 地址 | ❌ 不存在（文档明确：no multisig yet） | `docs/ADMIN_MIGRATION_RECORD.md:54` |

### 2.3 旧命名残留检查

| 检查项 | 当前状态 | 文件位置 |
|---|---|---|
| `RWT` 用户可见文案 | ✅ 不存在 | — |
| `RewardToken` 用户可见文案 | ✅ 不存在 | — |
| `fbUSDC` 用户可见文案 | ✅ 不存在（已用 yrCORE / Vault Shares） | — |
| `FundVaultV01` 用户可见文案 | ✅ 不存在（已用 YearRing Core Vault） | — |
| `fee discount` 用户可见文案 | ❌ 存在 6 处（见 §三.2） | 见下 |
| `MockUSDC` ABI 变量名 | ⚠️ 名称含 "Mock"，指向主网 USDC | `abis.ts:3` |
| `mint` 操作暴露给用户 | ❌ VaultSection 有 "Mint MockUSDC" 按钮 | `VaultSection.tsx:171` |
| "Demo" / "Testnet" 文案 | ❌ StrategySection 含 "Aave-based Demo" 和 Testnet 说明 | `StrategySection.tsx:58,73` |

### 2.4 已有页面 / 模块

| 页面 / 模块 | 路由 | 状态 |
|---|---|---|
| Dashboard | `/` | ✅ 有 |
| Deposit + Redeem | `/deposit` | ✅ 有 |
| Lock | `/lock` | ✅ 有 |
| Positions（Lock 列表 + Rebate + EarlyExit） | `/positions` | ✅ 有 |
| Beneficiary | `/beneficiary` | ✅ 有 |
| Governance | `/governance` | ✅ 有 |
| Claim（Exit Assets） | `/claim` | ✅ 有 |
| Community | `/community` | ✅ 有 |
| Portfolio（独立页面） | ❌ 无 | Dashboard 部分展示 |
| Admin（独立路由） | ❌ 无独立路由 | AdminConsole 组件无路由，仅内嵌 |

---

## 三、Part 2 — Closed Beta 新版本改动需求

### 3.1 Vault / yrCORE

| 项目 | 状态 | 依据 |
|---|---|---|
| `yrCORE` 命名 | ✅ 正确使用 | `VaultSection.tsx:161` |
| `convertToAssets(userShares)` 作为资产价值主来源 | ❌ 缺失 | `VaultSection.tsx` 无此调用；Dashboard `fmtShares(sharesBal)` 展示 shares，无资产价值换算 |
| `previewDeposit` 展示预计 shares | ✅ DepositRedeem.tsx 有 | `DepositRedeem.tsx:80` |
| `previewRedeem` 展示预计 USDC | ✅ DepositRedeem.tsx 有 | `DepositRedeem.tsx` |
| `totalSupply` 在 ABI 中 | ❌ 缺失 | `abis.ts` FundVault_ABI 无 `totalSupply` |
| PPS 来源 | ⚠️ 用 `pricePerShare()`（合约有此函数 ✓），但规范要求优先 `convertToAssets(1e18)` | `VaultSection.tsx:18` |
| "Mint MockUSDC" 按钮 | ❌ 暴露给用户，主网 USDC 无 mint 函数，调用必然失败 | `VaultSection.tsx:104-176` |
| "Base Sepolia" / "Testnet" 文案 | ❌ 出现在 VaultSection note | `VaultSection.tsx:178` |

**需修改**：
1. 移除 `VaultSection` 的 mint 区块（`VaultSection.tsx:168-177`）
2. 删除 "Base Sepolia" / testnet 说明文字（`VaultSection.tsx:178`）
3. 补充 `convertToAssets(sharesBal)` 作为用户资产价值展示
4. ABI 补 `totalSupply`

### 3.2 Points / Rebate 命名

| 项目 | 状态 | 文件位置 |
|---|---|---|
| `fee discount` → `Rebate` 替换 | ❌ 6 处残留 | 见下 |
| Points 单一余额展示 | ✅ 无 active/finalized 双展示 | — |
| Early Exit 扣除 Points 提示 | ✅ 有 | `Positions.tsx:256` |
| Rebate 权益说明（非保证收益） | ⚠️ 有展示但无明确"非保证收益"说明 | `Positions.tsx:199` |
| "YRPTS" 展示给用户 | ⚠️ Lock.tsx:151 中出现 "(YRPTS)" | `Lock.tsx:151` |

**`fee discount` 6 处残留**：

| 文件 | 行 | 内容 |
|---|---|---|
| `Lock.tsx` | 151 | `"receive upfront Points (YRPTS) and fee discounts"` |
| `Lock.tsx` | 223 | `<span className="info-label">Fee Discount</span>` |
| `Lock.tsx` | 18–20 | `discountLabel: '20%'` 渲染到 UI |
| `FeeRulesSection.tsx` | 63 | `<th>Mgmt Fee Discount</th>` |
| `YieldSection.tsx` | 242 | `"Mgmt Fee Discount (best tier)"` |
| `DaoBridgeSection.tsx` | 9 | `'Fee Discount Signal'`（治理提案类型标签） |

### 3.3 Lock 体系

| 项目 | 状态 | 文件位置 |
|---|---|---|
| `lockWithPoints()` 函数调用 | ✅ 正确 | `Lock.tsx` via `LockPointsRebateManager_ABI` |
| `earlyExit()` 调用路径 | ✅ 正确 | `Positions.tsx:159` |
| `checkEarlyExit()` Points clawback 展示 | ✅ 有 | `Positions.tsx:77` |
| Lock tier 读取（`tierOf`） | ✅ `LockBenefit_ABI` | `LockRow.tsx:36` |
| Lock maturity / duration / status | ✅ 通过 `getLock` + `lockStateOf` | `LockRow.tsx`, `Positions.tsx` |
| `issuedPoints` 展示 | ✅ | `LockRow.tsx:50` |
| Lock 页描述仍含 "fee discounts" | ❌ | `Lock.tsx:151` |
| `discountLabel` 渲染为 UI 文字 | ❌ | `Lock.tsx:18–20` |

### 3.4 Treasury

| 项目 | 状态 | 文件位置 |
|---|---|---|
| Treasury 是否被描述为控制用户本金 | ✅ 无此错误描述 | — |
| Treasury USDC balance 展示 | ❌ 缺失 | Admin 无 Treasury 状态面板 |
| Treasury ABI | ❌ `abis.ts` 无 Treasury ABI | `abis.ts` |
| `TreasuryV02` 地址 | ✅ 已在 addresses.ts | `addresses.ts:7` |
| "Treasury is protocol fee layer" 说明 | ❌ 缺失 | 无此文案 |

### 3.5 StrategyManager / AaveV3Strategy

| 项目 | 状态 | 文件位置 |
|---|---|---|
| `StrategyManagerV01` 地址 | ❌ 缺失于 `addresses.ts` | `closed_beta_base.json:23`：`0x7359388D2402a1C7494bE45ecC20c95C837f8692` |
| `AaveV3StrategyV01` 地址 | ❌ 缺失于 `addresses.ts` | `closed_beta_base.json:24`：`0xE412435673f630b8546567b8cFadc6A4852fef73` |
| StrategyManager 地址读取方式 | ⚠️ 从 vault `strategyManager()` 动态读取（`StrategySection.tsx:16`），可行但 Admin 操作需要硬编码 | `StrategySection.tsx:16` |
| `invest` / `divest` / `returnToVault` 按钮 | ❌ Admin 无此按钮 | `AdminConsole.tsx`（全文无此函数） |
| `invest` / `divest` / `returnToVault` ABI | ❌ `StrategyManager_ABI` 缺失 | `abis.ts:47–52` |
| `idleUnderlying` 读取 | ❌ `StrategyManager_ABI` 有声明但前端无展示 | `abis.ts:50` |
| AaveV3Strategy balance 展示 | ❌ 缺失 | 无 AaveV3Strategy ABI |
| `tvlPct` bigint 安全 | ⚠️ `Number(managed)/Number(total)` | `StrategySection.tsx:46` |
| "Aave-based Demo" / "Testnet" 文案 | ❌ 主网不应有此文案 | `StrategySection.tsx:58,73` |

### 3.6 Admin / Timelock / Roles

| 项目 | 状态 | 文件位置 / 依据 |
|---|---|---|
| `ProtocolTimelockV02` 地址 | **Missing Input**（地址已知但未进前端） | `docs/ADMIN_MIGRATION_RECORD.md:24`：`0x054Cb2c32D6062B291420584dE2e5952C372cDD6` |
| Safe / Multisig 地址 | **不存在**（文档明确：no multisig yet） | `docs/ADMIN_MIGRATION_RECORD.md:54` |
| Guardian 地址 | **Missing Input**（地址已知但未进前端） | `deployments/closed_beta_base.json`：`0xC8052cF447d429f63E890385a6924464B85c5834` |
| deployer 是否已无 admin | ✅ 已转移给 Timelock | `docs/ADMIN_MIGRATION_RECORD.md:7` |
| Timelock/Guardian 地址展示 | ❌ Admin 无此展示 | `AdminConsole.tsx` 全文无此内容 |
| `addToAllowlist` / `removeFromAllowlist` 按钮 | ❌ Admin 无此按钮 | `AdminConsole.tsx`；函数存在于合约 `YearRingCoreVaultV01.sol:390,396` |
| `addToAllowlist` / `removeFromAllowlist` ABI | ❌ `FundVault_ABI` 缺失 | `abis.ts` |
| 高风险按钮 loading guard | ✅ `busy` 变量统一 guard | `AdminConsole.tsx:74` |
| 高风险按钮 disabled state | ✅ 有 | `AdminConsole.tsx` |
| 高风险按钮二次确认 | ❌ 无 confirm 弹窗 | `AdminConsole.tsx` |
| tx hash 展示 | ✅ 有 | `AdminConsole.tsx` |

### 3.7 bigint 安全

| 项目 | 状态 | 文件位置 |
|---|---|---|
| `fmtShares(n)`: `Number(n)/1e18` | ❌ n > 9007n×1e18 丢精度（9007 yrCORE 即溢出） | `utils.ts:43` |
| `fmtPoints(n)`: `Number(n)/1e18` | ❌ 同上 | `utils.ts:48` |
| `fmtUsdc(n)`: `Number(n)/1e6` | ⚠️ n > 9e9×1e6 溢出（$90亿以上，实际低风险） | `utils.ts:38` |
| `fmtPps(n)`: `Number(n)/1e6` | ✅ PPS ≈ 1，安全 | `utils.ts:54` |
| `StrategySection tvlPct` | ⚠️ `Number(managed)/Number(total)` | `StrategySection.tsx:46` |
| `YieldSection currentNav` | ❌ `Number(pps)/1e6` 用于算术 | `YieldSection.tsx:14` |
| `YieldSection currentValueNum` | ❌ `Number(currentVal)/1e6` 用于算术 | `YieldSection.tsx:197` |
| `RwtRulesSection issuedPct` | ⚠️ `Number(issued)/Number(supply)` | `RwtRulesSection.tsx:32` |
| `viem formatUnits` 已引入 | ✅ 在 `utils.ts:1` 已 import | `utils.ts:1` |

### 3.8 风险提示

| 项目 | 状态 | 文件位置 |
|---|---|---|
| 首次访问确认弹窗 | ✅ 有（invite-only / early-stage） | `App.tsx:89` |
| 顶部 banner | ⚠️ "STEP 4 · INVITED USER ACCESS"，未使用 "Closed Beta" | `App.tsx:158` |
| "unaudited" / "audit pending" | ❌ 全站不存在此字样 | — |
| "strategy yield variable, not guaranteed" | ⚠️ `LimitationsPanel.tsx:14` 有"not guaranteed"，但不在核心操作路径 | `LimitationsPanel.tsx:14` |
| Deposit 页风险 banner | ❌ 缺失 | `DepositRedeem.tsx` |
| Lock 页风险 banner | ❌ 缺失 | `Lock.tsx` |
| Portfolio / Dashboard 风险 banner | ❌ 缺失 | `Dashboard.tsx` |
| Closed Beta 用户说明模块 | ❌ 缺失 | — |

### 3.9 Beneficiary / Governance / Exit Mode

| 项目 | 状态 | 文件位置 |
|---|---|---|
| Beneficiary 页面 | ✅ 有，地址已用 `BeneficiaryModuleV02` | `pages/Beneficiary.tsx` |
| Governance 页面 | ✅ 有，地址已用 `GovernanceSignalV02` | `pages/Governance.tsx` |
| Exit Mode / claimExitAssets | ✅ VaultSection 有完整流程 | `VaultSection.tsx:255–333` |
| Emergency Exit mode 展示 | ✅ 全局 banner + VaultSection 说明 | `App.tsx:70`, `VaultSection.tsx:153` |

---

## 四、FRONTEND_BLOCKERS（无法前端自行解决）

| 阻断项 | 原因 | 可用数据 |
|---|---|---|
| Safe / Multisig 地址 | 文档明确 no multisig yet，地址不存在 | 无，需先建立 Safe |
| AaveV3Strategy ABI | 合约源码存在但 ABI 未整理 | `contracts/` 有源码可提取 |
| Treasury ABI（读写） | `abis.ts` 无 TreasuryV02 ABI | `contracts/TreasuryV02.sol` 有源码 |
| Admin 操作需要 Timelock | `invest`/`divest` 需通过 Timelock 调度，前端直接调用可能因权限失败 | 需确认 Timelock delay 和操作流程 |

---

## 五、优先级排序（可立即执行项）

| 优先级 | 改动项 | 影响范围 |
|---|---|---|
| P0 | `utils.ts` `fmtShares`/`fmtPoints` 改用 `formatUnits` | 精度正确性，>9007 yrCORE 即出错 |
| P0 | `VaultSection.tsx` 移除 "Mint MockUSDC" 区块（主网调用必然失败） | 用户体验 |
| P0 | `VaultSection.tsx` / `StrategySection.tsx` 删除 "Base Sepolia" / "Testnet" / "Demo" 文案 | 主网准确性 |
| P1 | `addresses.ts` 补入 `StrategyManagerV01` / `AaveV3StrategyV01` / Timelock / Guardian | Admin 功能前提 |
| P1 | `FundVault_ABI` 补 `totalSupply`，补 `addToAllowlist`/`removeFromAllowlist` | Portfolio 读数 + Admin allowlist 操作 |
| P1 | `StrategyManager_ABI` 补 `invest`/`divest`/`returnToVault` | Admin 操作 |
| P1 | `fee discount` → `Rebate` 替换（6 处） | 命名规范 |
| P1 | Banner "STEP 4" → "Closed Beta" | 品牌/合规 |
| P1 | 核心页面加 "unaudited" 风险提示 | 信息披露 |
| P2 | `convertToAssets(sharesBal)` 加入 Portfolio 资产价值展示 | 用户读数规范 |
| P2 | Admin 补 Strategy / Treasury / Role / Allowlist 面板 | Admin 完整性 |
| P2 | Admin 高风险按钮加二次确认 | 安全 |
| P3 | Treasury ABI + TreasuryV02 状态展示 | Admin 完整性 |
| P3 | `FRONTEND_BLOCKERS.md` 记录 Safe 地址缺失 | 文档 |

---

*报告仅基于当前本地仓库文件状态生成，无代码修改。*
