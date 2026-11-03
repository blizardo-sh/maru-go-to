import type { CardActivity, SavedFeedback } from '@app/client/companion';
export const variantFor = (key: string, count = 3) => { let value=2166136261;for(const c of key)value=Math.imul(value^c.charCodeAt(0),16777619);return (value>>>0)%count; };
// Presentation receipt ledger only. It never assigns grades, writes progress, or retries requests.
// Kept outside renderer lifetime; reset at an account boundary.
export class M6Events {
  owner: string|null=null;
  scope=''; private activityKey='';
  private planScope=''; private planActive=false; private planSerial=0;
  private receipts=new Set<string>(); private completions=new Set<string>();
  savedCount=0; completionCount=0;
  bind(owner: string|null, scope: string) {
    const changed=owner!==this.owner||scope!==this.scope;
    if(owner!==this.owner){this.receipts.clear();this.completions.clear();this.savedCount=0;this.completionCount=0;this.planScope='';this.planActive=false;this.planSerial=0;}
    if(changed)this.activityKey='';this.owner=owner;this.scope=scope;return changed;
  }
  activity(value: CardActivity) { if(!this.owner||value.reviewId!==this.scope||value.key===this.activityKey)return false;this.activityKey=value.key;return true; }
  saved(value: SavedFeedback) { if(!this.owner||this.receipts.has(value.attemptId))return false;this.receipts.add(value.attemptId);this.savedCount++;return true; }
  observePlan(scope: string, active: boolean, done: boolean) {
    if(!this.owner)return null;
    if(scope!==this.planScope){this.planScope=scope;this.planActive=false;}
    if(active&&!done)this.planActive=true;
    if(done&&this.planActive){this.planActive=false;return `${scope}:finished:${++this.planSerial}`;}
    return null;
  }
  complete(key: string){if(!this.owner||this.completions.has(key))return false;this.completions.add(key);this.completionCount++;return true;}
  snapshot(){return{savedCount:this.savedCount,completionCount:this.completionCount};}
}
