# Contract Addresses

> Addresses are written to `deployments/{network}.json` after each deployment run.
> Run `scripts/update_frontend_config.ts` to sync them into the frontend.

---

## Base Mainnet

**Chain ID:** 8453
**Deployed:** 2026-04-03 (V01) / 2026-04-06 (V02) / 2026-04-07 (remaining)
**Deployer / Admin:** `0x087ea7F67d9282f0bdC43627b855F79789C6824C`
**Guardian:** `0xC8052cF447d429f63E890385a6924464B85c5834`
**Treasury:** `0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705`

| Contract | Address | Version |
|---|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Circle |
| FundVaultV01 | `0x8acaec738F9559F8b025c4372d827D3CD3928322` | V01 |
| StrategyManagerV01 | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` | V01 |
| AaveV3StrategyV01 | `0x621CC4189946128eF2d584F69bb994C84FcA612D` | V01 |
| RewardToken | `0xeAb54e7cFbE5d35ea5203854B44C8516201534A9` | — |
| LockLedgerV02 | `0x2D95517Cc375ab2dc6433fd44A8706462A418a89` | V02 |
| LockBenefitV02 | `0x083C50F9996b8E1389eB4506e24A2A22Df2C6e1c` | V02 |
| LockRewardManagerV02 | `0xb29DeFCF75f71bc4DaFaA353cE294C284F5e07cB` | V02 |
| BeneficiaryModuleV02 | `0x0dA3955C58D3252012A76D5CC01E9cc4dfF05C00` | V02 |
| UserStateEngineV02 | `0x083A92c65A7f586Bc7B8D3D24EE831C217298e18` | V02 |
| MetricsLayerV02 | `0x1C4Ba691688db06a63AfCde29FF377394BF530F1` | V02 |
| GovernanceSignalV02 | `0x9BE5636943d7BfF57ACA6047Cf945FD770CcC7d0` | V02 |
| ProtocolTimelockV02 | `0x054Cb2c32D6062B291420584dE2e5952C372cDD6` | V02 |
| ClaimLedger | `0x5CF9b8EC75314115EDDE5Dd332C193995Dd55234` | V02 |

---

## Post-Deployment Deferred Actions

Actions intentionally deferred until a later milestone. Do not perform these during initial deployment.

| Action | Contract | Trigger | Detail |
|---|---|---|---|
| Revoke deployer `TIMELOCK_ADMIN_ROLE` | ProtocolTimelockV02 | After governance migration is complete | Leaves the timelock self-governed; deployer can no longer modify roles |
| Grant `VAULT_ROLE` to FundVaultV01 | ClaimLedger | When Exit mode is activated | Allows the Vault to issue and settle claim records on behalf of users |

---

## Base Sepolia (Testnet)

**Chain ID:** 84532
**Status:** Deployed 2026-03-29
**Deployer / Admin / Treasury:** `0x087ea7F67d9282f0bdC43627b855F79789C6824C`

| Contract | Address | Version |
|---|---|---|
| MockUSDC | `0x11916C1381A357cBFe5Fd4be1a31DF20802DaDed` | — |
| FundVaultV01 | `0x8056c46697c2A97c475ABe289AB624825c2578D2` | V01 |
| StrategyManagerV01 | `0x8acaec738F9559F8b025c4372d827D3CD3928322` | V01 |
| DummyStrategy | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` | demo |
| RewardToken | `0xfdC84de8d1A7aA04d443c4923ee9570330a6e74F` | — |
| LockLedgerV02 | `0xf628104fCF5d4cFb1a85946db821282c6735c4FE` | V02 |
| LockBenefitV02 | `0x98C7eD0fF390700f7416d0C4eD8f5d303EddF7eA` | V02 |
| LockRewardManagerV02 | `0xf569A20A1d586F8c9883B9533A8E2e793FB1Ae5F` | V02 |
| BeneficiaryModuleV02 | `0xA67F8Fb2147C937EEbDf0128d1B2B1B87F77bb86` | V02 |
| UserStateEngineV02 | `0x6176e902ef51540b01620f28057d7f6aa5BBeA90` | V02 |
| MetricsLayerV02 | `0xAe0f6473A31B9E0A40E6F74BEEf9F9E44CaD6B25` | V02 |

---

## Localhost (Hardhat node — last local run)

**Chain ID:** 31337
**Deployed:** 2026-03-28T15:19:02Z
**Deployer:** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Hardhat account #0)

| Contract | Address | Version |
|---|---|---|
| MockUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | — |
| FundVaultV01 | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | V01 |
| StrategyManagerV01 | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | V01 |
| DummyStrategy | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | demo |
| RewardToken | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` | — |
| LockLedgerV02 | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` | V02 |
| LockBenefitV02 | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` | V02 |
| LockRewardManagerV02 | `0x9A676e781A523b5d0C0e43731313A708CB607508` | V02 |
| BeneficiaryModuleV02 | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` | V02 |
| UserStateEngineV02 | `0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1` | V02 |
| MetricsLayerV02 | `0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE` | V02 |

> Localhost addresses reset on every `npx hardhat node` restart.

---

## Seeded Demo Wallets (Base Sepolia)

| Persona | Address | lockId | Scenario |
|---|---|---|---|
| Alice | `0xa7C381eA23E12B83500A5D3eEE850068740B0339` | 0 | Scene B — Gold 180d lock, 6480 RWT issued |
| Bob | `0x9d84145F057C2fd532250891E9b02BDe0C92CcB4` | — | Scene A/C — free 200 fbUSDC, Carol's beneficiary |
| Carol | `0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B` | 1 | Scene C — Silver 90d lock, isInactive=true |

Seeded 2026-03-29. Alice unlockAt: 2026-09-25. Carol unlockAt: 2026-06-27.

---

## Seeded Demo Wallets (Localhost)

| Persona | Address | Scenario |
|---|---|---|
| Alice | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | Scene B — Gold 180d lock |
| Bob | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | Scene A/C — free holder, Carol's beneficiary |
| Carol | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | Scene C — Silver 90d lock, inactive |

These are standard Hardhat accounts (#1, #2, #3). Do not use them on mainnet.

---

## Contracts Outside Demo Scope

Not used in the current frontend demo:

| Contract | Address (localhost) | Note |
|---|---|---|
| LockPointsV02 | `0x68B1D87F95878fE05B998F19b66F4baba5De1aed` | not demo-facing |
| GovernanceSignalV02 | `0x3Aa5ebB10DC797CAC828524e59A333d0A371443c` | not demo-facing |
