// Minimal ambient declaration for the plain-JS server/anidap.js module.
// Mirrors server/filler-lib.d.ts so test files can import the module without
// TS7016. Only the surface used by tests is typed — the module itself stays JS.

export function markChad429(retryAfterMs: number): void
export function isChad429Blocked(): boolean
export function getChad429Remaining(): number
export function chadRetryAfterMs(body: string): number
export function markProviderRateLimited(provider: string, seconds?: number): void
export function isProviderRateLimited(provider: string): boolean
export function markRateLimited(seconds?: number, provider?: string | null): void
export function isRateLimited(): boolean
export function getRateLimitRemaining(): number
export function isChadBlocked(): boolean
export function hasConfirmedNoStream(id: number, ep: number, provider: string, type: string): boolean
export function getAllKnownProviders(): unknown
export function updateServerHealth(name: string, type: string, ok: boolean): void
export function getServerHealth(name: string, type: string): unknown
