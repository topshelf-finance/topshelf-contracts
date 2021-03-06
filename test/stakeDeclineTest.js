const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const LUSDTokenTester = artifacts.require("./LUSDTokenTester.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues


/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the TroveManager, which is still TBD based on economic modelling.
 *
 */
contract('TroveManager', async accounts => {

  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const [owner, A, B, C, D, E, F] = accounts.slice(0, 7);

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let collSurplusPool
  let defaultPool
  let borrowerOperations
  let hintHelpers

  let contracts
  let collateralAmount = dec(1, 31);
  let approvalAmount = dec(1, 31);
  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)

  const getSnapshotsRatio = async () => {
    try {

      const ratio = (await troveManager.totalStakesSnapshot())
        .mul(toBN(dec(1, 18)))
        .div((await troveManager.totalCollateralSnapshot()))

      return ratio
    } catch(err) {
      console.log('err', err)
    }
  }

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new("200000000000000000000")
    contracts.lusdToken = await LUSDTokenTester.new(
      'USDL',
      'USDL',
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.flashLender.address,
      contracts.systemShutdown.address,
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = contracts.priceFeedTestnet
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers

    lqtyStaking = LQTYContracts.lqtyStaking
    lqtyToken = LQTYContracts.lqtyToken
    communityIssuance = LQTYContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
    for (account of accounts.slice(0, 25)) {
      await contracts.collateral.faucet(account, collateralAmount)
      await contracts.collateral.approve(borrowerOperations.address, approvalAmount, { from: account } )
    }
  })

  it("A given trove's stake decline is negligible with adjustments and tiny liquidations", async () => {
    await priceFeed.setPrice(dec(100, 18))

    // Make 1 mega troves A at ~50% total collateral
    await borrowerOperations.openTrove(A, th._100pct, dec(2, 29), await getOpenTroveLUSDAmount(dec(1, 31)), ZERO_ADDRESS, ZERO_ADDRESS, { from: A })

    // Make 5 large troves B, C, D, E, F at ~10% total collateral
    await borrowerOperations.openTrove(B, th._100pct, dec(4, 28), await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: B })
    await borrowerOperations.openTrove(C, th._100pct, dec(4, 28), await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: C })
    await borrowerOperations.openTrove(D, th._100pct, dec(4, 28), await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: D })
    await borrowerOperations.openTrove(E, th._100pct, dec(4, 28), await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: E })
    await borrowerOperations.openTrove(F, th._100pct, dec(4, 28), await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: F })

    // Make 10 tiny troves at relatively negligible collateral (~1e-9 of total)
    const tinyTroves = accounts.slice(10, 20)
    for (account of tinyTroves) {
      await borrowerOperations.openTrove(account, th._100pct, dec(2, 20), await getOpenTroveLUSDAmount(dec(1, 22)), ZERO_ADDRESS, ZERO_ADDRESS, { from: account })
    }

    // liquidate 1 trove at ~50% total system collateral
    await priceFeed.setPrice(dec(50, 18))
    assert.isTrue(await troveManager.checkRecoveryMode(await priceFeed.getPrice()))
    await troveManager.liquidate(A)

    console.log(`totalStakesSnapshot after L1: ${await troveManager.totalStakesSnapshot()}`)
    console.log(`totalCollateralSnapshot after L1: ${await troveManager.totalCollateralSnapshot()}`)
    console.log(`Snapshots ratio after L1: ${await getSnapshotsRatio()}`)
    console.log(`B pending ETH reward after L1: ${await troveManager.getPendingETHReward(B)}`)
    console.log(`B stake after L1: ${(await troveManager.Troves(B))[2]}`)

    // adjust trove B 1 wei: apply rewards
    await borrowerOperations.adjustTrove(B, th._100pct, 0, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {from: B})  // B repays 1 wei
    console.log(`B stake after A1: ${(await troveManager.Troves(B))[2]}`)
    console.log(`Snapshots ratio after A1: ${await getSnapshotsRatio()}`)

    // Loop over tiny troves, and alternately:
    // - Liquidate a tiny trove
    // - Adjust B's collateral by 1 wei
    for (let [idx, trove] of tinyTroves.entries()) {
      await troveManager.liquidate(trove)
      console.log(`B stake after L${idx + 2}: ${(await troveManager.Troves(B))[2]}`)
      console.log(`Snapshots ratio after L${idx + 2}: ${await getSnapshotsRatio()}`)
      await borrowerOperations.adjustTrove(B, th._100pct, 0, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {from: B})  // A repays 1 wei
      console.log(`B stake after A${idx + 2}: ${(await troveManager.Troves(B))[2]}`)
    }
  })

  // TODO: stake decline for adjustments with sizable liquidations, for comparison
})
