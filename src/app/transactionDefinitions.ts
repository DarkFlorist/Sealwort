import { ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './abis/customPayment.js'
import { ERC2612_ABI } from './abis/erc2612.js'
import { ERC4626_ABI } from './abis/erc4626.js'
import { ERC7540_ABI } from './abis/erc7540.js'
import { KYBER_NETWORK_PROXY_ABI } from './abis/kyberNetworkProxy.js'
import { METAMASK_SWAP_ROUTER_ABI } from './abis/metaMaskSwapRouter.js'
import { UNISWAP_V2_ROUTER_ABI } from './abis/uniswapV2Router.js'
import { UNISWAP_V3_ROUTER_ABI } from './abis/uniswapV3Router.js'
import { ETHEREUM_MAINNET_CHAIN_ID, getRegisteredTransactionContracts, type RegisteredTransactionContract } from './addressRegistry.js'

export type AmountTokenReference = 'destination' | 'liquidity' | 'native' | 'vaultAsset' | bigint
export type TokenSource = AmountTokenReference | { readonly field: string } | { readonly path: 'first' | 'last' }
export type AmountRules = Readonly<Record<string, TokenSource>>
export type FunctionRule = {
	readonly amounts?: AmountRules
	readonly ambiguity?: {
		readonly erc721Arguments: readonly string[]
		readonly fallbackArguments: readonly string[]
	}
	readonly transactionValue?: { readonly label: string, readonly decimals: number, readonly token: 'destination', readonly fallbackSymbol: string }
}
export type FunctionRuleDefinition = { readonly names: readonly string[], readonly rule: FunctionRule }
export type TransactionDefinition = {
	readonly abi: ContractABI
	readonly functions?: readonly FunctionRuleDefinition[]
	readonly deployment?: RegisteredTransactionContract
}

const field = (name: string): TokenSource => ({ field: name })
const path = (end: 'first' | 'last'): TokenSource => ({ path: end })
const functionRule = (names: readonly string[], amounts: AmountRules): FunctionRuleDefinition => ({ names, rule: { amounts } })
// Uniswap V3 exact-output paths are encoded backwards: output token first, input token last.
const exactOutputPathAmounts = { amountOut: path('first'), amountInMaximum: path('last') } as const

function deployedDefinition(deployment: RegisteredTransactionContract, abi: ContractABI, functions: readonly FunctionRuleDefinition[]): TransactionDefinition {
	return { abi, functions, deployment }
}

function unreachableDeployment(_deployment: never): never {
	throw new Error('No transaction interpretation exists for the registered contract.')
}

const uniswapV2Rules = [
	functionRule(['addLiquidity'], { amountADesired: field('tokenA'), amountAMin: field('tokenA'), amountBDesired: field('tokenB'), amountBMin: field('tokenB') }),
	functionRule(['addLiquidityETH'], { amountTokenDesired: field('token'), amountTokenMin: field('token'), amountETHMin: 'native' }),
	functionRule(['removeLiquidity', 'removeLiquidityWithPermit'], { liquidity: 'liquidity', amountAMin: field('tokenA'), amountBMin: field('tokenB') }),
	functionRule(['removeLiquidityETH', 'removeLiquidityETHSupportingFeeOnTransferTokens', 'removeLiquidityETHWithPermit', 'removeLiquidityETHWithPermitSupportingFeeOnTransferTokens'], { liquidity: 'liquidity', amountTokenMin: field('token'), amountETHMin: 'native' }),
	functionRule(['swapExactTokensForTokens', 'swapExactTokensForTokensSupportingFeeOnTransferTokens'], { amountIn: path('first'), amountOutMin: path('last') }),
	functionRule(['swapTokensForExactTokens'], { amountOut: path('last'), amountInMax: path('first') }),
	functionRule(['swapExactTokensForETH', 'swapExactTokensForETHSupportingFeeOnTransferTokens'], { amountIn: path('first'), amountOutMin: 'native' }),
	functionRule(['swapTokensForExactETH'], { amountOut: 'native', amountInMax: path('first') }),
	functionRule(['swapExactETHForTokens', 'swapExactETHForTokensSupportingFeeOnTransferTokens'], { amountOutMin: path('last') }),
	functionRule(['swapETHForExactTokens'], { amountOut: path('last') }),
] as const

const uniswapV3Rules = [
	functionRule(['selfPermit', 'selfPermitIfNecessary'], { value: field('token') }),
	functionRule(['sweepToken', 'sweepTokenWithFee'], { amountMinimum: field('token') }),
	functionRule(['unwrapWETH9', 'unwrapWETH9WithFee'], { amountMinimum: 'native' }),
	functionRule(['exactInput'], { amountIn: path('first'), amountOutMinimum: path('last') }),
	functionRule(['exactOutput'], exactOutputPathAmounts),
	functionRule(['exactInputSingle'], { amountIn: field('tokenIn'), amountOutMinimum: field('tokenOut') }),
	functionRule(['exactOutputSingle'], { amountOut: field('tokenOut'), amountInMaximum: field('tokenIn') }),
] as const

function deployedDefinitionFor(deployment: RegisteredTransactionContract): TransactionDefinition {
	switch (deployment.decoder) {
		case 'uniswapV2Router': return deployedDefinition(deployment, UNISWAP_V2_ROUTER_ABI, uniswapV2Rules)
		case 'uniswapV3Router': return deployedDefinition(deployment, UNISWAP_V3_ROUTER_ABI, uniswapV3Rules)
		case 'kyberNetworkProxy': return deployedDefinition(deployment, KYBER_NETWORK_PROXY_ABI, [functionRule(['trade', 'tradeWithHint', 'tradeWithHintAndFee'], { srcAmount: field('src'), srcQty: field('src'), maxDestAmount: field('dest') })])
		case 'metaMaskSwapRouter': return deployedDefinition(deployment, METAMASK_SWAP_ROUTER_ABI, [functionRule(['swap'], { amount: field('tokenFrom') })])
		default: return unreachableDeployment(deployment)
	}
}

const MAINNET_TRANSACTION_DEFINITIONS = getRegisteredTransactionContracts(ETHEREUM_MAINNET_CHAIN_ID).map(deployedDefinitionFor)

export const TRANSACTION_DEFINITIONS: readonly TransactionDefinition[] = [
	{ abi: ERC20, functions: [functionRule(['transfer', 'approve', 'transferFrom'], { value: 'destination' })] },
	{ abi: ERC721 },
	{ abi: ERC1155 },
	{ abi: WETH, functions: [
		functionRule(['withdraw'], { wad: 'destination' }),
		{ names: ['deposit'], rule: { transactionValue: { label: 'Amount', decimals: 18, token: 'destination', fallbackSymbol: 'WETH' } } },
	] },
	{ abi: ERC2612_ABI, functions: [functionRule(['permit'], { value: 'destination' })] },
	{ abi: ERC4626_ABI, functions: [functionRule(['deposit', 'withdraw'], { assets: 'vaultAsset' }), functionRule(['mint', 'redeem'], { shares: 'destination' })] },
	{ abi: ERC7540_ABI, functions: [functionRule(['deposit', 'withdraw', 'requestDeposit'], { assets: 'vaultAsset' }), functionRule(['mint', 'redeem', 'requestRedeem'], { shares: 'destination' })] },
	{ abi: CUSTOM_PAYMENT_ABI, functions: [
		functionRule(['transferFromWithReferenceAndFee'], { amount: field('tokenAddress'), feeAmount: field('tokenAddress') }),
		{ names: ['safeTransferFrom'], rule: { amounts: { amount: field('tokenAddress') }, ambiguity: { erc721Arguments: ['from', 'to', 'tokenId'], fallbackArguments: ['_tokenAddress', '_to', '_amount'] } } },
	] },
	...MAINNET_TRANSACTION_DEFINITIONS,
]

export function transactionDefinitionForAddress(chainId: bigint, address: bigint) {
	return TRANSACTION_DEFINITIONS.find((definition) => definition.deployment?.chainId === chainId && definition.deployment.address === address)
}
