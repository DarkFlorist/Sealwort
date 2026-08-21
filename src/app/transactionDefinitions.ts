import { ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './abis/customPayment.js'
import { ERC2612_ABI } from './abis/erc2612.js'
import { ERC4626_ABI } from './abis/erc4626.js'
import { ERC7540_ABI } from './abis/erc7540.js'
import { METAMASK_SWAP_ROUTER_ABI } from './abis/metaMaskSwapRouter.js'
import { microDecoderContractAbi } from './abis/microDecoder.js'
import { MAINNET_KYBER_NETWORK_PROXY, MAINNET_METAMASK_SWAP_ROUTER, MAINNET_UNISWAP_V2_ROUTER, MAINNET_UNISWAP_V3_ROUTER, type RegisteredAddress } from './addressRegistry.js'

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
export type NestedAmountRuleDefinition = { readonly fields: readonly string[], readonly rules: AmountRules }
export type TransactionDefinition = {
	readonly abi: ContractABI
	readonly functions?: readonly FunctionRuleDefinition[]
	readonly nestedAmounts?: readonly NestedAmountRuleDefinition[]
	readonly deployment?: RegisteredAddress
}

const field = (name: string): TokenSource => ({ field: name })
const path = (end: 'first' | 'last'): TokenSource => ({ path: end })
const functionRule = (names: readonly string[], amounts: AmountRules): FunctionRuleDefinition => ({ names, rule: { amounts } })
// Uniswap V3 exact-output paths are encoded backwards: output token first, input token last.
const exactOutputPathAmounts = { amountOut: path('first'), amountInMaximum: path('last') } as const

function deployedDefinition(deployment: RegisteredAddress, abi: ContractABI | undefined, functions: readonly FunctionRuleDefinition[], nestedAmounts?: readonly NestedAmountRuleDefinition[]): readonly TransactionDefinition[] {
	return abi === undefined ? [] : [{ abi, functions, ...(nestedAmounts === undefined ? {} : { nestedAmounts }), deployment }]
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

const uniswapV3NestedRules = [
	{ fields: ['tokenIn', 'tokenOut', 'amountIn', 'amountOutMinimum'], rules: { amountIn: field('tokenIn'), amountOutMinimum: field('tokenOut') } },
	{ fields: ['tokenIn', 'tokenOut', 'amountOut', 'amountInMaximum'], rules: { amountOut: field('tokenOut'), amountInMaximum: field('tokenIn') } },
	{ fields: ['path', 'amountIn', 'amountOutMinimum'], rules: { amountIn: path('first'), amountOutMinimum: path('last') } },
	{ fields: ['path', 'amountOut', 'amountInMaximum'], rules: exactOutputPathAmounts },
] as const

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
	...deployedDefinition(MAINNET_UNISWAP_V2_ROUTER, microDecoderContractAbi(MAINNET_UNISWAP_V2_ROUTER.address), uniswapV2Rules),
	...deployedDefinition(MAINNET_UNISWAP_V3_ROUTER, microDecoderContractAbi(MAINNET_UNISWAP_V3_ROUTER.address), uniswapV3Rules, uniswapV3NestedRules),
	...deployedDefinition(MAINNET_KYBER_NETWORK_PROXY, microDecoderContractAbi(MAINNET_KYBER_NETWORK_PROXY.address), [functionRule(['trade', 'tradeWithHint', 'tradeWithHintAndFee'], { srcAmount: field('src'), srcQty: field('src'), maxDestAmount: field('dest') })]),
	...deployedDefinition(MAINNET_METAMASK_SWAP_ROUTER, METAMASK_SWAP_ROUTER_ABI, [functionRule(['swap'], { amount: field('tokenFrom') })]),
]

export function transactionDefinitionForAddress(chainId: bigint, address: bigint) {
	return TRANSACTION_DEFINITIONS.find((definition) => definition.deployment?.chainId === chainId && definition.deployment.address === address)
}
