import type { ReactNode } from 'react';

export function FlipCard({ revealed, front, back }: { revealed: boolean; front: ReactNode; back: ReactNode }) {
  return <div className="flip-card" data-revealed={revealed}>
    <div className="flip-inner">
      <div className="flip-side flip-front" aria-hidden={revealed} inert={revealed} hidden={revealed}>{!revealed && front}</div>
      <div className="flip-side flip-back" aria-hidden={!revealed} inert={!revealed} hidden={!revealed}>{revealed && back}</div>
    </div>
  </div>;
}
