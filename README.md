# Typista

Spell checker using Hunspell dictionaries for checking and BK Tree algorithm for suggestions.

Based on a modernized, TypeScript-friendly version of [cfinke/Typo.js](https://github.com/cfinke/Typo.js) but with a different suggestion implementation, which uses a BK Tree algorithm modified from [jonahharris/node-bktree](https://github.com/jonahharris/node-bktree). The edit distance used for generating and traversing the tree is the Levenshtein implementation from [denoland/std](https://github.com/denoland/std), with results further sorted to give more "human-friendly" suggestion ordering, using [wolfgarbe/SymSpell](https://github.com/wolfgarbe/SymSpell)'s optimized version of Damerau-Levenshtein edit distance (which isn't suitable for BK Tree traversal due to not observing the triangle inequality). 
