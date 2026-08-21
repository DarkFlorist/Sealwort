import { checksummedAddress } from './ethereum.js'

export const ADDRESS_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'1': {
		'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
		'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
		'0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
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
