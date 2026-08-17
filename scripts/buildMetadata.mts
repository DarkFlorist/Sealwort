import { execFileSync } from 'node:child_process'
import path from 'node:path'

export interface BuildMetadata {
	readonly release: string | undefined
	readonly commitHash: string
	readonly repositoryUrl: string
}

type BuildEnvironment = Readonly<Record<string, string | undefined>>
type GitValueReader = (arguments_: readonly string[]) => string | undefined

export function normalizeRepositoryUrl(value: string) {
	const trimmedValue = value.trim()
	const scpMatch = /^[^/@:]+@([^:]+):(.+)$/u.exec(trimmedValue)
	let repositoryUrl: URL
	try {
		if (scpMatch !== null) {
			repositoryUrl = new URL(`https://${ scpMatch[1] }/${ scpMatch[2] }`)
		} else {
			const parsedUrl = new URL(trimmedValue)
			repositoryUrl = parsedUrl.protocol === 'ssh:'
				? new URL(`https://${ parsedUrl.hostname }${ parsedUrl.pathname }`)
				: parsedUrl
		}
	} catch {
		throw new Error(`Build repository URL is invalid: ${ trimmedValue }`)
	}
	if (repositoryUrl.protocol !== 'https:' && repositoryUrl.protocol !== 'http:') {
		throw new Error(`Build repository URL must use HTTP, HTTPS, or SSH: ${ trimmedValue }`)
	}
	repositoryUrl.hash = ''
	repositoryUrl.search = ''
	repositoryUrl.pathname = repositoryUrl.pathname.replace(/\/+$/u, '').replace(/\.git$/u, '')
	return repositoryUrl.href.replace(/\/$/u, '')
}

export function resolveBuildMetadata(environment: BuildEnvironment, readGitValue: GitValueReader, packageRepository: string | undefined): BuildMetadata {
	const release = environment.SEALWORT_RELEASE?.trim()
		|| (environment.GITHUB_REF_TYPE === 'tag' ? environment.GITHUB_REF_NAME?.trim() : undefined)
		|| readGitValue(['describe', '--tags', '--exact-match'])
	const commitHash = environment.SEALWORT_COMMIT_HASH?.trim()
		|| environment.GITHUB_SHA?.trim()
		|| readGitValue(['rev-parse', 'HEAD'])
	const githubRepositoryUrl = environment.GITHUB_SERVER_URL?.trim() !== undefined && environment.GITHUB_REPOSITORY?.trim() !== undefined
		? `${ environment.GITHUB_SERVER_URL.trim() }/${ environment.GITHUB_REPOSITORY.trim() }`
		: undefined
	const repositoryUrlSource = environment.SEALWORT_REPOSITORY_URL?.trim()
		|| githubRepositoryUrl
		|| readGitValue(['remote', 'get-url', 'origin'])
		|| packageRepository

	if (commitHash === undefined || commitHash.length === 0) {
		throw new Error('Build commit information is unavailable. Set SEALWORT_COMMIT_HASH when building outside a Git checkout.')
	}
	if (repositoryUrlSource === undefined || repositoryUrlSource.length === 0) {
		throw new Error('Build repository information is unavailable. Set SEALWORT_REPOSITORY_URL when building outside a Git checkout.')
	}
	return { release, commitHash, repositoryUrl: normalizeRepositoryUrl(repositoryUrlSource) }
}

export async function readBuildMetadata(repositoryRoot: string, environment: BuildEnvironment = process.env) {
	const readGitValue: GitValueReader = (arguments_) => {
		try {
			return execFileSync('git', arguments_, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		} catch {
			return undefined
		}
	}
	const packageMetadata: unknown = await Bun.file(path.join(repositoryRoot, 'package.json')).json()
	const packageRepository = typeof packageMetadata === 'object' && packageMetadata !== null && 'repository' in packageMetadata && typeof packageMetadata.repository === 'string'
		? packageMetadata.repository
		: undefined
	return resolveBuildMetadata(environment, readGitValue, packageRepository)
}
