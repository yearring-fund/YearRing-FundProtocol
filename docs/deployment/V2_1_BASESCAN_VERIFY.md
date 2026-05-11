# V2.1 Basescan Verification

**Network:** Base Mainnet  
**Date:** 2026-05-12  
**Status:** VERIFIED via Sourcify (11/11)

> Run from project root. Requires `BASESCAN_API_KEY` in `.env`.

---

## Contracts & Commands

### 1. PointsLedgerV01
- **Address:** `0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe`
- **Constructor args:** `admin`
```bash
npx hardhat verify --network base \
  0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 2. YearRingCoreVaultV21
- **Address:** `0x53e45AcB32aCD80F3d215a007fD8FE87390746F8`
- **Constructor args:** `usdc, admin, name, symbol`
```bash
npx hardhat verify --network base \
  0x53e45AcB32aCD80F3d215a007fD8FE87390746F8 \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C" \
  "YearRing USDC" \
  "yrUSDC"
```

---

### 3. CoreStrategyManagerV21
- **Address:** `0xc615c0c37524e9997622337cC973aC24C40e0548`
- **Constructor args:** `usdc, vault, admin`
```bash
npx hardhat verify --network base \
  0xc615c0c37524e9997622337cC973aC24C40e0548 \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 4. TreasuryV21
- **Address:** `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2`
- **Constructor args:** `vault, usdc, csm, admin`
```bash
npx hardhat verify --network base \
  0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2 \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0xc615c0c37524e9997622337cC973aC24C40e0548" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 5. AccessStrategyManagerV21
- **Address:** `0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0`
- **Constructor args:** `usdc, vault, lockManager(ZeroAddress at deploy), feeBps, admin`
```bash
npx hardhat verify --network base \
  0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0 \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0x0000000000000000000000000000000000000000" \
  100 \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 6. LockManagerV21
- **Address:** `0xCDc679865b5161C7b7cf75584551F5B57828d59F`
- **Constructor args:** `yrUSDC(vault), coreVault(vault), pointsLedger, admin`
```bash
npx hardhat verify --network base \
  0xCDc679865b5161C7b7cf75584551F5B57828d59F \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 7. RebateManagerV21
- **Address:** `0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD`
- **Constructor args:** `vault, lockManager, treasury, admin`
```bash
npx hardhat verify --network base \
  0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0xCDc679865b5161C7b7cf75584551F5B57828d59F" \
  "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 8. EligibilityModuleV21
- **Address:** `0x7ee0ED49A008e6feA8d196492699a87f878a2022`
- **Constructor args:** `lockManager, pointsLedger, admin`
```bash
npx hardhat verify --network base \
  0x7ee0ED49A008e6feA8d196492699a87f878a2022 \
  "0xCDc679865b5161C7b7cf75584551F5B57828d59F" \
  "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" \
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
```

---

### 9. PortfolioLensV21
- **Address:** `0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a`
- **Constructor args:** `vault, lockManager, eligibilityModule, pointsLedger, treasury`
```bash
npx hardhat verify --network base \
  0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a \
  "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" \
  "0xCDc679865b5161C7b7cf75584551F5B57828d59F" \
  "0x7ee0ED49A008e6feA8d196492699a87f878a2022" \
  "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" \
  "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2"
```

---

### 10. AaveUSDCStrategyV21 (CoreSM)
- **Address:** `0x58F265139E3693651B4E30961a1e535b413BBa2C`
- **Constructor args:** `usdc, manager(csm), aavePool, aaveAUsdc, referralCode`
```bash
npx hardhat verify --network base \
  0x58F265139E3693651B4E30961a1e535b413BBa2C \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0xc615c0c37524e9997622337cC973aC24C40e0548" \
  "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" \
  "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" \
  0
```

---

### 11. AaveUSDCStrategyV21 (ASM)
- **Address:** `0xc61D5966F2802aff6c6377C21bBdE923Daf879e0`
- **Constructor args:** `usdc, manager(asm), aavePool, aaveAUsdc, referralCode`
```bash
npx hardhat verify --network base \
  0xc61D5966F2802aff6c6377C21bBdE923Daf879e0 \
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  "0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0" \
  "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" \
  "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" \
  0
```

---

## Batch Verify Script

Run all at once (stops on first failure — rerun remaining):

```bash
# Run from project root
set -e

npx hardhat verify --network base 0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0x53e45AcB32aCD80F3d215a007fD8FE87390746F8 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0x087ea7F67d9282f0bdC43627b855F79789C6824C" "YearRing USDC" "yrUSDC"
npx hardhat verify --network base 0xc615c0c37524e9997622337cC973aC24C40e0548 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2 "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0xc615c0c37524e9997622337cC973aC24C40e0548" "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0x0000000000000000000000000000000000000000" 100 "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0xCDc679865b5161C7b7cf75584551F5B57828d59F "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0xCDc679865b5161C7b7cf75584551F5B57828d59F" "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2" "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0x7ee0ED49A008e6feA8d196492699a87f878a2022 "0xCDc679865b5161C7b7cf75584551F5B57828d59F" "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
npx hardhat verify --network base 0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" "0xCDc679865b5161C7b7cf75584551F5B57828d59F" "0x7ee0ED49A008e6feA8d196492699a87f878a2022" "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2"
npx hardhat verify --network base 0x58F265139E3693651B4E30961a1e535b413BBa2C "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0xc615c0c37524e9997622337cC973aC24C40e0548" "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" 0
npx hardhat verify --network base 0xc61D5966F2802aff6c6377C21bBdE923Daf879e0 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" "0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0" "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" 0
```

---

## Verification Status

| Contract | Verified | Notes |
|----------|----------|-------|
| PointsLedgerV01 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe/ |
| YearRingCoreVaultV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x53e45AcB32aCD80F3d215a007fD8FE87390746F8/ |
| CoreStrategyManagerV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0xc615c0c37524e9997622337cC973aC24C40e0548/ |
| TreasuryV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2/ |
| AccessStrategyManagerV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0/ |
| LockManagerV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0xCDc679865b5161C7b7cf75584551F5B57828d59F/ |
| RebateManagerV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD/ |
| EligibilityModuleV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x7ee0ED49A008e6feA8d196492699a87f878a2022/ |
| PortfolioLensV21 | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a/ |
| AaveUSDCStrategyV21 (CoreSM) | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0x58F265139E3693651B4E30961a1e535b413BBa2C/ |
| AaveUSDCStrategyV21 (ASM) | ✅ Sourcify | https://repo.sourcify.dev/contracts/full_match/8453/0xc61D5966F2802aff6c6377C21bBdE923Daf879e0/ |

> **Note:** Etherscan/Basescan V2 API (`api.etherscan.io`) is unreachable from current network environment.
> Sourcify full_match verification is equivalent — Basescan displays Sourcify-verified contracts as verified.
> If Basescan native verification is needed later, run from a network without GFW restrictions.
