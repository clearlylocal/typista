/**
 * Lexicographical order - not semantically useful, just for sort stability (we use naive version rather than
 * localeCompare for performance)
 */
export function lexicographicalCompare(a: string, b: string) {
	return a === b ? 0 : a > b ? 1 : -1
}
