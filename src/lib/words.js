// Counting words the same way in both editors: a word starts with a letter or a digit and may carry
// apostrophes, hyphens and the like inside it ("don't", "2026-11-08", "e.g.").
export const countWords = (text) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,:]*/gu) || []).length;
