import {francAll} from 'franc-all';

export const categories = ['Pravopis', 'Gramatika', 'Interpunkce', 'Velká a malá písmena', 'Typografie', 'Stylistika', 'Smysl vět'];
const boundary = value => `(?<![\\p{L}\\p{M}])${value}(?![\\p{L}\\p{M}])`;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const quotePatterns = [/„[^“]*“/gu, /“[^”]*”/gu, /«[^»]*»/gu, /"[^"\n]+"/gu];
const abbreviations = /(?<![\p{L}\p{M}])(?:PhDr\.|RNDr\.|MUDr\.|JUDr\.|ThDr\.|Ph\.D\.|DiS\.|Ing\.|Mgr\.|Bc\.|doc\.|prof\.|sv\.|str\.|č\.[ \t]*p\.|čp\.|č\.|např\.|tj\.|tzn\.|tzv\.|aj\.|apod\.|atd\.|srov\.|r\.|s\.|\p{Lu}{2,}\b|(?:\p{Lu}\.[ \t]*){1,4})/gu;
const foreignHints = /\b(?:Guten|Danke|bonjour|merci|français|English|Deutsch|veni|vidi|vici|aeternum|rebus|ceteris)\b/iu;

export function language(text) {
  const scores = francAll(text, {only: ['ces', 'deu', 'fra', 'lat', 'eng'], minLength: 10});
  return {code: scores[0]?.[0] || 'und', margin: (scores[0]?.[1] || 0) - (scores[1]?.[1] || 0)};
}
export function protectText(text, {ignoredWords = [], isKnown = () => false, commonTypos = []} = {}) {
  const spans = [];
  const add = (start, end, kind) => {
    if (!spans.some(span => span.start === start && span.end === end && span.kind === kind))
      spans.push({start, end, kind, text: text.slice(start, end)});
  };
  const quoteRanges = [];
  for (const pattern of quotePatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      // The Czech closing “ is also an English opening mark. Revisit the
      // remaining text instead of swallowing everything up to a later ”.
      const occupied = quoteRanges.find(range => match.index >= range.start && match.index < range.end);
      if (occupied) { pattern.lastIndex = occupied.end; continue; }
      quoteRanges.push({start: match.index, end: match.index + match[0].length});
      const inside = match[0].slice(1, -1), detected = language(inside);
      // Short language guesses are unreliable: keep uncertain quotations intact.
      if (inside.length < 80 || detected.code !== 'ces' || detected.margin < .18 || foreignHints.test(inside))
        add(match.index, match.index + match[0].length, 'quotation');
    }
  }
  for (const match of text.matchAll(abbreviations)) add(match.index, match.index + match[0].length, 'abbreviation');
  for (const term of ignoredWords.filter(Boolean)) {
    for (const match of text.matchAll(new RegExp(boundary(escape(term)), 'giu')))
      add(match.index, match.index + match[0].length, 'user');
  }
  const typoSet = new Set(commonTypos.map(term => term.toLocaleLowerCase('cs')));
  for (const match of text.matchAll(/(?<![\p{L}\p{M}])\p{Lu}[\p{L}\p{M}'’-]+/gu)) {
    const word = match[0];
    if (!isKnown(word.toLocaleLowerCase('cs')) && !typoSet.has(word.toLocaleLowerCase('cs')))
      add(match.index, match.index + word.length, 'name');
  }
  for (const match of text.matchAll(/\p{Lu}[\p{L}\p{M}]+(?:\s+(?:(?:nad|pod|u|na|v|ve|z|ze)\s+)?\p{Lu}[\p{L}\p{M}]+)+/gu))
    add(match.index, match.index + match[0].length, 'name');
  for (const match of text.matchAll(/(?:pan|paní|rod|rodina|město|obec|ves|vsi|kněz|opat)\s+(\p{Lu}[\p{L}\p{M}]+)/gu)) {
    const start = match.index + match[0].length - match[1].length; add(start, start + match[1].length, 'name');
  }
  let offset = 0;
  for (const paragraph of text.split(/\n\n/u)) {
    const detected = language(paragraph);
    if (paragraph.trim().length >= 120 && detected.code !== 'ces' && detected.code !== 'und' && detected.margin > .18)
      add(offset, offset + paragraph.length, 'foreign');
    offset += paragraph.length + 2;
  }
  return spans;
}

export function preservesProtected(text, edit, spans) {
  const sameCaseOnly = edit.category === 'Velká a malá písmena'
    && edit.original.toLocaleLowerCase('cs') === edit.replacement?.toLocaleLowerCase('cs');
  for (const span of spans) {
    if (edit.start >= span.end || edit.end <= span.start) continue;
    if (sameCaseOnly && span.kind === 'name') continue;
    if ((span.kind === 'quotation' || span.kind === 'foreign') && (edit.start > span.start || edit.end < span.end)) return false;
    const left = Math.max(span.start, edit.start), right = Math.min(span.end, edit.end);
    const fragment = text.slice(left, right);
    if (edit.replacement == null) {
      if (span.kind === 'quotation' || span.kind === 'foreign') return false;
      continue;
    }
    const insensitive = span.kind === 'name';
    const needle = insensitive ? fragment.toLocaleLowerCase('cs') : fragment;
    const replacement = insensitive ? edit.replacement.toLocaleLowerCase('cs') : edit.replacement;
    const original = insensitive ? edit.original.toLocaleLowerCase('cs') : edit.original;
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}])${escape(needle)}(?![\\p{L}\\p{M}])`, 'gu');
    const count = value => [...value.matchAll(pattern)].length;
    if (!needle || !count(original) || count(replacement) < count(original)) return false;
  }
  return true;
}
