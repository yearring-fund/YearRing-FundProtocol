import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { MerkleRewardsDistributorV01, RewardToken, FundVaultV01, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildTree(entries: { account: string; amount: bigint }[]) {
  const leaves = entries.map(({ account, amount }) =>
    keccak256(ethers.solidityPacked(["address", "uint256"], [account, amount]))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex");
  return { tree, root, leaves };
}

function proof(tree: MerkleTree, account: string, amount: bigint): string[] {
  return tree.getHexProof(
    keccak256(ethers.solidityPacked(["address", "uint256"], [account, amount]))
  );
}

// ---------------------------------------------------------------------------
describe("MerkleRewardsDistributorV01", function () {
  let distributor: MerkleRewardsDistributorV01;
  let rewardToken: RewardToken;
  let vault: FundVaultV01;
  let usdc: MockUSDC;

  let admin: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const E18 = (n: number) => ethers.parseEther(String(n));
  const EPOCH_CAP = E18(10_000);
  const MAX_EPOCH_CAP = E18(100_000);
  const PREMINT = E18(1_000_000);

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "Fund Vault", "fvUSDC",
      treasury.address, guardian.address, admin.address
    );
    rewardToken = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWD", PREMINT, treasury.address
    );
    distributor = await (await ethers.getContractFactory("MerkleRewardsDistributorV01")).deploy(
      await rewardToken.getAddress(),
      await vault.getAddress(),
      EPOCH_CAP,
      MAX_EPOCH_CAP,
      admin.address,
      guardian.address
    );

    // Fund distributor
    await rewardToken.connect(treasury).transfer(await distributor.getAddress(), PREMINT);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------
  describe("Deployment", function () {
    it("rewardToken set correctly", async function () {
      expect(await distributor.rewardToken()).to.equal(await rewardToken.getAddress());
    });
    it("epochCap set correctly", async function () {
      expect(await distributor.epochCap()).to.equal(EPOCH_CAP);
    });
    it("maxEpochCap immutable", async function () {
      expect(await distributor.maxEpochCap()).to.equal(MAX_EPOCH_CAP);
    });
    it("totalUnclaimed starts at 0", async function () {
      expect(await distributor.totalUnclaimed()).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // setEpoch
  // ---------------------------------------------------------------------------
  describe("setEpoch", function () {
    it("sets epoch and increments totalUnclaimed", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await distributor.connect(admin).setEpoch(1, root, E18(100));
      const epoch = await distributor.epochs(1);
      expect(epoch.exists).to.equal(true);
      expect(epoch.epochTotal).to.equal(E18(100));
      expect(await distributor.totalUnclaimed()).to.equal(E18(100));
    });
    it("root = bytes32(0) reverts InvalidRoot", async function () {
      await expect(
        distributor.connect(admin).setEpoch(1, ethers.ZeroHash, E18(100))
      ).to.be.revertedWithCustomError(distributor, "InvalidRoot");
    });
    it("epochTotal = 0 reverts InvalidEpochTotal", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await expect(
        distributor.connect(admin).setEpoch(1, root, 0)
      ).to.be.revertedWithCustomError(distributor, "InvalidEpochTotal");
    });
    it("epochTotal > epochCap reverts EpochTotalExceedsCap", async function () {
      const { root } = buildTree([{ account: alice.address, amount: EPOCH_CAP + 1n }]);
      await expect(
        distributor.connect(admin).setEpoch(1, root, EPOCH_CAP + 1n)
      ).to.be.revertedWithCustomError(distributor, "EpochTotalExceedsCap");
    });
    it("duplicate epochId reverts EpochAlreadyExists", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await distributor.connect(admin).setEpoch(1, root, E18(100));
      await expect(
        distributor.connect(admin).setEpoch(1, root, E18(100))
      ).to.be.revertedWithCustomError(distributor, "EpochAlreadyExists");
    });
    it("insufficient balance reverts InsufficientRewardBalance", async function () {
      // Deploy a fresh distributor and fund it exactly EPOCH_CAP from the main distributor
      const smallDist = await (await ethers.getContractFactory("MerkleRewardsDistributorV01")).deploy(
        await rewardToken.getAddress(), await vault.getAddress(),
        EPOCH_CAP, MAX_EPOCH_CAP, admin.address, guardian.address
      );
      // Transfer EPOCH_CAP tokens from main distributor (surplus = full balance since no epochs set)
      await distributor.connect(admin).rescueTokens(await smallDist.getAddress(), EPOCH_CAP);

      const { root } = buildTree([{ account: alice.address, amount: EPOCH_CAP }]);
      await smallDist.connect(admin).setEpoch(1, root, EPOCH_CAP);

      const { root: root2 } = buildTree([{ account: bob.address, amount: E18(1) }]);
      await expect(
        smallDist.connect(admin).setEpoch(2, root2, E18(1))
      ).to.be.revertedWithCustomError(smallDist, "InsufficientRewardBalance");
    });
    it("non-ADMIN cannot setEpoch", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await expect(
        distributor.connect(alice).setEpoch(1, root, E18(100))
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // claim
  // ---------------------------------------------------------------------------
  describe("claim", function () {
    const aliceAmt = E18(300);
    const bobAmt = E18(700);
    const epochTotal = aliceAmt + bobAmt;
    let tree: MerkleTree;
    let root: string;

    beforeEach(async function () {
      ({ tree, root } = buildTree([
        { account: alice.address, amount: aliceAmt },
        { account: bob.address, amount: bobAmt },
      ]));
      await distributor.connect(admin).setEpoch(1, root, epochTotal);
    });

    it("alice claims full amount", async function () {
      const before = await rewardToken.balanceOf(alice.address);
      await distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt));
      expect(await rewardToken.balanceOf(alice.address)).to.equal(before + aliceAmt);
    });
    it("totalUnclaimed decreases after claim", async function () {
      await distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt));
      expect(await distributor.totalUnclaimed()).to.equal(epochTotal - aliceAmt);
    });
    it("incremental claim: second claim on same epoch reverts NothingToClaim", async function () {
      // Once the full leaf amount is claimed, a second call reverts
      await distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt));
      await expect(
        distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWithCustomError(distributor, "NothingToClaim");
    });
    it("cross-epoch cumulative: epoch 2 leaf covers epoch 1 amount, delta is sent", async function () {
      // Epoch 2 tree encodes alice's cumulative entitlement (aliceAmt already in epoch 1)
      const cumulative = aliceAmt + E18(100);
      const { tree: t2, root: r2 } = buildTree([
        { account: alice.address, amount: cumulative },
        { account: bob.address, amount: bobAmt },
      ]);
      await distributor.connect(admin).setEpoch(2, r2, cumulative + bobAmt);

      // Alice claims full cumulative from epoch 2 (claimed[2][alice] starts at 0)
      const before = await rewardToken.balanceOf(alice.address);
      await distributor.claim(2, alice.address, cumulative, proof(t2, alice.address, cumulative));
      expect(await rewardToken.balanceOf(alice.address)).to.equal(before + cumulative);
    });
    it("already fully claimed reverts NothingToClaim", async function () {
      await distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt));
      await expect(
        distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWithCustomError(distributor, "NothingToClaim");
    });
    it("invalid proof reverts InvalidMerkleProof", async function () {
      await expect(
        distributor.claim(1, bob.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWithCustomError(distributor, "InvalidMerkleProof");
    });
    it("non-existent epoch reverts EpochDoesNotExist", async function () {
      await expect(
        distributor.claim(999, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWithCustomError(distributor, "EpochDoesNotExist");
    });
    it("expired epoch reverts EpochExpiredCannotClaim", async function () {
      await distributor.connect(admin).expireEpoch(1);
      await expect(
        distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWithCustomError(distributor, "EpochExpiredCannotClaim");
    });
    it("paused reverts", async function () {
      await distributor.connect(guardian).pause();
      await expect(
        distributor.claim(1, alice.address, aliceAmt, proof(tree, alice.address, aliceAmt))
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  // ---------------------------------------------------------------------------
  // expireEpoch
  // ---------------------------------------------------------------------------
  describe("expireEpoch", function () {
    beforeEach(async function () {
      const { root } = buildTree([
        { account: alice.address, amount: E18(300) },
        { account: bob.address, amount: E18(700) },
      ]);
      await distributor.connect(admin).setEpoch(1, root, E18(1000));
    });

    it("releases unclaimed from totalUnclaimed", async function () {
      // alice claims 300
      const { tree } = buildTree([
        { account: alice.address, amount: E18(300) },
        { account: bob.address, amount: E18(700) },
      ]);
      await distributor.claim(1, alice.address, E18(300), proof(tree, alice.address, E18(300)));
      const before = await distributor.totalUnclaimed();
      await distributor.connect(admin).expireEpoch(1);
      // released = epochTotal(1000) - claimedTotal(300) = 700
      expect(await distributor.totalUnclaimed()).to.equal(before - E18(700));
    });
    it("already expired reverts EpochAlreadyExpired", async function () {
      await distributor.connect(admin).expireEpoch(1);
      await expect(
        distributor.connect(admin).expireEpoch(1)
      ).to.be.revertedWithCustomError(distributor, "EpochAlreadyExpired");
    });
    it("non-existent epoch reverts EpochDoesNotExist", async function () {
      await expect(
        distributor.connect(admin).expireEpoch(999)
      ).to.be.revertedWithCustomError(distributor, "EpochDoesNotExist");
    });
    it("non-ADMIN cannot expireEpoch", async function () {
      await expect(distributor.connect(alice).expireEpoch(1)).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // rescueTokens
  // ---------------------------------------------------------------------------
  describe("rescueTokens", function () {
    // Use a tightly-funded distributor so surplus is predictable
    let tinyDist: MerkleRewardsDistributorV01;
    const TINY = E18(100);

    beforeEach(async function () {
      tinyDist = await (await ethers.getContractFactory("MerkleRewardsDistributorV01")).deploy(
        await rewardToken.getAddress(), await vault.getAddress(),
        EPOCH_CAP, MAX_EPOCH_CAP, admin.address, guardian.address
      );
      // Fund tinyDist from main distributor surplus (no epochs set yet, all balance is surplus)
      await distributor.connect(admin).rescueTokens(await tinyDist.getAddress(), TINY);
    });

    it("rescues surplus tokens after epoch expiry", async function () {
      const { root } = buildTree([{ account: alice.address, amount: TINY }]);
      await tinyDist.connect(admin).setEpoch(1, root, TINY);
      await tinyDist.connect(admin).expireEpoch(1); // releases TINY to surplus

      const before = await rewardToken.balanceOf(alice.address);
      await tinyDist.connect(admin).rescueTokens(alice.address, TINY);
      expect(await rewardToken.balanceOf(alice.address)).to.equal(before + TINY);
    });
    it("caps transfer at surplus if amount > surplus", async function () {
      const { root } = buildTree([{ account: alice.address, amount: TINY }]);
      await tinyDist.connect(admin).setEpoch(1, root, TINY);
      await tinyDist.connect(admin).expireEpoch(1); // surplus = TINY

      const before = await rewardToken.balanceOf(alice.address);
      await tinyDist.connect(admin).rescueTokens(alice.address, TINY * 999n); // >> surplus
      expect(await rewardToken.balanceOf(alice.address)).to.equal(before + TINY);
    });
    it("to = address(0) reverts ZeroAddress", async function () {
      const { root } = buildTree([{ account: alice.address, amount: TINY }]);
      await tinyDist.connect(admin).setEpoch(1, root, TINY);
      await tinyDist.connect(admin).expireEpoch(1);
      await expect(
        tinyDist.connect(admin).rescueTokens(ethers.ZeroAddress, TINY)
      ).to.be.revertedWithCustomError(tinyDist, "ZeroAddress");
    });
    it("no surplus reverts NothingToRescue", async function () {
      const { root } = buildTree([{ account: alice.address, amount: TINY }]);
      await tinyDist.connect(admin).setEpoch(1, root, TINY);
      // totalUnclaimed = balance → surplus = 0
      await expect(
        tinyDist.connect(admin).rescueTokens(alice.address, E18(1))
      ).to.be.revertedWithCustomError(tinyDist, "NothingToRescue");
    });
    it("non-ADMIN cannot rescueTokens", async function () {
      await expect(
        distributor.connect(alice).rescueTokens(alice.address, E18(1))
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // claimable view
  // ---------------------------------------------------------------------------
  describe("claimable", function () {
    it("returns correct amount before claim", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await distributor.connect(admin).setEpoch(1, root, E18(100));
      expect(await distributor.claimable(1, alice.address, E18(100))).to.equal(E18(100));
    });
    it("returns 0 after full claim", async function () {
      const { tree, root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await distributor.connect(admin).setEpoch(1, root, E18(100));
      await distributor.claim(1, alice.address, E18(100), proof(tree, alice.address, E18(100)));
      expect(await distributor.claimable(1, alice.address, E18(100))).to.equal(0);
    });
    it("returns 0 for non-existent epoch", async function () {
      expect(await distributor.claimable(999, alice.address, E18(100))).to.equal(0);
    });
    it("returns 0 for expired epoch", async function () {
      const { root } = buildTree([{ account: alice.address, amount: E18(100) }]);
      await distributor.connect(admin).setEpoch(1, root, E18(100));
      await distributor.connect(admin).expireEpoch(1);
      expect(await distributor.claimable(1, alice.address, E18(100))).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------
  describe("pause controls", function () {
    it("GUARDIAN can pause", async function () {
      await distributor.connect(guardian).pause();
      expect(await distributor.paused()).to.equal(true);
    });
    it("ADMIN can unpause", async function () {
      await distributor.connect(guardian).pause();
      await distributor.connect(admin).unpause();
      expect(await distributor.paused()).to.equal(false);
    });
    it("GUARDIAN cannot unpause", async function () {
      await distributor.connect(guardian).pause();
      await expect(distributor.connect(guardian).unpause()).to.be.reverted;
    });
    it("non-GUARDIAN cannot pause", async function () {
      await expect(distributor.connect(alice).pause()).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // setEpochCap
  // ---------------------------------------------------------------------------
  describe("setEpochCap", function () {
    it("ADMIN can reduce cap", async function () {
      await distributor.connect(admin).setEpochCap(E18(5000));
      expect(await distributor.epochCap()).to.equal(E18(5000));
    });
    it("cap > maxEpochCap reverts EpochCapExceedsMax", async function () {
      await expect(
        distributor.connect(admin).setEpochCap(MAX_EPOCH_CAP + 1n)
      ).to.be.revertedWithCustomError(distributor, "EpochCapExceedsMax");
    });
    it("non-ADMIN cannot setEpochCap", async function () {
      await expect(distributor.connect(alice).setEpochCap(E18(1))).to.be.reverted;
    });
  });
});
