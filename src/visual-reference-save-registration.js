// A live attached learner supplies a pure current export for every world write.
// The provider is runtime-only and never enters the save envelope.
const currentExports=new WeakMap();
export function markVisualReferenceAttached(state,currentExport){
  if(!state||typeof state!=='object'||typeof currentExport!=='function')
    throw new TypeError('A live world and pure learner export are required');
  currentExports.set(state,currentExport);
}
export function currentVisualReferenceExport(state){return currentExports.get(state)??null;}
