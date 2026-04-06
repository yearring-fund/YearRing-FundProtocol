import { expect } from "chai";
import { ethers } from "hardhat";
import {
  GovernanceSignalV02, RewardToken,
  FundVaultV01, LockLedgerV02, MockUSDC,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * GovernanceSignal.test.ts — Signal-only governance tests
 *
 * Groups:
 *   1. createProposal  — admin-only, empty title, event
 *   2. castVote        — threshold gate, one-vote-per-address, three types, weight
 *   3. stateOf         — Active / Succeeded / Defeated transitions
 *   4. resultOf        — vote totals and passed flag
 *   5. No protocol mutation — vault / ledger accounting unaffected
 */
describe("GovernanceSignalV02", function () {
  let governance: GovernanceSignalV02;
  let rwToken:    RewardToken;
  let vault:      FundVaultV01;
  let ledger:     LockLedgerV02;
  let usdc:       MockUSDC;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;
  let carol:    SignerWithAddress;

  const D18           = (n: number) => ethers.parseUnits(String(n), 18);
  const D6            = (n: number) => ethers.parseUnits(String(n), 6);
  const VOTING_PERIOD = 7n * 86_400n;           // 7 days
  const THRESHOLD     = D18(10);                 // 10 RWT
  const ProposalType  = { RewardRateSignal: 0, FeeDiscountSignal: 1, InactivityThresholdSignal: 2, GeneralSignal: 3 };
  const VoteType      = { For: 0, Against: 1, Abstain: 2 };

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob, carol] = await ethers.getSigners();

    // Deploy RewardToken — treasury holds all supply
    rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWT", D18(1_000_000), treasury.address
    );

    // Deploy minimal vault + ledger stack for no-mutation tests
    usdc  = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
      treasury.address, admin.address
    );
    ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
      await vault.getAddress(), admin.address, guardian.address
    );

    // Seed alice and bob with RWT above threshold
    await rwToken.connect(treasury).transfer(alice.address, D18(100));  // 100 RWT
    await rwToken.connect(treasury).transfer(bob.address,   D18(50));   // 50 RWT
    // carol gets nothing — below threshold

    // Deploy governance
    governance = await (await ethers.getContractFactory("GovernanceSignalV02")).deploy(
      await rwToken.getAddress(),
      THRESHOLD,
      Number(VOTING_PERIOD),
      admin.address
    );
  });

  // ─── Group 1: createProposal ──────────────────────────────────────────────

  describe("Group 1 — createProposal (admin only)", function () {
    it("admin can create a proposal", async function () {
      await expect(
        governance.connect(admin).createProposal("Title", "Desc", ProposalType.GeneralSignal)
      ).to.not.be.reverted;
      expect(await governance.nextProposalId()).to.equal(1n);
    });

    it("non-admin cannot create a proposal", async function () {
      await expect(
        governance.connect(alice).createProposal("Title", "Desc", ProposalType.GeneralSignal)
      ).to.be.reverted;
    });

    it("empty title reverts with EmptyTitle", async function () {
      await expect(
        governance.connect(admin).createProposal("", "Desc", ProposalType.GeneralSignal)
      ).to.be.revertedWithCustomError(governance, "EmptyTitle");
    });

    it("emits ProposalCreated with correct fields", async function () {
      const tx = await governance.connect(admin).createProposal(
        "Fee Signal", "Lower fees", ProposalType.FeeDiscountSignal
      );
      await expect(tx)
        .to.emit(governance, "ProposalCreated")
        .withArgs(0n, admin.address, ProposalType.FeeDiscountSignal, "Fee Signal", (v: bigint) => v > 0n);
    });

    it("proposal data is stored correctly", async function () {
      await governance.connect(admin).createProposal("My Proposal", "Details", ProposalType.RewardRateSignal);
      const p = await governance.getProposal(0n);
      expect(p.proposer).to.equal(admin.address);
      expect(p.title).to.equal("My Proposal");
      expect(p.proposalType).to.equal(ProposalType.RewardRateSignal);
      expect(p.forVotes).to.equal(0n);
    });

    it("nextProposalId increments per proposal", async function () {
      await governance.connect(admin).createProposal("A", "a", ProposalType.GeneralSignal);
      await governance.connect(admin).createProposal("B", "b", ProposalType.GeneralSignal);
      expect(await governance.nextProposalId()).to.equal(2n);
    });

    it("getProposal reverts for non-existent id", async function () {
      await expect(governance.getProposal(99n))
        .to.be.revertedWithCustomError(governance, "ProposalNotFound");
    });
  });

  // ─── Group 2: castVote ────────────────────────────────────────────────────

  describe("Group 2 — castVote", function () {
    beforeEach(async function () {
      await governance.connect(admin).createProposal("Vote Test", "Desc", ProposalType.GeneralSignal);
    });

    it("voter with sufficient RWT can vote For", async function () {
      await expect(governance.connect(alice).castVote(0n, VoteType.For)).to.not.be.reverted;
    });

    it("voter below threshold is rejected with InsufficientVotingPower", async function () {
      await expect(governance.connect(carol).castVote(0n, VoteType.For))
        .to.be.revertedWithCustomError(governance, "InsufficientVotingPower");
    });

    it("double vote reverts with AlreadyVoted", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);
      await expect(governance.connect(alice).castVote(0n, VoteType.Against))
        .to.be.revertedWithCustomError(governance, "AlreadyVoted");
    });

    it("voting after period ends reverts with ProposalNotActive", async function () {
      await advance(VOTING_PERIOD + 1n);
      await expect(governance.connect(alice).castVote(0n, VoteType.For))
        .to.be.revertedWithCustomError(governance, "ProposalNotActive");
    });

    it("For vote accumulates to forVotes", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);
      const p = await governance.getProposal(0n);
      expect(p.forVotes).to.equal(D18(100));
      expect(p.againstVotes).to.equal(0n);
    });

    it("Against vote accumulates to againstVotes", async function () {
      await governance.connect(alice).castVote(0n, VoteType.Against);
      const p = await governance.getProposal(0n);
      expect(p.againstVotes).to.equal(D18(100));
    });

    it("Abstain vote accumulates to abstainVotes", async function () {
      await governance.connect(alice).castVote(0n, VoteType.Abstain);
      const p = await governance.getProposal(0n);
      expect(p.abstainVotes).to.equal(D18(100));
    });

    it("weight equals rewardToken balance at snapshot time (proposal creation)", async function () {
      // bob has 50 RWT at proposal creation → snapshot frozen there
      // transferring tokens after proposal creation must not change bob's vote weight
      const snapBalance = D18(50); // bob's balance at proposal creation
      await rwToken.connect(bob).transfer(carol.address, D18(50)); // bob sends all RWT away
      await expect(governance.connect(bob).castVote(0n, VoteType.For))
        .to.emit(governance, "VoteCast")
        .withArgs(0n, bob.address, VoteType.For, snapBalance);
    });

    it("multiple voters accumulate independently", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);   // 100 RWT
      await governance.connect(bob).castVote(0n, VoteType.Against); // 50 RWT
      const p = await governance.getProposal(0n);
      expect(p.forVotes).to.equal(D18(100));
      expect(p.againstVotes).to.equal(D18(50));
    });

    it("hasVoted is true after voting", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);
      expect(await governance.hasVoted(0n, alice.address)).to.be.true;
    });

    it("voting on non-existent proposal reverts with ProposalNotFound", async function () {
      await expect(governance.connect(alice).castVote(99n, VoteType.For))
        .to.be.revertedWithCustomError(governance, "ProposalNotFound");
    });

    it("voter at exactly votingThreshold can vote (boundary: power == threshold)", async function () {
      // carol starts with 0 RWT — give her exactly 10 RWT (= THRESHOLD)
      await rwToken.connect(treasury).transfer(carol.address, THRESHOLD);
      // create a new proposal so carol's balance is captured in the snapshot
      await governance.connect(admin).createProposal("Boundary Test", "Desc", ProposalType.GeneralSignal);
      const boundaryProposalId = (await governance.nextProposalId()) - 1n;
      await expect(governance.connect(carol).castVote(boundaryProposalId, VoteType.For)).to.not.be.reverted;
    });

    it("two proposals have independent snapshots — transfer between creations gives different weights", async function () {
      // Proposal 0 created in beforeEach: alice snapshot = 100 RWT
      // Now transfer alice's tokens to carol, then create proposal 1
      await rwToken.connect(alice).transfer(carol.address, D18(100));
      await governance.connect(admin).createProposal("Proposal 1", "Desc", ProposalType.GeneralSignal);

      // Proposal 0 snapshot: alice=100, carol=0
      expect(await governance.votingPowerAt(0n, alice.address)).to.equal(D18(100));
      expect(await governance.votingPowerAt(0n, carol.address)).to.equal(0n);

      // Proposal 1 snapshot: alice=0, carol=100
      expect(await governance.votingPowerAt(1n, alice.address)).to.equal(0n);
      expect(await governance.votingPowerAt(1n, carol.address)).to.equal(D18(100));
    });

    it("snapshot prevents double-counting: transferred tokens cannot vote again", async function () {
      // Proposal was created in beforeEach → snapshot already taken
      // At snapshot time: alice=100 RWT, bob=50 RWT, carol=0 RWT

      // alice votes For with her snapshot balance (100 RWT)
      await governance.connect(alice).castVote(0n, VoteType.For);

      // alice transfers all her RWT to carol AFTER the snapshot
      await rwToken.connect(alice).transfer(carol.address, D18(100));

      // carol now holds 100 RWT but her snapshot balance for this proposal is 0
      // → below votingThreshold → rejected
      await expect(governance.connect(carol).castVote(0n, VoteType.For))
        .to.be.revertedWithCustomError(governance, "InsufficientVotingPower");

      // forVotes must equal alice's snapshot balance only (100 RWT), not 200
      const p = await governance.getProposal(0n);
      expect(p.forVotes).to.equal(D18(100));
    });
  });

  // ─── Group 3: stateOf ────────────────────────────────────────────────────

  describe("Group 3 — stateOf state machine", function () {
    beforeEach(async function () {
      await governance.connect(admin).createProposal("State Test", "Desc", ProposalType.GeneralSignal);
    });

    it("returns Active during voting period", async function () {
      expect(await governance.stateOf(0n)).to.equal(0); // Active = 0
    });

    it("returns Succeeded after period when For > Against", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);   // 100 RWT
      await governance.connect(bob).castVote(0n, VoteType.Against); // 50 RWT
      await advance(VOTING_PERIOD + 1n);
      expect(await governance.stateOf(0n)).to.equal(1); // Succeeded = 1
    });

    it("returns Defeated after period when Against >= For", async function () {
      await governance.connect(alice).castVote(0n, VoteType.Against); // 100 RWT
      await governance.connect(bob).castVote(0n, VoteType.For);       // 50 RWT
      await advance(VOTING_PERIOD + 1n);
      expect(await governance.stateOf(0n)).to.equal(2); // Defeated = 2
    });

    it("returns Defeated after period with no votes", async function () {
      await advance(VOTING_PERIOD + 1n);
      expect(await governance.stateOf(0n)).to.equal(2); // Defeated (0 > 0 is false)
    });

    it("returns Defeated when only Abstain votes cast", async function () {
      await governance.connect(alice).castVote(0n, VoteType.Abstain);
      await advance(VOTING_PERIOD + 1n);
      expect(await governance.stateOf(0n)).to.equal(2); // Defeated
    });

    it("abstain votes do not block Succeeded — no quorum, passed = forVotes > againstVotes only", async function () {
      // alice (100 RWT) abstains, bob (50 RWT) votes For — For > Against (50 > 0) → Succeeded
      // abstainVotes (100 RWT) must not reduce the For side or trigger a quorum failure
      await governance.connect(alice).castVote(0n, VoteType.Abstain);
      await governance.connect(bob).castVote(0n, VoteType.For);
      await advance(VOTING_PERIOD + 1n);
      expect(await governance.stateOf(0n)).to.equal(1); // Succeeded
      const [f, a, ab, passed] = await governance.resultOf(0n);
      expect(f).to.equal(D18(50));
      expect(ab).to.equal(D18(100));
      expect(passed).to.be.true;
    });

    it("reverts for non-existent proposal", async function () {
      await expect(governance.stateOf(99n))
        .to.be.revertedWithCustomError(governance, "ProposalNotFound");
    });
  });

  // ─── Group 4: resultOf ───────────────────────────────────────────────────

  describe("Group 4 — resultOf", function () {
    beforeEach(async function () {
      await governance.connect(admin).createProposal("Result Test", "Desc", ProposalType.GeneralSignal);
    });

    it("returns correct totals and passed=true when For wins", async function () {
      await governance.connect(alice).castVote(0n, VoteType.For);   // 100
      await governance.connect(bob).castVote(0n, VoteType.Against); // 50
      const [f, a, ab, passed] = await governance.resultOf(0n);
      expect(f).to.equal(D18(100));
      expect(a).to.equal(D18(50));
      expect(ab).to.equal(0n);
      expect(passed).to.be.true;
    });

    it("returns passed=false when Against wins", async function () {
      await governance.connect(alice).castVote(0n, VoteType.Against);
      const [,,,passed] = await governance.resultOf(0n);
      expect(passed).to.be.false;
    });

    it("returns passed=false with no votes", async function () {
      const [f, a, ab, passed] = await governance.resultOf(0n);
      expect(f).to.equal(0n);
      expect(a).to.equal(0n);
      expect(ab).to.equal(0n);
      expect(passed).to.be.false;
    });

    it("reverts for non-existent proposal", async function () {
      await expect(governance.resultOf(99n))
        .to.be.revertedWithCustomError(governance, "ProposalNotFound");
    });
  });

  // ─── Group 5: No protocol mutation ───────────────────────────────────────
  //
  // GovernanceSignalV02 holds no protocol roles and calls no protocol functions.
  // Proposal creation and voting must not affect vault / ledger accounting.

  describe("Group 5 — no protocol mutation", function () {
    beforeEach(async function () {
      // Seed vault with a deposit so totalAssets / totalSupply are non-zero
      await usdc.mint(alice.address, D6(1_000));
      await usdc.connect(alice).approve(await vault.getAddress(), D6(1_000));
      await vault.connect(admin).addToAllowlist(alice.address);
      await vault.connect(alice).deposit(D6(1_000), alice.address);
    });

    it("createProposal does not change vault.totalAssets()", async function () {
      const before = await vault.totalAssets();
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      expect(await vault.totalAssets()).to.equal(before);
    });

    it("createProposal does not change vault.totalSupply()", async function () {
      const before = await vault.totalSupply();
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      expect(await vault.totalSupply()).to.equal(before);
    });

    it("createProposal does not change ledger.totalLockedShares()", async function () {
      const before = await ledger.totalLockedShares();
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      expect(await ledger.totalLockedShares()).to.equal(before);
    });

    it("castVote does not change vault.totalAssets()", async function () {
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      const before = await vault.totalAssets();
      await governance.connect(alice).castVote(0n, VoteType.For);
      expect(await vault.totalAssets()).to.equal(before);
    });

    it("castVote does not change vault.totalSupply()", async function () {
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      const before = await vault.totalSupply();
      await governance.connect(alice).castVote(0n, VoteType.For);
      expect(await vault.totalSupply()).to.equal(before);
    });

    it("castVote does not change ledger.totalLockedShares()", async function () {
      await governance.connect(admin).createProposal("X", "Y", ProposalType.GeneralSignal);
      const before = await ledger.totalLockedShares();
      await governance.connect(alice).castVote(0n, VoteType.For);
      expect(await ledger.totalLockedShares()).to.equal(before);
    });
  });

  // ─── Group 6: PROPOSER_ROLE separation ───────────────────────────────────
  //
  // After D1 fix: createProposal() requires PROPOSER_ROLE, not DEFAULT_ADMIN_ROLE.
  // admin holds PROPOSER_ROLE at construction; non-admins can be granted it independently.

  describe("Group 6 — PROPOSER_ROLE separation (D1 fix)", function () {
    const PROPOSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE"));

    it("admin holds PROPOSER_ROLE at construction", async function () {
      expect(await governance.hasRole(PROPOSER_ROLE, admin.address)).to.be.true;
    });

    it("proposer (non-admin) can create a proposal after being granted PROPOSER_ROLE", async function () {
      // Grant PROPOSER_ROLE to bob (who has no DEFAULT_ADMIN_ROLE)
      await governance.connect(admin).grantRole(PROPOSER_ROLE, bob.address);

      await expect(
        governance.connect(bob).createProposal("Bob Proposal", "From bob", ProposalType.GeneralSignal)
      ).to.not.be.reverted;
      expect(await governance.nextProposalId()).to.equal(1n);
    });

    it("admin with PROPOSER_ROLE revoked cannot create proposal", async function () {
      await governance.connect(admin).revokeRole(PROPOSER_ROLE, admin.address);

      await expect(
        governance.connect(admin).createProposal("Title", "Desc", ProposalType.GeneralSignal)
      ).to.be.reverted;
    });

    it("non-proposer user (alice) cannot create proposal", async function () {
      // alice has RWT and voting power but no PROPOSER_ROLE
      await expect(
        governance.connect(alice).createProposal("Alice Proposal", "Desc", ProposalType.GeneralSignal)
      ).to.be.reverted;
    });

    it("PROPOSER_ROLE and DEFAULT_ADMIN_ROLE are decoupled — bob can propose, not admin-configure", async function () {
      // Grant bob PROPOSER_ROLE only
      await governance.connect(admin).grantRole(PROPOSER_ROLE, bob.address);

      // bob can create proposals
      await expect(
        governance.connect(bob).createProposal("Test", "Desc", ProposalType.FeeDiscountSignal)
      ).to.not.be.reverted;

      // bob cannot grant roles (no DEFAULT_ADMIN_ROLE)
      await expect(
        governance.connect(bob).grantRole(PROPOSER_ROLE, carol.address)
      ).to.be.reverted;
    });

    it("voting logic is unaffected by PROPOSER_ROLE change", async function () {
      // Create a proposal (admin still has PROPOSER_ROLE)
      await governance.connect(admin).createProposal("Vote Test", "Desc", ProposalType.GeneralSignal);

      // alice votes For — should succeed as before
      await expect(governance.connect(alice).castVote(0n, VoteType.For)).to.not.be.reverted;
      const p = await governance.getProposal(0n);
      expect(p.forVotes).to.equal(D18(100));
    });
  });
});
