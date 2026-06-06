// Self-test for searchCore.js
// Run: node --experimental-vm-modules src/search/searchCore.selftest.js
import { buildIndex, search, rerank } from './searchCore.js';

let passed = 0;
let failed = 0;

function assert(desc, condition) {
    if (condition) {
        console.log(`\u2713 ${desc}`);
        passed++;
    } else {
        console.error(`\u2717 ${desc}`);
        failed++;
    }
}

const TRACKS = [
    { id: 1, title: 'Bohemian Rhapsody', artist: 'Queen' },
    { id: 2, title: 'Bohemian', artist: 'Some Artist' },
    { id: 3, title: 'Rhapsody in Blue', artist: 'Gershwin' },
    { id: 4, title: '\u041B\u044E\u0431\u043E\u0432\u044C', artist: '\u0410\u0440\u0442\u0451\u043C' },
    { id: 5, title: '\u041B\u044E\u0431\u043E\u0432\u044C \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430', artist: '\u0414\u0440\u0443\u0433\u043E\u0439 \u0410\u0440\u0442\u0438\u0441\u0442' },
    { id: 6, title: 'Something Else', artist: 'Bohemian Artist' },
    { id: 7, title: '\u0401\u0436\u0438\u043A', artist: '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E' },
    { id: 8, title: '\u0415\u0436\u0438\u043A \u0432 \u0442\u0443\u043C\u0430\u043D\u0435', artist: '\u0421\u043E\u044E\u0437\u043C\u0443\u043B\u044C\u0442\u0444\u0438\u043B\u044C\u043C' },
    { id: 9, title: 'Prefix Song', artist: 'Artist Name' },
    { id: 10, title: 'prefix extended song', artist: 'Another' },
];

const INDEX = buildIndex(TRACKS);

const r1 = search(INDEX, 'Bohemian Rhapsody');
assert('exact title match is first (id=1)', r1[0]?.id === 1);

const r2 = search(INDEX, 'Bohemian');
const titleIds = r2.filter((x) => x.title.toLowerCase().includes('bohemian')).map((x) => x.id);
const artistOnlyId = 6;
const worstTitlePos = Math.max(...titleIds.map((id) => r2.findIndex((x) => x.id === id)));
const artistOnlyPos = r2.findIndex((x) => x.id === artistOnlyId);
assert('title matches rank above artist-only match', worstTitlePos < artistOnlyPos || artistOnlyPos === -1);

const r3 = search(INDEX, '\u0435\u0436\u0438\u043A');
const ids3 = r3.map((x) => x.id);
assert('yo to e normalisation: id=7 found', ids3.includes(7));
assert('yo to e normalisation: id=8 found', ids3.includes(8));

const r4a = search(INDEX, '\u041B\u044E\u0431\u043E\u0432\u044C').map((x) => x.id).join(',');
const r4b = search(INDEX, '\u041B\u044E\u0431\u043E\u0432\u044C').map((x) => x.id).join(',');
assert('determinism: same query gives same ordered output', r4a === r4b);

assert('empty query returns []', search(INDEX, '').length === 0);

const r6 = search(INDEX, '\u041B\u044E\u0431');
assert('prefix match: id=4 found', r6.some((x) => x.id === 4));
assert('prefix match: id=5 found', r6.some((x) => x.id === 5));

const r7 = search(INDEX, 'Prefix Song');
const exactPos = r7.findIndex((x) => x.id === 9);
const prefixPos = r7.findIndex((x) => x.id === 10);
assert('exact title (id=9) before prefix match (id=10)', exactPos < prefixPos || prefixPos === -1);

const small = TRACKS.slice(0, 4);
const reranked = rerank(small, 'Bohemian');
assert('rerank returns same count', reranked.length === small.length);
assert('rerank: Bohemian Rhapsody is first', reranked[0]?.id === 1);

assert('null dataset: buildIndex([null]) no throw', (() => { try { buildIndex([null]); return true; } catch { return false; } })());
assert('undefined query: search no throw', (() => { try { search(INDEX, undefined); return true; } catch { return false; } })());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
