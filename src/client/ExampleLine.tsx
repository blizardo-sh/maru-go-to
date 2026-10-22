import { useState } from 'react';
import type { LearningExample } from '../shared/learning';
import type { Orthography } from '../shared/types';
import { Japanese } from './Japanese';

/** Both faces share a grid cell, reserving the taller translation without a layout jump. */
export function ExampleLine({ example, mode, play, disabled }: { example: LearningExample; mode: Orthography; play?: () => void; disabled?: boolean }) {
  const [translated, setTranslated] = useState(false);
  return <div className="example-line"><button type="button" className="example-phrase" aria-pressed={translated} aria-label={translated ? 'Показать японский пример' : 'Показать перевод примера'} onClick={() => setTranslated(value => !value)}><span className="example-face" style={{ visibility: translated ? 'hidden' : 'visible' }} aria-hidden={translated}><Japanese value={example} mode={mode} /></span><span className="example-face" style={{ visibility: translated ? 'visible' : 'hidden' }} aria-hidden={!translated}>{example.meaningRu}</span></button>{play && <button type="button" className="example-play quiet" aria-label="Прослушать пример" disabled={disabled} onClick={play}>▶</button>}</div>;
}
