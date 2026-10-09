import nspell from 'nspell';

const wordBoundary = pattern => `(?<![\\p{L}\\p{M}])${pattern}(?![\\p{L}\\p{M}])`;
const grammar = [
  ['by\\s+jste', 'byste'], ['by\\s+jsme', 'bychom'], ['by\\s+jsi', 'bys'],
  ['aby\\s+jste', 'abyste'], ['aby\\s+jsme', 'abychom'], ['aby\\s+jsem', 'abych'], ['aby\\s+jsi', 'abys'],
  ['kdyby\\s+jste', 'kdybyste'], ['kdyby\\s+jsme', 'kdybychom'], ['kdyby\\s+jsem', 'kdybych'], ['kdyby\\s+jsi', 'kdybys'],
  ['více\\s+lepší', 'lepší'], ['nejvíce\\s+nejlepší', 'nejlepší'],
].map(([pattern, replacement]) => [new RegExp(wordBoundary(pattern), 'giu'), replacement]);
const style = [
  ['v\\s+současné\\s+době', 'nyní'], ['v\\s+tomto\\s+okamžiku', 'teď'],
  ['z\\s+důvodu\\s+toho,\\s+že', 'protože'], ['osobně\\s+si\\s+myslím', 'myslím'],
  ['v\\s+každém\\s+případě', 'každopádně'],
].map(([pattern, replacement]) => [new RegExp(wordBoundary(pattern), 'giu'), replacement]);
const commonTypos = new Map(Object.entries({vyjímka: 'výjimka', standartní: 'standardní',
  samozdřejmě: 'samozřejmě', nashledanou: 'na shledanou', narozdíl: 'na rozdíl', mimojiné: 'mimo jiné'}));

export function createChecker(aff, dic) {
  const dictionary = nspell(aff, dic);
  const correctCache = new Map();
  const suggestionCache = new Map();
  const correct = word => {
    if (!correctCache.has(word)) {
      if (correctCache.size >= 50000) correctCache.clear();
      correctCache.set(word, dictionary.correct(word.normalize('NFC')));
    }
    return correctCache.get(word);
  };
  const suggestions = word => {
    if (!suggestionCache.has(word)) {
      if (suggestionCache.size >= 10000) suggestionCache.clear();
      suggestionCache.set(word, dictionary.suggest(word).slice(0, 3));
    }
    return suggestionCache.get(word);
  };
  return {correct, check(text, {stylistic = false, ignoredWords = []} = {}) {
    const findings = [];
    const occupied = [];
    const overlaps = (start, end, ranges) => ranges.some(([left, right]) => start < right && end > left);
    const add = (start, end, category, replacement, message) => {
      if (overlaps(start, end, occupied)) return;
      const original = text.slice(start, end);
      if (/^\p{Lu}/u.test(original) && replacement) replacement = replacement[0].toLocaleUpperCase('cs') + replacement.slice(1);
      findings.push({start, end, category, original, replacement, message});
      occupied.push([start, end]);
    };
    for (const [pattern, replacement] of grammar) {
      for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length,
        'Gramatika', replacement, `Běžný chybný gramatický tvar. Spisovná podoba: ${replacement}.`);
    }
    for (const match of text.matchAll(/(?<![\p{L}\p{M}])([\p{L}\p{M}]+)\s+\1(?![\p{L}\p{M}])/giu)) {
      add(match.index, match.index + match[0].length, 'Gramatika', match[1],
        'Stejné slovo se opakuje bezprostředně za sebou; ověřte, zda je opakování záměrné.');
    }
    const protectedRanges = [...text.matchAll(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[\w]+/gu)]
      .map(match => [match.index, match.index + match[0].length]);
    const ignored = new Set(ignoredWords.map(word => word.toLocaleLowerCase('cs')));
    for (const match of text.matchAll(/[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)?/gu)) {
      const word = match[0], start = match.index, end = start + word.length;
      if (word.length < 2 || word.length > 64 || word === word.toLocaleUpperCase('cs')
          || ignored.has(word.toLocaleLowerCase('cs')) || overlaps(start, end, [...protectedRanges, ...occupied])) continue;
      const known = commonTypos.get(word.toLocaleLowerCase('cs'));
      if (known) add(start, end, 'Pravopis', known, 'Běžná pravopisná chyba.');
      else if (!correct(word)) {
        const candidates = suggestions(word);
        add(start, end, 'Pravopis', candidates[0] || '', 'Slovo není v českém slovníku. Ověřte vlastní jména a odborné výrazy.'
          + (candidates.length ? ` Možnosti: ${candidates.join(', ')}.` : ''));
      }
    }
    for (const match of text.matchAll(/(?<=\S)[ \t]+(?=[,.;:!?])/gu)) {
      add(match.index, match.index + match[0].length, 'Interpunkce', '', 'Před tímto znaménkem nemá být mezera.');
    }
    for (const match of text.matchAll(/[,;:!?](?=[\p{L}\p{M}])/gu)) {
      if (!overlaps(match.index, match.index + 1, protectedRanges)) {
        add(match.index, match.index + 1, 'Interpunkce', match[0] + ' ', 'Za interpunkčním znaménkem chybí mezera.');
      }
    }
    for (const match of text.matchAll(/([,;:])\1+/gu)) add(match.index, match.index + match[0].length,
      'Interpunkce', match[1], 'Opakované interpunkční znaménko.');
    for (const match of text.matchAll(/(?<=\S)[ \t]{2,}(?=\S)/gu)) add(match.index, match.index + match[0].length,
      'Typografie', ' ', 'Vícenásobná mezera uvnitř řádku; ověřte, zda není součástí sazby.');
    if (stylistic) for (const [pattern, replacement] of style) {
      for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length,
        'Stylistika', replacement, 'Volitelné zkrácení formulace. Použijte jen pokud zachová význam a autorský hlas.');
    }
    return findings.sort((a, b) => a.start - b.start || a.end - b.end);
  }};
}
