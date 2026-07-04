/**
 * Spaceless-pinyin segmentation for the dictionary search's stage-2 + stage-3 fallbacks
 * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md).
 *
 * `segmentPinyin` tiles a spaceless (or messily-spaced) pinyin string such as "jianshen" or
 * "jian4shen1" into its constituent Mandarin syllables. It enumerates **every** valid tiling,
 * not a single greedy one, because some syllables double as *starter* segments a previous
 * syllable could also have absorbed — e.g. "an" in "xian" (["xian"] vs ["xi","an"]), or "ang",
 * "en", "er", "ou". Greedy max-munch would silently drop the alternative real word, so we return
 * both parses and let the caller search each. (This is the pinyin analogue of the "xi'an" vs
 * "xian" apostrophe ambiguity, resolved here by trying every branch.)
 *
 * Tone digits (0–5) are supported: a digit binds to the syllable it immediately follows
 * ("jian4shen1" -> ["jian4","shen1"]). `isAllPinyin` gates whether the search UI offers the
 * "AI" synthetic-entry button.
 */

// Canonical atonal Hanyu Pinyin syllabary (~410 syllables). ü is written `v` to match how the
// `numberedPinyin` column stores it (e.g. 女 = "nv3", 旅 = "lv3") — the segmenter's output is fed
// straight into `buildNumberedPinyinPattern`, which matches against that column.
const SYLLABLE_LIST = [
  // zero-initial
  'a', 'ai', 'an', 'ang', 'ao', 'e', 'ei', 'en', 'eng', 'er', 'o', 'ou',
  // b
  'ba', 'bo', 'bai', 'bei', 'bao', 'ban', 'ben', 'bang', 'beng', 'bi', 'bie', 'biao', 'bian', 'bin', 'bing', 'bu',
  // p
  'pa', 'po', 'pai', 'pei', 'pao', 'pou', 'pan', 'pen', 'pang', 'peng', 'pi', 'pie', 'piao', 'pian', 'pin', 'ping', 'pu',
  // m
  'ma', 'mo', 'me', 'mai', 'mei', 'mao', 'mou', 'man', 'men', 'mang', 'meng', 'mi', 'mie', 'miao', 'miu', 'mian', 'min', 'ming', 'mu',
  // f
  'fa', 'fo', 'fei', 'fou', 'fan', 'fen', 'fang', 'feng', 'fu',
  // d
  'da', 'de', 'dai', 'dei', 'dao', 'dou', 'dan', 'den', 'dang', 'deng', 'dong', 'di', 'die', 'diao', 'diu', 'dian', 'ding', 'du', 'duo', 'dui', 'duan', 'dun',
  // t
  'ta', 'te', 'tai', 'tao', 'tou', 'tan', 'tang', 'teng', 'tong', 'ti', 'tie', 'tiao', 'tian', 'ting', 'tu', 'tuo', 'tui', 'tuan', 'tun',
  // n
  'na', 'ne', 'nai', 'nei', 'nao', 'nou', 'nan', 'nen', 'nang', 'neng', 'nong', 'ni', 'nie', 'niao', 'niu', 'nian', 'nin', 'niang', 'ning', 'nu', 'nuo', 'nuan', 'nun', 'nv', 'nve',
  // l
  'la', 'le', 'lai', 'lei', 'lao', 'lou', 'lan', 'lang', 'leng', 'long', 'li', 'lia', 'lie', 'liao', 'liu', 'lian', 'lin', 'liang', 'ling', 'lo', 'lu', 'luo', 'luan', 'lun', 'lv', 'lve',
  // g
  'ga', 'ge', 'gai', 'gei', 'gao', 'gou', 'gan', 'gen', 'gang', 'geng', 'gong', 'gu', 'gua', 'guo', 'guai', 'gui', 'guan', 'gun', 'guang',
  // k
  'ka', 'ke', 'kai', 'kei', 'kao', 'kou', 'kan', 'ken', 'kang', 'keng', 'kong', 'ku', 'kua', 'kuo', 'kuai', 'kui', 'kuan', 'kun', 'kuang',
  // h
  'ha', 'he', 'hai', 'hei', 'hao', 'hou', 'han', 'hen', 'hang', 'heng', 'hong', 'hu', 'hua', 'huo', 'huai', 'hui', 'huan', 'hun', 'huang',
  // j
  'ji', 'jia', 'jie', 'jiao', 'jiu', 'jian', 'jin', 'jiang', 'jing', 'jiong', 'ju', 'jue', 'juan', 'jun',
  // q
  'qi', 'qia', 'qie', 'qiao', 'qiu', 'qian', 'qin', 'qiang', 'qing', 'qiong', 'qu', 'que', 'quan', 'qun',
  // x
  'xi', 'xia', 'xie', 'xiao', 'xiu', 'xian', 'xin', 'xiang', 'xing', 'xiong', 'xu', 'xue', 'xuan', 'xun',
  // zh
  'zha', 'zhe', 'zhi', 'zhai', 'zhei', 'zhao', 'zhou', 'zhan', 'zhen', 'zhang', 'zheng', 'zhong', 'zhu', 'zhua', 'zhuo', 'zhuai', 'zhui', 'zhuan', 'zhun', 'zhuang',
  // ch
  'cha', 'che', 'chi', 'chai', 'chao', 'chou', 'chan', 'chen', 'chang', 'cheng', 'chong', 'chu', 'chua', 'chuo', 'chuai', 'chui', 'chuan', 'chun', 'chuang',
  // sh
  'sha', 'she', 'shi', 'shai', 'shei', 'shao', 'shou', 'shan', 'shen', 'shang', 'sheng', 'shu', 'shua', 'shuo', 'shuai', 'shui', 'shuan', 'shun', 'shuang',
  // r
  're', 'ri', 'rao', 'rou', 'ran', 'ren', 'rang', 'reng', 'rong', 'ru', 'rua', 'ruo', 'rui', 'ruan', 'run',
  // z
  'za', 'ze', 'zi', 'zai', 'zei', 'zao', 'zou', 'zan', 'zen', 'zang', 'zeng', 'zong', 'zu', 'zuo', 'zui', 'zuan', 'zun',
  // c
  'ca', 'ce', 'ci', 'cai', 'cao', 'cou', 'can', 'cen', 'cang', 'ceng', 'cong', 'cu', 'cuo', 'cui', 'cuan', 'cun',
  // s
  'sa', 'se', 'si', 'sai', 'sao', 'sou', 'san', 'sen', 'sang', 'seng', 'song', 'su', 'suo', 'sui', 'suan', 'sun',
  // y
  'ya', 'ye', 'yao', 'you', 'yan', 'yang', 'yi', 'yin', 'ying', 'yong', 'yo', 'yu', 'yue', 'yuan', 'yun',
  // w
  'wa', 'wo', 'wai', 'wei', 'wan', 'wen', 'wang', 'weng', 'wu',
];

// Grouped by first letter for a cheaper prefix scan (input is short, but this keeps the inner
// loop tight). Within a group, longest syllables first so tilings are enumerated most-greedy-first.
const SYLLABLES_BY_FIRST = new Map<string, string[]>();
for (const syl of SYLLABLE_LIST) {
  const key = syl[0];
  const bucket = SYLLABLES_BY_FIRST.get(key);
  if (bucket) bucket.push(syl);
  else SYLLABLES_BY_FIRST.set(key, [syl]);
}
for (const bucket of SYLLABLES_BY_FIRST.values()) {
  bucket.sort((a, b) => b.length - a.length);
}

// Safety cap so a pathological input can't blow up into thousands of tilings.
const MAX_TILINGS = 50;

/**
 * Enumerate every valid syllable tiling of `input` (whitespace-insensitive). Each returned tiling
 * is an ordered list of syllable tokens, each token being a syllable optionally carrying a trailing
 * tone digit (e.g. "jian4"). Returns `[]` when the string can't be fully tiled into valid pinyin.
 */
export function segmentPinyin(input: string): string[][] {
  const s = input.toLowerCase().replace(/\s+/g, '');
  if (!s) return [];

  // Backtracking with memoization on the start position. rec(pos) = every tiling of s[pos..].
  const memo = new Map<number, string[][]>();

  function rec(pos: number): string[][] {
    if (pos === s.length) return [[]];
    const cached = memo.get(pos);
    if (cached) return cached;

    const out: string[][] = [];
    const bucket = SYLLABLES_BY_FIRST.get(s[pos]);
    if (bucket) {
      for (const syl of bucket) {
        if (!s.startsWith(syl, pos)) continue;
        let next = pos + syl.length;
        let token = syl;
        // A tone digit (0–5) can't begin a syllable, so it always binds to the one just matched.
        const digit = s[next];
        if (digit >= '0' && digit <= '5') {
          token = syl + digit;
          next += 1;
        }
        for (const rest of rec(next)) {
          out.push([token, ...rest]);
          if (out.length >= MAX_TILINGS) break;
        }
        if (out.length >= MAX_TILINGS) break;
      }
    }

    memo.set(pos, out);
    return out;
  }

  return rec(0);
}

/**
 * True iff `input` is entirely pinyin-formatted (tile-able into valid syllables, tone digits
 * allowed). Gates the dictionary search's "AI" synthetic-entry button.
 */
export function isAllPinyin(input: string): boolean {
  return segmentPinyin(input).length > 0;
}
