export interface BuildInformation {
	readonly label: string
	readonly href: string
	readonly fullIdentifier: string
	readonly kind: 'release' | 'commit'
}

export function getBuildInformation(release: string | undefined, commitHash: string, repositoryUrl: string): BuildInformation {
	const normalizedRepositoryUrl = repositoryUrl.replace(/\/$/u, '')
	const normalizedRelease = release?.trim()
	if (normalizedRelease !== undefined && normalizedRelease.length > 0) {
		return {
			kind: 'release',
			label: normalizedRelease,
			fullIdentifier: normalizedRelease,
			href: `${ normalizedRepositoryUrl }/releases/tag/${ encodeURIComponent(normalizedRelease) }`,
		}
	}

	const normalizedCommitHash = commitHash.trim()
	return {
		kind: 'commit',
		label: normalizedCommitHash.slice(0, 7),
		fullIdentifier: normalizedCommitHash,
		href: `${ normalizedRepositoryUrl }/commit/${ encodeURIComponent(normalizedCommitHash) }`,
	}
}

export const BUILD_INFORMATION = getBuildInformation(
	typeof SEALWORT_RELEASE === 'undefined' ? undefined : SEALWORT_RELEASE,
	typeof SEALWORT_COMMIT_HASH === 'undefined' ? 'development' : SEALWORT_COMMIT_HASH,
	typeof SEALWORT_REPOSITORY_URL === 'undefined' ? '' : SEALWORT_REPOSITORY_URL,
)

export function BuildInformationLink({ information = BUILD_INFORMATION }: { readonly information?: BuildInformation }) {
	return <a href = { information.href } title = { information.fullIdentifier }>
		{ information.kind === 'release' ? 'Release' : 'Commit' } { information.label }
	</a>
}
