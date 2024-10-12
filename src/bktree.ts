// modified from https://github.com/jonahharris/node-bktree/blob/master/lib/bktree.js
// MIT License
// Burkhard-Keller Tree (BK-Tree) Example
// Jonah H. Harris <jonah.harris@gmail.com>

import { levenshteinDistance } from '@std/text/levenshtein-distance'
import { damerauDistance } from './damerauSymSpell.ts'
import { memoize } from '@std/cache/memoize'
import { LruCache } from '@std/cache/lru-cache'
import { lexicographicalCompare } from './utils.ts'

// TODO: fix types in @std/cache/memoize to avoid need for `any`
// deno-lint-ignore no-explicit-any
const normalizationCache = new LruCache<string, any>(1e5)
const normalizeWith = memoize(function normalizeWith(normalizer: Normalizer, str: string) {
	return normalizer(str)
}, { cache: normalizationCache })
type Normalizer = (str: string) => string
// each builds on the previous so each normalization should only be done once (e.g. subsequent normalizations don't both
// need to call `toLowerCase()`)
const normalizers: Normalizer[] = [
	// // seems slow, omit for now
	// (str) => str.normalize(),
	(str) => str.toLowerCase(),
	(str) => str.replaceAll(/(.)\1/gsu, '$1'),
]

export default class BkTree {
	root: string | null
	children: Record<number, BkTree>

	constructor(words: string[]) {
		// https://github.com/jonahharris/node-bktree/pull/1
		const root = words.pop() ?? null

		this.root = root
		this.children = Object.create(null)

		this.addWords(words)
	}

	addWords(terms: string[]) {
		for (const t of terms) {
			this.addWord(t)
		}
	}

	addWord(term: string) {
		if (this.root == null) {
			this.root = term
			return
		}

		const dist = levenshteinDistance(this.root, term)

		const child = this.children[dist]

		if (child == null) {
			this.children[dist] = new BkTree([term])
		} else if (child.root !== term) {
			child.addWord(term)
		} else {
			// word already exists in tree - no-op
		}
	}

	#compare(queryTerm: string) {
		return (a: string, b: string) => {
			if (a === queryTerm) return -1
			if (b === queryTerm) return 1

			let na = a
			let nb = b
			let nQueryTerm = queryTerm

			// prefer words that are normalized to the same thing as the query term
			for (const normalizer of normalizers) {
				na = normalizeWith(normalizer, na)
				nb = normalizeWith(normalizer, nb)
				nQueryTerm = normalizeWith(normalizer, nQueryTerm)

				if (na === nQueryTerm) return -1
				if (nb === nQueryTerm) return 1
			}

			na = a
			nb = b
			nQueryTerm = queryTerm

			// prefer words that have closer Demerau distance to the query term
			for (const normalizer of normalizers) {
				na = normalizeWith(normalizer, na)
				nb = normalizeWith(normalizer, nb)
				nQueryTerm = normalizeWith(normalizer, nQueryTerm)

				const diff = damerauDistance(na, nQueryTerm) - damerauDistance(nb, nQueryTerm)
				if (diff) return diff
			}

			// prefer words that start with a substring of the query term
			for (let i = 0; i < Math.min(a.length, b.length); ++i) {
				const aeq = a[i] === queryTerm[i]
				const beq = b[i] === queryTerm[i]

				if (aeq && !beq) return -1
				if (!aeq && beq) return 1
			}

			// just to ensure that the order is stable
			return lexicographicalCompare(a, b)
		}
	}

	query(queryTerm: string, maxDist: number): string[] {
		const resultsData = this.#query(queryTerm, maxDist).map((x) => x.text).sort(this.#compare(queryTerm))

		return resultsData
	}

	#query(queryTerm: string, maxDist: number, resultsData: { text: string; dist: number }[] = []) {
		if (this.root == null) {
			return resultsData
		}

		const dist = levenshteinDistance(this.root, queryTerm)

		if (dist <= maxDist) {
			resultsData.push({ text: this.root, dist })
		}

		const min = dist - maxDist
		const max = dist + maxDist

		for (let i = min; i <= max; ++i) {
			const child = this.children[i]
			if (child != null) {
				child.#query(queryTerm, maxDist, resultsData)
			}
		}

		return resultsData
	}
}
