// modified from https://github.com/jonahharris/node-bktree/blob/master/lib/bktree.js
// MIT License
// Burkhard-Keller Tree (BK-Tree) Example
// Jonah H. Harris <jonah.harris@gmail.com>

import { levenshteinDistance } from '@std/text/levenshtein-distance'
import { damerauDistance } from './damerauSymSpell.ts'
import { memoize } from '@std/cache/memoize'
import { LruCache } from '@std/cache/lru-cache'

// TODO: fix types in @std/cache/memoize to avoid need for `any`
// deno-lint-ignore no-explicit-any
const normalizationCache = new LruCache<string, any>(1e5)
const normalizeWith = memoize(function normalizeWith(normalizer: Normalizer, str: string) {
	return normalizer(str)
}, { cache: normalizationCache })
type Normalizer = (str: string) => string
const normalizers: Normalizer[] = [
	(str) => str.toLowerCase(),
	(str) => str.toLowerCase().replaceAll(/(.)\1/gsu, '$1'),
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

	#sort(queryTerm: string) {
		return (a: string, b: string) => {
			if (a === queryTerm) return -1
			if (b === queryTerm) return 1

			for (const normalizer of normalizers) {
				if (normalizeWith(normalizer, a) === normalizeWith(normalizer, queryTerm)) return -1
				if (normalizeWith(normalizer, b) === normalizeWith(normalizer, queryTerm)) return 1
			}

			for (const normalizer of normalizers) {
				const dam = damerauDistance(normalizeWith(normalizer, a), normalizeWith(normalizer, queryTerm)) -
					damerauDistance(normalizeWith(normalizer, b), normalizeWith(normalizer, queryTerm))
				if (dam) return dam
			}

			for (let i = 0; i < Math.min(a.length, b.length); i++) {
				const aeq = a[i] === queryTerm[i]
				const beq = b[i] === queryTerm[i]
				if (aeq && !beq) return -1
				if (!aeq && beq) return 1
			}

			// Lexicographical order - not semantically useful, just for sort stability (we use naive version rather than
			// localeCompare for performance)
			return a === b ? 0 : a > b ? 1 : -1
		}
	}

	query(queryTerm: string, maxDist: number): string[] {
		const resultsData = this.#query(queryTerm, maxDist).map((x) => x.text).sort(this.#sort(queryTerm))

		normalizationCache.clear()

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
			if (this.children[i] != null) {
				this.children[i].#query(queryTerm, maxDist, resultsData)
			}
		}

		return resultsData
	}
}
