# Step3 规划说明

生成时间：2026-04-04
最后更新：2026-04-05（同步 Phase A/B 执行结果）
状态：Step3 Phase B 执行中

---

## Step3 启动前必须完成的项

| 事项 | 说明 | 状态 |
|---|---|---|
| allowlist 地址录入 | 将首批受邀用户地址添加到 Vault allowlist | ✅ 已完成（5 地址，2026-04-05） |
| 运营钱包确认 | 确认 ADMIN / GUARDIAN 钱包有足够 ETH | ✅ 已确认 |
| investCap 设置 | StrategyManager investCap = 20,000 USDC | ✅ 已完成，tx block 44271104 |
| Step3 执行脚本准备 | deposit/invest/divest/withdraw gasLimit 已固化 | ✅ 已完成 |
| RPC 正式节点确认 | QuickNode Base Mainnet | ✅ 已切换 |
| 限额控制落地 | 三类限额：per-user 2000 / daily 5000 / TVL 20000 USDC | 🔄 Phase B 执行中 |
| 监控与运维文档 | LIVE_RUN 系列文档 | 🔄 Phase D 待执行 |

---

## Step3 启动后再做的低优先级项

以下事项不阻塞 Step3 启动，可在运营过程中逐步补齐：

| 事项 | 优先级 | 说明 |
|---|---|---|
| TVL 展示完善 | 低 | 主网 totalAssets 已可读，后续可接入历史曲线 |
| 长期收益统计 | 低 | 当前每次手动读取 aToken 余额，可后置自动化脚本 |
| 前端交互模块 | 低 | `mainnet.html` 当前只读，Step3 稳定后再接入 deposit/redeem UI |
| WebSocket 实时更新 | 低 | `BASE_MAINNET_WSS_URL` 已备用，当前 60s 轮询足够 |
| 多资产支持 | 后置 | 不在 Step3 范围内 |
| 多策略支持 | 后置 | 不在 Step3 范围内 |
| 自动化运维编排 | 后置 | 当前原则：先停、再查、手动撤回 |

---

## 当前不建议扩展的事项

- **不建议** 开放公共 deposit（allowlist 制度尚未完善时）
- **不建议** 同时引入第二策略（单策略闭环仍需更多数据积累）
- **不建议** 接入 RWA（合规评估未完成）
- **不建议** 修改 V01 核心合约（Step2 已完成主网验证，修改需重新走 Step1 流程）

---

## Step3 目标定义（参考）

Step3 = 白名单 / 限额正式试运营，目标包括：

1. 首批受邀用户真实入金（≤ 5 个地址，单用户上限 TBD）
2. 资金进入 Aave V3，产生可观测收益
3. 用户可自主 redeem（或由 ADMIN 辅助）
4. 收益数据记录完整，具备外部可读性
5. 无重大安全事件

---

## 关键合约地址（Step3 使用）

| 合约 | 地址 |
|---|---|
| FundVaultV01 | `0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54` |
| StrategyManagerV01 | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` |
| AaveV3StrategyV01 | `0x621CC4189946128eF2d584F69bb994C84FcA612D` |

来源：`deployments/base.json`（权威来源）
