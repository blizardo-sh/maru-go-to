import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Session } from '../../src/client/Session';
import { GuidedLearning } from '../../src/client/GuidedLearning';
import { App } from '../../src/client/App';
import type { Snapshot, StudySource, User } from '../../src/client/types';
import type { SceneSound } from '../../src/client/sceneSound';
import '../../src/client/styles.css';
import '../../src/client/illustrated.css';

const data = await fetch('/__interaction-data').then(response => response.json()) as Snapshot;
const sound: SceneSound = { state: 'muted', cue: () => {}, unlock: async () => {}, setSpeechPlaying: () => {} } as SceneSound;
const source: StudySource = new URLSearchParams(location.search).get('source') === 'review' ? { kind: 'review' } : { kind: 'counters' };
const initialUser: User = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic learner', email: 'fixture@example.test', isAdmin: false };
function Fixture() {
  const [active, setActive] = useState(true), [mounted, setMounted] = useState(true), [user, setUser] = useState(initialUser), [saved, setSaved] = useState(0), [snapshot, setSnapshot] = useState(data);
  return <><nav aria-label="Fixture controls"><button onClick={() => setActive(value => !value)}>Toggle active</button><button onClick={() => setMounted(false)}>Unmount session</button><button onClick={() => setUser({ ...initialUser, id: '00000000-0000-4000-8000-000000000002' })}>Switch owner</button><button onClick={() => { void fetch('/__next-publication-data').then(response => response.json()).then(setSnapshot); }}>Refresh publication</button><output data-testid="saved-count">{saved}</output></nav><div className="game-shell" data-motion="false"><main><div className="page">{mounted && (new URLSearchParams(location.search).has('guided') ? <GuidedLearning key={user.id} user={user} data={snapshot} lessonId={data.course.learning![0]!.lessonId} active={active} sound={sound} scene="room" onExit={() => {}} onCourse={() => {}} onSaved={() => setSaved(value => value + 1)} saveSettings={async () => {}} settingsBusy={false} /> : <Session key={user.id} user={user} data={snapshot} source={source} active={active} sound={sound} onExit={() => {}} onCourse={() => {}} onSaved={() => setSaved(value => value + 1)} saveSettings={async () => {}} settingsBusy={false} />)}</div></main></div></>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('app') ? <App /> : <Fixture />);
