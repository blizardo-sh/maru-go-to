import { expect, test } from 'bun:test';
import { defaultCatalog } from '../src/shared/catalog';
import { kanaEntries } from '../src/shared/kana-study';
import { kanaMnemonics, kanaMnemonic } from '../src/shared/kana-mnemonics';
import { katakana } from '../src/shared/kana';
import { kanaSubmissionSchema } from '../src/server/kana';
test('all 92 basic kana have unique atlas cells and explanatory Russian captions',async()=>{
 const basic=defaultCatalog.kana.basic.flatMap(row=>row.cells.flatMap(entry=>entry?[entry.kana]:[]));
 expect(basic.length).toBe(46);expect(Object.keys(kanaMnemonics)).toHaveLength(92);
 const cells=new Set<string>();for(const glyph of basic.flatMap(glyph=>[glyph,katakana(glyph)])){
  const entry=kanaMnemonic(glyph)!;expect(entry.glyph).toBe(glyph);expect(entry.title.length).toBeGreaterThan(2);expect(entry.hint.length).toBeGreaterThan(10);
  expect(cells.has(entry.atlas+':'+entry.cell)).toBe(false);cells.add(entry.atlas+':'+entry.cell);
  expect(await Bun.file(`public/assets/kana/${entry.atlas}.png`).exists()).toBe(true);
 }
 expect(kanaMnemonic('が')?.glyph).toBe('か');expect(kanaMnemonic('パ')?.glyph).toBe('ハ');
});
test('study entries distinguish scripts and include voiced and combined sounds without duplicates',()=>{
 for(const script of ['hiragana','katakana'] as const){const items=kanaEntries(defaultCatalog,script);expect(new Set(items.map(item=>item.glyph)).size).toBe(items.length);expect(items.every(item=>item.reading)).toBe(true);expect(items.some(item=>item.glyph===(script==='hiragana'?'きゃ':'キャ'))).toBe(true);}
});
test('kana submission rejects invalid ratings, versions and unknown fields',()=>{
 const valid={attemptId:crypto.randomUUID(),script:'hiragana',direction:'sign-reading',glyph:'あ',version:0,rating:3,mode:'learn'};
 expect(kanaSubmissionSchema.safeParse(valid).success).toBe(true);
 for(const patch of [{rating:0},{rating:5},{version:-1},{script:'both'},{due:'tomorrow'}])expect(kanaSubmissionSchema.safeParse({...valid,...patch}).success).toBe(false);
});
