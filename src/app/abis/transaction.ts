import { ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './customPayment.js'

export const TRANSACTION_ABIS: readonly ContractABI[] = [ERC20, ERC721, ERC1155, WETH, CUSTOM_PAYMENT_ABI]
