import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { InjectedProvider } from './provider.js'
import { SafeStackExport } from './safeStackProtocol.js'
import { type VerifiedSafeState, parseSafeStackText, validateSafeStackAtCurrentNonce, validateStackFile } from './safeStackValidation.js'
import { isCurrentStackOperation } from './stackOperationState.js'
import { getUserFacingErrorMessage, readSafeStackFile } from './userFacingErrors.js'
import { getAutomaticStackVerificationAction, getSafeStackTextAction, persistSafeStackText, readPersistedSafeStackText, resizeTextareaToContent, SAFE_STACK_PERSISTENCE_WARNING, type SafeStackStorage } from './uiState.js'
import { DARK_FLORIST_SOCIAL_LINKS } from './socialLinks.js'
import { getPreferredNativeAssetBalance } from './accountBalances.js'
import { LoadingIndicator } from './Spinner.js'
import type { PendingAction, SubmittedExecution, TransactionActionError } from './appTypes.js'
import { WalletSummary } from './components/WalletSummary.js'
import { StackJsonInput, UpdatedStackPanel } from './components/StackJsonPanels.js'
import { SafeStackPanel } from './components/SafeStackPanel.js'
import { useExecutionGasChecks } from './useExecutionGasChecks.js'
import { createTransactionActions } from './transactionActions.js'
import { useWalletState } from './useWalletState.js'
import { useSafeInformation } from './useSafeInformation.js'
import { useSubmittedExecutionReceipts } from './useSubmittedExecutionReceipts.js'
import { withWalletRequestTimeout } from './walletProvider.js'
import { BuildInformationLink, type BuildInformation } from './buildInformation.js'
import { ChainDiscoveryUnavailableError } from './chainDiscoveryError.js'
import { RpcSettings } from './components/RpcSettings.js'
import { persistEthereumRpcUrl, readPersistedEthereumRpcUrl, validateEthereumRpcUrl } from './rpcSettings.js'
import { useTransactionDataMetadata } from './useTransactionDataMetadata.js'

const SAFE_STACK_AUTO_IMPORT_DELAY_MS = 250

async function getProvider() {
	if (window.ethereum === undefined) throw new Error('No injected Ethereum wallet was found.')
	return window.ethereum
}

function getBrowserStorage() {
	try {
		return window.localStorage
	} catch {
		return undefined
	}
}

export function App({
	browserStorage = getBrowserStorage(),
	walletRequestTimeoutMs,
	buildInformation,
}: {
	readonly browserStorage?: SafeStackStorage
	readonly walletRequestTimeoutMs?: number
	readonly buildInformation?: BuildInformation
} = {}) {
	const stackExport = useSignal<SafeStackExport | undefined>(undefined)
	const stackVerified = useSignal(false)
	const verifiedSafeStates = useSignal<readonly VerifiedSafeState[]>([])
	const {
		account,
		chainId: walletChainId,
		information: accountInformation,
		informationLoading: accountInformationLoading,
		balances: connectedSafeBalances,
		balancesLoading: connectedSafeBalancesLoading,
		loading: walletInformationLoading,
		revision: walletRevision,
		safeWalletSigners: connectedSafeWalletSigners,
		safeWalletSignerLoading: connectedSafeWalletSignerLoading,
		beginLoad: beginWalletLoad,
		isCurrent: isCurrentWalletOperation,
		load: loadWallet,
		stopLoading: stopWalletLoading,
	} = useWalletState()
	const applicationLoading = useSignal(window.ethereum?.on !== undefined)
	const stackVerificationLoading = useSignal(false)
	const status = useSignal<string | undefined>(undefined)
	const error = useSignal<string | undefined>(undefined)
	const persistenceWarning = useSignal<string | undefined>(undefined)
	const pendingAction = useSignal<PendingAction | undefined>(undefined)
	const importText = useSignal(readPersistedSafeStackText(browserStorage))
	const ethereumRpcUrl = useSignal(readPersistedEthereumRpcUrl(browserStorage))
	const lastImportedText = useSignal<string | undefined>(undefined)
	const stackInputExpanded = useSignal(false)
	const updatedStackExpanded = useSignal(false)
	const importTextarea = useRef<HTMLTextAreaElement>(null)
	const updatedStackTextarea = useRef<HTMLTextAreaElement>(null)
	const stackRevision = useSignal(0)
	const { information: safeInformation, refresh: refreshSafeInformation } = useSafeInformation(stackRevision, stackExport, ethereumRpcUrl, walletRequestTimeoutMs)
	const signedStackJson = useSignal<string | undefined>(undefined)
	const submittedExecutions = useSignal<readonly SubmittedExecution[]>([])
	const transactionActionErrors = useSignal<readonly TransactionActionError[]>([])
	useSubmittedExecutionReceipts(submittedExecutions, transactionActionErrors, walletRequestTimeoutMs)
	const persistStackText = (text: string) => {
		persistenceWarning.value = persistSafeStackText(browserStorage, text) ? undefined : SAFE_STACK_PERSISTENCE_WARNING
	}

	useEffect(() => {
		if (importTextarea.current !== null) resizeTextareaToContent(importTextarea.current, stackInputExpanded.value)
	}, [importText.value, stackInputExpanded.value])

	useEffect(() => {
		if (updatedStackTextarea.current !== null) resizeTextareaToContent(updatedStackTextarea.current, updatedStackExpanded.value)
	}, [signedStackJson.value, updatedStackExpanded.value])

	const finishPendingAction = (action: PendingAction) => {
		if (pendingAction.peek() === action) pendingAction.value = undefined
	}

	const verifyLoadedStack = async (provider: InjectedProvider, loadedStack: SafeStackExport) => {
		return await validateSafeStackAtCurrentNonce(provider, loadedStack)
	}

	const loadWalletIdentity = async (
		provider: InjectedProvider,
		operationRevision: number,
		requestAccess: boolean,
		reportUnavailable: boolean,
	) => {
		try {
			return await loadWallet(provider, operationRevision, requestAccess)
		} catch (walletLoadError) {
			if (!(walletLoadError instanceof ChainDiscoveryUnavailableError) || walletLoadError.context !== 'wallet-connection') throw walletLoadError
			if (!isCurrentWalletOperation(operationRevision)) return undefined
			if (reportUnavailable) throw walletLoadError
			return undefined
		}
	}

	const refreshWalletAndStack = async (
		provider: InjectedProvider,
		operationRevision: number,
		manual: boolean,
	) => {
		error.value = undefined
		const walletIdentity = await loadWalletIdentity(provider, operationRevision, false, manual)
		if (walletIdentity === undefined) return
		const loadedStack = stackExport.peek()
		const verificationRevision = stackRevision.peek()
		const verificationAction = getAutomaticStackVerificationAction(loadedStack !== undefined, walletIdentity.status === 'connected' ? walletIdentity.account : undefined)
		if (verificationAction === 'no-stack') return
		if (verificationAction === 'await-account') {
			verifiedSafeStates.value = []
			stackVerified.value = false
			status.value = 'Select a signer wallet account to verify the imported Gnosis Safe stack.'
			return
		}
		if (loadedStack === undefined) return
		stackVerificationLoading.value = true
		try {
			const verifiedStates = await verifyLoadedStack(provider, loadedStack)
			if (!isCurrentStackOperation(stackRevision.peek(), verificationRevision, stackExport.peek(), loadedStack)) return
			verifiedSafeStates.value = verifiedStates
			stackVerified.value = true
			status.value = undefined
		} finally {
			if (isCurrentStackOperation(stackRevision.peek(), verificationRevision, stackExport.peek(), loadedStack)) {
				stackVerificationLoading.value = false
			}
		}
	}

	const refreshEverything = async (provider: InjectedProvider, manual: boolean) => {
		const requestProvider = withWalletRequestTimeout(provider, walletRequestTimeoutMs)
		const action = 'refresh'
		const refreshRevision = stackRevision.peek() + 1
		stackRevision.value = refreshRevision
		const walletRefreshRevision = beginWalletLoad()
		if (manual) pendingAction.value = action
		applicationLoading.value = true
		stackVerified.value = false
		submittedExecutions.value = []
		transactionActionErrors.value = []
		const loadedStack = stackExport.peek()
		stackVerificationLoading.value = loadedStack !== undefined
		try {
			await Promise.all([
				refreshWalletAndStack(requestProvider, walletRefreshRevision, manual),
				loadedStack === undefined ? Promise.resolve() : refreshSafeInformation(loadedStack, refreshRevision),
			])
		} catch (providerError) {
			if (provider !== window.ethereum || !isCurrentWalletOperation(walletRefreshRevision)) return
			if (isCurrentStackOperation(stackRevision.peek(), refreshRevision, stackExport.peek(), loadedStack)) {
				stackVerified.value = false
				verifiedSafeStates.value = []
				status.value = undefined
			}
			stopWalletLoading(walletRefreshRevision)
			error.value = getUserFacingErrorMessage(providerError)
		} finally {
			if (provider === window.ethereum && isCurrentWalletOperation(walletRefreshRevision)) {
				applicationLoading.value = false
				if (isCurrentStackOperation(stackRevision.peek(), refreshRevision, stackExport.peek(), loadedStack)) stackVerificationLoading.value = false
				if (manual) finishPendingAction(action)
			}
		}
	}

	useEffect(() => {
		const provider = window.ethereum
		if (provider?.on === undefined) return
		const handleProviderChange = () => {
			pendingAction.value = undefined
			void refreshEverything(provider, false)
		}
		provider.on('accountsChanged', handleProviderChange)
		provider.on('chainChanged', handleProviderChange)
		handleProviderChange()
		return () => {
			provider.removeListener?.('accountsChanged', handleProviderChange)
			provider.removeListener?.('chainChanged', handleProviderChange)
		}
	}, [])

	const refresh = async () => {
		try {
			await refreshEverything(await getProvider(), true)
		} catch (refreshError) {
			applicationLoading.value = false
			stackVerificationLoading.value = false
			finishPendingAction('refresh')
			error.value = getUserFacingErrorMessage(refreshError)
		}
	}

	const connect = async () => {
		const action = 'connect'
		const connectRevision = stackRevision.peek() + 1
		stackRevision.value = connectRevision
		const connectWalletRevision = beginWalletLoad()
		let verificationRevision = connectRevision
		let loadedStackAtVerification = stackExport.peek()
		pendingAction.value = action
		stackVerified.value = false
		stackVerificationLoading.value = stackExport.peek() !== undefined
		submittedExecutions.value = []
		transactionActionErrors.value = []
		try {
			error.value = undefined
			const provider = withWalletRequestTimeout(await getProvider(), walletRequestTimeoutMs)
			const walletIdentity = await loadWalletIdentity(provider, connectWalletRevision, true, true)
			if (walletIdentity === undefined) return
			if (walletIdentity.status === 'disconnected') return
			verifiedSafeStates.value = []
			loadedStackAtVerification = stackExport.peek()
			verificationRevision = stackRevision.peek()
			const verificationAction = getAutomaticStackVerificationAction(loadedStackAtVerification !== undefined, walletIdentity.account)
			if (verificationAction === 'no-stack') {
				status.value = 'Signer wallet connected. Import a Gnosis Safe stack to begin.'
				return
			}
			if (verificationAction === 'await-account' || loadedStackAtVerification === undefined) return
			status.value = 'Verifying transactions against current on-chain state…'
			const verifiedStates = await verifyLoadedStack(provider, loadedStackAtVerification)
			if (!isCurrentStackOperation(stackRevision.peek(), verificationRevision, stackExport.peek(), loadedStackAtVerification)) return
			verifiedSafeStates.value = verifiedStates
			stackVerified.value = true
			status.value = undefined
			void refreshSafeInformation(loadedStackAtVerification, verificationRevision)
		} catch (connectError) {
			if (!isCurrentWalletOperation(connectWalletRevision)) return
			if (isCurrentStackOperation(stackRevision.peek(), verificationRevision, stackExport.peek(), loadedStackAtVerification)) {
				stackVerified.value = false
				verifiedSafeStates.value = []
			}
			stopWalletLoading(connectWalletRevision)
			status.value = undefined
			error.value = getUserFacingErrorMessage(connectError)
		} finally {
			if (isCurrentStackOperation(stackRevision.peek(), verificationRevision, stackExport.peek(), loadedStackAtVerification)) stackVerificationLoading.value = false
			if (isCurrentWalletOperation(connectWalletRevision)) finishPendingAction(action)
		}
	}

	const importStack = async (readText: () => Promise<string>, initialStatus: string) => {
		const action = 'import'
		const importRevision = stackRevision.peek() + 1
		stackRevision.value = importRevision
		pendingAction.value = action
		stackVerified.value = false
		stackVerificationLoading.value = stackExport.peek() !== undefined
		try {
			error.value = undefined
			status.value = initialStatus
			const text = await readText()
			if (stackRevision.peek() !== importRevision) return
			status.value = 'Validating stack…'
			const parsed = parseSafeStackText(text)
			await validateStackFile(parsed)
			if (stackRevision.peek() !== importRevision) return
			stackExport.value = parsed
			stackVerificationLoading.value = true
			const serializedStack = JSON.stringify(SafeStackExport.serialize(parsed), undefined, '\t')
			signedStackJson.value = undefined
			persistStackText(serializedStack)
			submittedExecutions.value = []
			transactionActionErrors.value = []
			verifiedSafeStates.value = []
			lastImportedText.value = text
			void refreshSafeInformation(parsed, importRevision)
			const transactionCount = parsed.stacks.reduce((count, stack) => count + stack.transactions.length, 0)
			const verificationAction = getAutomaticStackVerificationAction(true, account.peek())
			if (verificationAction === 'await-account') {
			status.value = `Imported ${ transactionCount } Gnosis Safe transaction(s). Connect a signer wallet to verify them against current on-chain state.`
				return
			}
			status.value = 'Verifying transactions against current on-chain state…'
			const verifiedStates = await verifyLoadedStack(withWalletRequestTimeout(await getProvider(), walletRequestTimeoutMs), parsed)
			if (!isCurrentStackOperation(stackRevision.peek(), importRevision, stackExport.peek(), parsed)) return
			verifiedSafeStates.value = verifiedStates
			stackVerified.value = true
			status.value = undefined
		} catch (importError) {
			if (stackRevision.peek() !== importRevision) return
			status.value = undefined
			error.value = getUserFacingErrorMessage(importError)
		} finally {
			if (stackRevision.peek() === importRevision) {
				stackVerificationLoading.value = false
				finishPendingAction(action)
			}
		}
	}

	const importStackText = async (text: string) => await importStack(async () => text, 'Validating stack…')

	const importFile = async (file: File | undefined) => {
		if (file === undefined) return
		const action = 'read-file'
		const fileReadRevision = stackRevision.peek() + 1
		stackRevision.value = fileReadRevision
		pendingAction.value = action
		try {
			error.value = undefined
			status.value = 'Reading Gnosis Safe Stack file…'
			const text = await readSafeStackFile(file)
			if (stackRevision.peek() !== fileReadRevision) return
			if (importText.peek() === text) {
				finishPendingAction(action)
				await importStackText(text)
				return
			}
			importText.value = text
		} catch (fileReadError) {
			if (stackRevision.peek() !== fileReadRevision) return
			status.value = undefined
			error.value = getUserFacingErrorMessage(fileReadError)
		} finally {
			if (stackRevision.peek() === fileReadRevision) finishPendingAction(action)
		}
	}

	useEffect(() => {
		const text = importText.value
		const textAction = getSafeStackTextAction(text, lastImportedText.peek())
		if (textAction === 'none') return
		const nextRevision = stackRevision.peek() + 1
		stackRevision.value = nextRevision
		pendingAction.value = undefined
		stackExport.value = undefined
		signedStackJson.value = undefined
		submittedExecutions.value = []
		transactionActionErrors.value = []
		stackVerified.value = false
		stackVerificationLoading.value = false
		applicationLoading.value = false
		verifiedSafeStates.value = []
		safeInformation.value = []
		lastImportedText.value = undefined
		status.value = undefined
		error.value = undefined
		if (textAction === 'clear') {
			persistStackText('')
			return
		}
		const timeout = window.setTimeout(() => {
			if (importText.peek() !== text || lastImportedText.peek() === text) return
			void importStackText(text)
		}, SAFE_STACK_AUTO_IMPORT_DELAY_MS)
		return () => {
			window.clearTimeout(timeout)
		}
	}, [importText.value])

	const { executeTransaction, signTransaction } = createTransactionActions({
		persistStackText,
		stackExport,
		stackVerified,
		verifiedSafeStates,
		account,
		accountInformation,
		stackRevision,
		connectedSafeWalletSigners,
		pendingAction,
		status,
		error,
		signedStackJson,
		submittedExecutions,
		transactionActionErrors,
		walletRequestTimeoutMs,
	})

	const busy = pendingAction.value !== undefined
	const loadingApplicationData = applicationLoading.value
		|| accountInformationLoading.value
		|| stackVerificationLoading.value
		|| safeInformation.value.some(({ loading }) => loading)
	const statusIsLoading = pendingAction.value === 'import' || pendingAction.value === 'read-file'
	const connectedSafeWalletSigner = account.value === undefined
		? undefined
		: connectedSafeWalletSigners.value.find(({ safeAddress }) => safeAddress === account.value)?.signer
	const walletSummaryLoading = walletInformationLoading.value
		|| accountInformationLoading.value
		|| (account.value !== undefined && (walletChainId.value === undefined || accountInformation.value === undefined))
	const walletLoadingLabel = pendingAction.value === 'refresh' ? 'Refreshing…' : 'Loading…'
	const currentConnectedSafeBalances = account.value === undefined || walletChainId.value === undefined
		? undefined
		: connectedSafeBalances.value?.address === account.value && connectedSafeBalances.value.chainId === walletChainId.value
			? connectedSafeBalances.value.balances
			: undefined
	const connectedSafeInformationNativeAsset = account.value === undefined || walletChainId.value === undefined
		? undefined
		: safeInformation.value.find(({ safeAddress, chainId }) => safeAddress === account.value && chainId === walletChainId.value)?.nativeAsset
	const currentWalletNativeAsset = getPreferredNativeAssetBalance(currentConnectedSafeBalances?.native, connectedSafeInformationNativeAsset)
	const executionGasChecks = useExecutionGasChecks(
		stackExport.value,
		account.value,
		walletChainId.value,
		connectedSafeWalletSigners.value,
		verifiedSafeStates.value,
		walletRequestTimeoutMs,
	)
	const saveEthereumRpcUrl = (value: string) => {
		const validatedUrl = validateEthereumRpcUrl(value)
		ethereumRpcUrl.value = validatedUrl
		const persisted = persistEthereumRpcUrl(browserStorage, validatedUrl)
		const loadedStack = stackExport.peek()
		if (loadedStack !== undefined) void refreshSafeInformation(loadedStack, stackRevision.peek())
		return persisted
	}
	const transactionDataMetadata = useTransactionDataMetadata(stackExport.value, walletRequestTimeoutMs)

	return <main class = 'shell' aria-busy = { busy || loadingApplicationData }>
		<header class = 'hero'>
			<div class = 'brand'>
				<img class = 'brand-mark' src = './assets/sealwort-icon.png' alt = '' />
				<div>
					<p class = 'eyebrow'>The Interceptor</p>
					<h1>Sealwort</h1>
					<p class = 'product-type'>Gnosis Safe transaction co-signer</p>
					<p class = 'lede'>Review, independently verify, and sign Interceptor Gnosis Safe transactions</p>
				</div>
			</div>
			<div class = 'hero-controls'>
				<RpcSettings rpcUrl = { ethereumRpcUrl.value } disabled = { busy } onSave = { saveEthereumRpcUrl } />
				<WalletSummary
					loading = { walletSummaryLoading }
					loadingLabel = { walletLoadingLabel }
					busy = { busy }
					applicationLoading = { loadingApplicationData }
					account = { account.value }
					chainId = { walletChainId.value }
					accountInformation = { accountInformation.value }
					activeSigner = { connectedSafeWalletSigner }
					activeSignerLoading = { connectedSafeWalletSignerLoading.value }
					balances = { currentConnectedSafeBalances }
					balancesLoading = { connectedSafeBalancesLoading.value }
					nativeAsset = { currentWalletNativeAsset }
					onConnect = { () => { void connect() } }
					onRefresh = { () => { void refresh() } }
				/>
			</div>
		</header>

		{ loadingApplicationData
			? <div class = 'notice loading' role = 'status' aria-live = 'polite'>
				<LoadingIndicator size = '1.25em'>Loading account, Gnosis Safe information, and stack verification…</LoadingIndicator>
			</div>
			: <></> }

		{ accountInformationLoading.value
			? <></>
			: accountInformation.value?.kind === 'contract'
			? <section class = 'panel' aria-live = 'polite'>
				<p class = 'safe-information-error'>This contract is not recognized as a supported Gnosis Safe: { accountInformation.value.safeReadError }</p>
			</section>
			: accountInformation.value?.kind === 'unavailable'
				? <section class = 'panel' aria-live = 'polite'>
					<p class = 'safe-information-error'>Sealwort could not inspect this account: { accountInformation.value.inspectionError }</p>
				</section>
				: <></> }

		<StackJsonInput
			textareaRef = { importTextarea }
			value = { importText.value }
			expanded = { stackInputExpanded.value }
			disabled = { busy }
			onValueChange = { (value) => { importText.value = value } }
			onToggle = { () => { stackInputExpanded.value = !stackInputExpanded.value } }
			onFileChange = { importFile }
		/>

		{ persistenceWarning.value === undefined ? <></> : <div class = 'notice' role = 'status' aria-live = 'polite'>{ persistenceWarning.value }</div> }
		{ error.value === undefined ? <></> : <div class = 'notice' role = 'alert'>{ error.value }</div> }
		{ status.value === undefined
			? <></>
			: <div class = { `notice ${ statusIsLoading ? 'loading' : 'success' }` } role = 'status' aria-live = 'polite'>
				{ statusIsLoading ? <LoadingIndicator>{ status.value }</LoadingIndicator> : status.value }
			</div> }

		{ stackExport.value === undefined
			? <section class = 'panel'>
				<h2>Start with an Interceptor export</h2>
				<p class = 'muted'>The proposer exports the optimistic Gnosis Safe stack from Interceptor’s Simulation Stack page and sends you that JSON file out of band.</p>
			</section>
			: <div class = 'stacks'>
				{ stackExport.value.stacks.map((stack, stackIndex) => <SafeStackPanel
					key = { `${ stack.chainId.toString() }:${ stack.safeAddress.toString() }` }
					stack = { stack }
					stackIndex = { stackIndex }
					account = { account.value }
					walletChainId = { walletChainId.value }
					accountInformation = { accountInformation.value }
					routedSigner = { connectedSafeWalletSigners.value.find(({ safeAddress }) => safeAddress === stack.safeAddress)?.signer }
					currentSafeInformation = { safeInformation.value.find((information) => information.chainId === stack.chainId && information.safeAddress === stack.safeAddress) }
					currentConnectedSafeBalances = { currentConnectedSafeBalances }
					accountInformationLoading = { accountInformationLoading.value }
					connectedSafeBalancesLoading = { connectedSafeBalancesLoading.value }
					stackVerificationLoading = { stackVerificationLoading.value }
					stackVerified = { stackVerified.value }
					verifiedSafeState = { verifiedSafeStates.value[stackIndex] }
					executionGasChecks = { executionGasChecks.value }
					pendingAction = { pendingAction.value }
					busy = { busy }
					submittedExecutions = { submittedExecutions.value }
					transactionActionErrors = { transactionActionErrors.value }
					transactionDataMetadata = { transactionDataMetadata[stackIndex] ?? [] }
					onSign = { (transactionIndex, executeAfterSigning) => { void signTransaction(stackIndex, transactionIndex, executeAfterSigning) } }
					onExecute = { (transactionIndex) => { void executeTransaction(stackIndex, transactionIndex) } }
				/>) }
				{ signedStackJson.value === undefined ? <></> : <UpdatedStackPanel
					textareaRef = { updatedStackTextarea }
					value = { signedStackJson.value }
					expanded = { updatedStackExpanded.value }
					onToggle = { () => { updatedStackExpanded.value = !updatedStackExpanded.value } }
				/> }
			</div>
		}
		<footer class = 'site-footer'>
			<p>
				Sealwort by <a href = 'https://dark.florist/'>Dark Florist</a>
				{ buildInformation === undefined ? <></> : <> · <BuildInformationLink information = { buildInformation } /></> }
			</p>
			<nav aria-label = 'Dark Florist social links'>
				{ DARK_FLORIST_SOCIAL_LINKS.map((socialLink) =>
					<a href = { socialLink.href } key = { socialLink.label }>{ socialLink.label }</a>
				) }
			</nav>
		</footer>
	</main>
}
