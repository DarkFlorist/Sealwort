import { CONTRACTS, KYBER_NETWORK_PROXY_CONTRACT, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT, type ContractABI } from 'micro-eth-signer/advanced/abi.js'

function contractAbi(address: string): ContractABI | undefined {
	const abi = CONTRACTS[address]?.abi
	return abi === undefined || typeof abi === 'string' ? undefined : abi
}

export const KYBER_NETWORK_PROXY_ABI = contractAbi(KYBER_NETWORK_PROXY_CONTRACT)
export const UNISWAP_V2_ROUTER_ABI = contractAbi(UNISWAP_V2_ROUTER_CONTRACT)
export const UNISWAP_V3_ROUTER_ABI = contractAbi(UNISWAP_V3_ROUTER_CONTRACT)
