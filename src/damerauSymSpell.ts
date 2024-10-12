// Ported and modified from https://github.com/wolfgarbe/SymSpell
// MIT License (Copyright (c) 2018 Wolf Garbe)

type UintArray = InstanceType<typeof UintArray>
const UintArray = Uint16Array satisfies Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor

const SIZE = 65536

let baseChar1Costs = new UintArray(SIZE)
let basePrevChar1Costs = new UintArray(SIZE)

/**
 * Calculates starting position and lengths of two strings such that common
 * prefix and suffix substrings are excluded.
 * Expects ch1.length to be less than or equal to ch2.length
 */
function prefixSuffixPrep(chars1: string[], chars2: string[]): { len1: number; len2: number; start: number } {
	let len2 = chars2.length
	let len1 = chars1.length // this is also the minimum length of the two strings
	// suffix common to both strings can be ignored
	while (len1 !== 0 && chars1[len1 - 1] === chars2[len2 - 1]) {
		len1 = len1 - 1
		len2 = len2 - 1
	}
	// prefix common to both strings can be ignored
	let start = 0
	while (start !== len1 && chars1[start] === chars2[start]) start++
	if (start !== 0) {
		len2 -= start // length of the part excluding common prefix and suffix
		len1 -= start
	}

	return { len1, len2, start }
}

export function damerauDistance(str1: string, str2: string): number {
	let chars1 = [...str1]
	let chars2 = [...str2]

	if (chars1.length > chars2.length) {
		;[chars1, chars2] = [chars2, chars1]
	}

	if (!chars1.length) return chars2.length

	const { len1, len2, start } = prefixSuffixPrep(chars1, chars2)

	if (len1 === 0) return len2

	if (len2 > baseChar1Costs.length) {
		baseChar1Costs = new UintArray(len2)
		basePrevChar1Costs = new UintArray(len2)
	}

	return distanceInternal(chars1, chars2, len1, len2, start, baseChar1Costs, basePrevChar1Costs)
}

const NULL_CHAR = '\x00'

function distanceInternal(
	chars1: string[],
	chars2: string[],
	len1: number,
	len2: number,
	start: number,
	char1Costs: UintArray,
	prevChar1Costs: UintArray,
): number {
	let j: number
	for (j = 0; j < len2;) char1Costs[j] = ++j
	let char1 = NULL_CHAR
	let currentCost = 0
	for (let i = 0; i < len1; ++i) {
		const prevChar1 = char1
		char1 = chars1[start + i]
		let char2 = NULL_CHAR
		let leftCharCost, aboveCharCost
		leftCharCost = aboveCharCost = i
		let nextTransCost = 0
		for (j = 0; j < len2; ++j) {
			const thisTransCost = nextTransCost
			nextTransCost = prevChar1Costs[j]
			prevChar1Costs[j] = currentCost = leftCharCost // cost of diagonal (substitution)
			leftCharCost = char1Costs[j] // left now equals current cost (which will be diagonal at next iteration)
			const prevChar2 = char2
			char2 = chars2[start + j]
			if (char1 !== char2) {
				if (aboveCharCost < currentCost) currentCost = aboveCharCost // deletion
				if (leftCharCost < currentCost) currentCost = leftCharCost // insertion
				++currentCost
				if (
					(i !== 0) && (j !== 0) &&
					(char1 === prevChar2) &&
					(prevChar1 === char2) &&
					(thisTransCost + 1 < currentCost)
				) {
					currentCost = thisTransCost + 1 // transposition
				}
			}
			char1Costs[j] = aboveCharCost = currentCost
		}
	}
	return currentCost
}
