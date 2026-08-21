import { CONTRACTS, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { addressString } from '../ethereum.js'

export function microDecoderContractAbi(address: bigint): ContractABI | undefined {
	const abi = CONTRACTS[addressString(address).toLowerCase()]?.abi
	return abi === undefined || typeof abi === 'string' ? undefined : abi
}
