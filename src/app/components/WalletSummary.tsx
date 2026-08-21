import type { ConnectedAccountInformation } from '../accountInspection.js'
import type { AssetBalance, ConnectedSafeBalances, NativeAssetBalance } from '../accountBalances.js'
import { formatTokenBalance, getNativeAssetSymbol } from '../assetFormatting.js'
import { identifiedAddress } from '../addressLabels.js'
import { LoadingIndicator } from '../Spinner.js'

function connectedAccountType(accountInformation: ConnectedAccountInformation | undefined) {
	if (accountInformation === undefined) return 'Unavailable'
	if (accountInformation.kind === 'safe') return 'Gnosis Safe'
	if (accountInformation.kind === 'eoa') return 'EOA'
	if (accountInformation.kind === 'contract') return 'Contract'
	return 'Unavailable'
}

function BalanceValue({ balance, decimals }: { readonly balance: AssetBalance, readonly decimals: number }) {
	if (balance.status === 'unavailable') {
		return <span class = 'balance-unavailable' title = { balance.error } aria-label = { `Unavailable: ${ balance.error }` }>Unavailable</span>
	}
	return <>{ formatTokenBalance(balance.value, decimals) }</>
}

export function WalletSummary({
	loading,
	loadingLabel,
	busy,
	applicationLoading,
	account,
	chainId,
	accountInformation,
	activeSigner,
	activeSignerLoading,
	balances,
	balancesLoading,
	nativeAsset,
	onConnect,
	onRefresh,
}: {
	readonly loading: boolean
	readonly loadingLabel: string
	readonly busy: boolean
	readonly applicationLoading: boolean
	readonly account: bigint | undefined
	readonly chainId: bigint | undefined
	readonly accountInformation: ConnectedAccountInformation | undefined
	readonly activeSigner: bigint | undefined
	readonly activeSignerLoading: boolean
	readonly balances: ConnectedSafeBalances | undefined
	readonly balancesLoading: boolean
	readonly nativeAsset: NativeAssetBalance | undefined
	readonly onConnect: () => void
	readonly onRefresh: () => void
}) {
	if (loading) {
		return <div class = 'wallet'><div class = 'wallet-loading' role = 'status' aria-live = 'polite'>
			<LoadingIndicator>{ loadingLabel }</LoadingIndicator>
		</div></div>
	}
	return <div class = 'wallet'>
		{ account === undefined
			? <div class = 'wallet-actions'><button disabled = { busy || applicationLoading } onClick = { onConnect }>Connect signer wallet</button></div>
			: <div class = 'wallet-summary-card' role = 'region' aria-label = 'Connected wallet summary'>
				<p class = 'wallet-context'>
					<span class = 'wallet-account-type'>{ connectedAccountType(accountInformation) }</span>
					<span class = 'wallet-chain'>Chain { chainId?.toString() }</span>
				</p>
				<div class = 'wallet-summary-section wallet-identity'>
					<span class = 'wallet-summary-label'>{ accountInformation?.kind === 'safe' ? 'Vault' : 'Connected account' }</span>
					<code>{ identifiedAddress(account, chainId ?? 0n, account) }</code>
				</div>
				{ accountInformation?.kind === 'safe' && activeSignerLoading
					? <div class = 'wallet-summary-section wallet-active-signer'>
						<span class = 'wallet-summary-label'>Active signer</span>
						<span class = 'element-loading' role = 'status'><LoadingIndicator>Loading signer…</LoadingIndicator></span>
					</div>
					: activeSigner === undefined ? <></> : <div class = 'wallet-summary-section wallet-active-signer'>
						<span class = 'wallet-summary-label'>Active signer</span>
						<code>{ identifiedAddress(activeSigner, chainId ?? 0n, account) }</code>
					</div> }
				{ accountInformation?.kind === 'safe'
					? <section class = 'wallet-summary-section wallet-balance-summary'>
						<span class = 'wallet-summary-label'>Vault balances</span>
						{ balancesLoading || balances === undefined
							? <p class = 'element-loading' role = 'status'><LoadingIndicator>Loading balances…</LoadingIndicator></p>
							: <dl class = 'wallet-balances' aria-label = 'Vault balances'>
								<div><dt>{ nativeAsset?.symbol ?? getNativeAssetSymbol(chainId ?? 0n) }</dt><dd>{ nativeAsset === undefined ? 'Unavailable' : <BalanceValue balance = { nativeAsset.balance } decimals = { 18 }/> }</dd></div>
								{ balances.usdc === undefined ? <></> : <div><dt>{ balances.usdc.symbol }</dt><dd><BalanceValue balance = { balances.usdc.balance } decimals = { 6 }/></dd></div> }
							</dl> }
					</section>
					: <></> }
			</div> }
		<div class = 'wallet-actions wallet-refresh-action'>
			<button class = 'secondary' disabled = { busy || applicationLoading } onClick = { onRefresh }>Refresh</button>
		</div>
	</div>
}
