// Canonical modern kana rows shared by the reference and static pronunciation whitelist.
export type KanaEntry = { kana: string; reading: string };
export type KanaRow = { label: string; cells: (KanaEntry | null)[] };
export type KanaAudioEntry = { soundKey: string; audioUrl: string } | { soundKey: null; unavailableReason: string };
export interface KanaAudioManifest { voice: string; rate: number; pronunciationReview: 'not-human-reviewed'; entries: Record<string, KanaAudioEntry> }
const rows = (definitions: [string, string][]): KanaRow[] => definitions.map(([label, value]) => ({ label, cells: value.split(' ').map(cell => cell === '-' ? null : { kana: cell.split(':')[0]!, reading: cell.split(':')[1] ?? '' }) }));

export const basicKana = rows([
  ['あ行', 'あ:a い:i う:u え:e お:o'], ['か行', 'か:ka き:ki く:ku け:ke こ:ko'],
  ['さ行', 'さ:sa し:shi す:su せ:se そ:so'], ['た行', 'た:ta ち:chi つ:tsu て:te と:to'],
  ['な行', 'な:na に:ni ぬ:nu ね:ne の:no'], ['は行', 'は:ha ひ:hi ふ:fu へ:he ほ:ho'],
  ['ま行', 'ま:ma み:mi む:mu め:me も:mo'], ['や行', 'や:ya - ゆ:yu - よ:yo'],
  ['ら行', 'ら:ra り:ri る:ru れ:re ろ:ro'], ['わ行', 'わ:wa - - - を:o'], ['ん', 'ん:n - - - -'],
]);
export const voicedKana = rows([
  ['が行', 'が:ga ぎ:gi ぐ:gu げ:ge ご:go'], ['ざ行', 'ざ:za じ:ji ず:zu ぜ:ze ぞ:zo'],
  ['だ行', 'だ:da ぢ:ji づ:zu で:de ど:do'], ['ば行', 'ば:ba び:bi ぶ:bu べ:be ぼ:bo'],
  ['ぱ行', 'ぱ:pa ぴ:pi ぷ:pu ぺ:pe ぽ:po'],
]);
export const yoonKana = rows([
  ['きゃ行', 'きゃ:kya きゅ:kyu きょ:kyo'], ['しゃ行', 'しゃ:sha しゅ:shu しょ:sho'],
  ['ちゃ行', 'ちゃ:cha ちゅ:chu ちょ:cho'], ['にゃ行', 'にゃ:nya にゅ:nyu にょ:nyo'],
  ['ひゃ行', 'ひゃ:hya ひゅ:hyu ひょ:hyo'], ['みゃ行', 'みゃ:mya みゅ:myu みょ:myo'],
  ['りゃ行', 'りゃ:rya りゅ:ryu りょ:ryo'], ['ぎゃ行', 'ぎゃ:gya ぎゅ:gyu ぎょ:gyo'],
  ['じゃ行', 'じゃ:ja じゅ:ju じょ:jo'], ['びゃ行', 'びゃ:bya びゅ:byu びょ:byo'],
  ['ぴゃ行', 'ぴゃ:pya ぴゅ:pyu ぴょ:pyo'],
]);
export const smallKana = rows([['小文字', 'ぁ:a ぃ:i ぅ:u ぇ:e ぉ:o'], ['小文字', 'ゃ:ya ゅ:yu ょ:yo っ: ゎ:wa']]);
export const katakana = (value: string): string => [...value].map(character => { const code = character.codePointAt(0)!; return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : character; }).join('');
