export interface BuildInformation {
	readonly label: string
	readonly href: string
	readonly fullIdentifier: string
	readonly kind: 'release' | 'commit'
}

export function getBuildInformation(release: string | undefined, commitHash: string | undefined, repositoryUrl: string | undefined): BuildInformation | undefined {
	const normalizedRepositoryUrl = repositoryUrl?.trim()
	if (normalizedRepositoryUrl === undefined || normalizedRepositoryUrl.length === 0) return undefined

	const normalizedRelease = release?.trim()
	if (normalizedRelease !== undefined && normalizedRelease.length > 0) {
		return {
			kind: 'release',
			label: normalizedRelease,
			fullIdentifier: normalizedRelease,
			href: `${ normalizedRepositoryUrl }/releases/tag/${ encodeURIComponent(normalizedRelease) }`,
		}
	}

	const normalizedCommitHash = commitHash?.trim()
	if (normalizedCommitHash === undefined || normalizedCommitHash.length === 0) return undefined
	return {
		kind: 'commit',
		label: normalizedCommitHash.slice(0, 7),
		fullIdentifier: normalizedCommitHash,
		href: `${ normalizedRepositoryUrl }/commit/${ encodeURIComponent(normalizedCommitHash) }`,
	}
}

export function BuildInformationLink({ information }: { readonly information: BuildInformation }) {
	return <a href = { information.href } title = { information.fullIdentifier }>
		{ information.kind === 'release' ? 'Release' : 'Commit' } { information.label }
	</a>
}
