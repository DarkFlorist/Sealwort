import { getChainConfiguration, NATIVE_TOKEN_SENTINEL, type TransactionContractDeployments } from './chainConfiguration.js'
import { checksummedAddress } from './ethereum.js'

const TRANSACTION_CONTRACT_LABELS: Readonly<Record<keyof TransactionContractDeployments, string>> = {
	uniswapV2Router: 'Uniswap V2 Router',
	uniswapV3Router: 'Uniswap V3 Router',
	kyberNetworkProxy: 'Kyber Network Proxy',
	metaMaskSwapRouter: 'MetaMask Swap Router',
}

export function getAddressLabel(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	if (connectedAccount === address) return 'connected wallet'
	const configuration = getChainConfiguration(chainId)
	const token = configuration.tokens.find((deployment) => deployment.address === address)
	if (token !== undefined) return token.symbol
	if (address === NATIVE_TOKEN_SENTINEL) return 'native asset'
	const transactionContracts = configuration.transactionContracts
	if (transactionContracts === undefined) return undefined
	const contract = Object.entries(transactionContracts).find(([, deployment]) => deployment === address)
	return contract === undefined ? undefined : TRANSACTION_CONTRACT_LABELS[contract[0] as keyof TransactionContractDeployments]
}

export function identifiedAddress(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	const formatted = checksummedAddress(address)
	const label = getAddressLabel(address, chainId, connectedAccount)
	return label === undefined ? formatted : `${ formatted } (${ label })`
}
