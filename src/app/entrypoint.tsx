import { bootstrapApplication } from './bootstrap.js'
import { getBuildInformation } from './buildInformation.js'

declare const SEALWORT_BUILD_RELEASE: string
declare const SEALWORT_BUILD_COMMIT_HASH: string
declare const SEALWORT_BUILD_REPOSITORY_URL: string

bootstrapApplication(getBuildInformation(
	SEALWORT_BUILD_RELEASE,
	SEALWORT_BUILD_COMMIT_HASH,
	SEALWORT_BUILD_REPOSITORY_URL,
))
