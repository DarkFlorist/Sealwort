import { KYBER_NETWORK_PROXY_CONTRACT, TOKENS, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT } from 'micro-eth-signer/advanced/abi.js'
import { METAMASK_SWAP_ROUTER_ADDRESS } from './abis/metaMaskSwapRouter.js'
import { checksummedAddress } from './ethereum.js'

const MAINNET_TOKEN_LABELS = Object.fromEntries(Object.entries(TOKENS).map(([address, { symbol }]) => [address, symbol]))

export const ADDRESS_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'1': {
		...MAINNET_TOKEN_LABELS,
		'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'native asset',
		[UNISWAP_V2_ROUTER_CONTRACT]: 'Uniswap V2 Router',
		[UNISWAP_V3_ROUTER_CONTRACT]: 'Uniswap V3 Router',
		[KYBER_NETWORK_PROXY_CONTRACT]: 'Kyber Network Proxy',
		[`0x${ METAMASK_SWAP_ROUTER_ADDRESS.toString(16).padStart(40, '0') }`]: 'MetaMask Swap Router',
	},
	'11155111': {
		'0x7b79995e5f793a07bc00c21412e50ecae098e7f9': 'WETH',
		'0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': 'USDC',
	},
}

export function getAddressLabel(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	if (connectedAccount === address) return 'connected wallet'
	return ADDRESS_LABELS[chainId.toString()]?.[`0x${ address.toString(16).padStart(40, '0') }`]
}

export function identifiedAddress(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	const formatted = checksummedAddress(address)
	const label = getAddressLabel(address, chainId, connectedAccount)
	return label === undefined ? formatted : `${ formatted } (${ label })`
}
