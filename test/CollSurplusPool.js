const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const NonPayable = artifacts.require('NonPayable.sol')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const TroveManagerTester = artifacts.require("TroveManagerTester")
const LUSDToken = artifacts.require("LUSDToken")

contract('CollSurplusPool', async accounts => {
  const [
    owner,
    A, B, C, D, E] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let borrowerOperations
  let priceFeed
  let collSurplusPool

  let contracts
  let activePool
  let collateralAmount = dec(40000, 18);
  let approvalAmount = dec(4000000, 18);
  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new("200000000000000000000")
    contracts.lusdToken = await LUSDToken.new(
      "LUSD Stablecoin",
      "LUSD",
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.flashLender.address,
      contracts.systemShutdown.address,
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = contracts.priceFeedTestnet
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    activePool = contracts.activePool


    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
    for (account of accounts.slice(0, 6)) {
      await contracts.collateral.faucet(account, collateralAmount)
      await contracts.collateral.approve(borrowerOperations.address, approvalAmount, { from: account } )
      await contracts.collateral.approve(activePool.address, approvalAmount, { from: account } )
    }
  })

  it("CollSurplusPool::getETH(): Returns the ETH balance of the CollSurplusPool after redemption", async () => {
    const ETH_1 = await collSurplusPool.getETH()
    assert.equal(ETH_1, '0')

    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price)

    const { collateral: B_coll, netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: B } })
    await openTrove({collatAmount: dec(3000, 'ether'), extraLUSDAmount: B_netDebt, extraParams: { from: A } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // At ETH:USD = 100, this redemption should leave 1 ether of coll surplus
    await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt)

    const ETH_2 = await collSurplusPool.getETH()
    th.assertIsApproximatelyEqual(ETH_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)))
  })

  it("CollSurplusPool: claimColl(): Reverts if caller is not Borrower Operations", async () => {
    await th.assertRevert(collSurplusPool.claimColl(A, A, { from: A }), 'CollSurplusPool: Caller is not Borrower Operations')
  })

  it("CollSurplusPool: claimColl(): Reverts if nothing to claim", async () => {
    await th.assertRevert(borrowerOperations.claimCollateral(A, { from: A }), 'CollSurplusPool: No collateral available to claim')
  })
  // // removing as this is not an issue for us
  // it("CollSurplusPool: claimColl(): Reverts if owner cannot receive ETH surplus", async () => {
  //   const nonPayable = await NonPayable.new()

  //   const price = toBN(dec(100, 18))
  //   await priceFeed.setPrice(price)

  //   // open trove from NonPayable proxy contract
  //   const B_coll = toBN(dec(60, 18))
  //   const B_lusdAmount = toBN(dec(3000, 18))
  //   const B_netDebt = await th.getAmountWithBorrowingFee(contracts, B_lusdAmount)
  //   const openTroveData = th.getTransactionData('openTrove(uint256,uint256,address,address)', ['0xde0b6b3a7640000', web3.utils.toHex(B_lusdAmount), B, B])
  //   await nonPayable.forward(borrowerOperations.address, openTroveData, { value: B_coll })
  //   await openTrove({ collatAmount: dec(3000, 'ether'), extraLUSDAmount: B_netDebt, extraParams: { from: A } })

  //   // skip bootstrapping phase
  //   await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

  //   // At ETH:USD = 100, this redemption should leave 1 ether of coll surplus for B
  //   await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt)

  //   const ETH_2 = await collSurplusPool.getETH()
  //   th.assertIsApproximatelyEqual(ETH_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)))

  //   const claimCollateralData = th.getTransactionData('claimCollateral()', [])
  //   await th.assertRevert(nonPayable.forward(borrowerOperations.address, claimCollateralData), 'CollSurplusPool: sending ETH failed')
  // })

  it('CollSurplusPool: reverts trying to send ETH to it', async () => {
    await th.assertRevert(collSurplusPool.notifyReceiveCollateral(100, { from: A, to: collSurplusPool.address}), 'CollSurplusPool: Caller is not Active Pool')
  })

  it('CollSurplusPool: accountSurplus: reverts if caller is not Trove Manager', async () => {
    await th.assertRevert(collSurplusPool.accountSurplus(A, 1), 'CollSurplusPool: Caller is not TroveManager')
  })
})

contract('Reset chain state', async accounts => { })
