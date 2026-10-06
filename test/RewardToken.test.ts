import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RewardToken", function () {
  let token: RewardToken;
  let treasury: SignerWithAddress;
  let other: SignerWithAddress;

  const PREMINT = ethers.parseEther("1000000");

  beforeEach(async function () {
    [, treasury, other] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWD", PREMINT, treasury.address
    );
  });

  it("full supply preminted to treasury", async function () {
    expect(await token.balanceOf(treasury.address)).to.equal(PREMINT);
    expect(await token.totalSupply()).to.equal(PREMINT);
  });

  it("emits TokensPreminted on deploy", async function () {
    const newToken = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWD", PREMINT, treasury.address
    );
    const receipt = await newToken.deploymentTransaction()!.wait();
    const event = receipt!.logs
      .map(log => { try { return newToken.interface.parseLog({ topics: [...log.topics], data: log.data }); } catch { return null; } })
      .find(e => e?.name === "TokensPreminted");
    expect(event).to.not.be.undefined;
  });

  it("totalSupply never changes after deploy", async function () {
    await token.connect(treasury).transfer(other.address, ethers.parseEther("1000"));
    expect(await token.totalSupply()).to.equal(PREMINT);
  });

  it("premintAmount = 0 reverts ZeroPremintAmount", async function () {
    await expect(
      (await ethers.getContractFactory("RewardToken")).deploy("T", "T", 0, treasury.address)
    ).to.be.revertedWithCustomError(
      await (await ethers.getContractFactory("RewardToken")).deploy("T", "T", PREMINT, treasury.address),
      "ZeroPremintAmount"
    );
  });

  it("treasury = address(0) reverts ZeroAddress", async function () {
    await expect(
      (await ethers.getContractFactory("RewardToken")).deploy("T", "T", PREMINT, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(token, "ZeroAddress");
  });
});
