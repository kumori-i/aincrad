/** A deliberately small command grammar, not a natural-language planner.
 * Every clause must match before any target is bound or operation proposed. */
const verbs = {
  inspect: 'inspect_object', inspect_object: 'inspect_object', 'look at': 'inspect_object',
  grasp: 'grasp', 'pick up': 'grasp', take: 'grasp', pick: 'pull', pluck: 'pull',
  release: 'release', drop: 'release', pull: 'pull', sample: 'sample', taste: 'sample',
  bite: 'sample', eat: 'sample', strike: 'strike', hit: 'strike', kill: 'strike', catch: 'catch',
};
const features = new Set(['red','purple','green','round','fibrous','prickly','rough','sweet','furry','soft','trunk','blades','clusters']);
const command = new RegExp(`^(${Object.keys(verbs).sort((a,b)=>b.length-a.length).join('|')})(?: (.+))?$`);
const codes = ['accepted','unsupported','unresolved','too_long','restart','legacy'];
export function validHumanHint(hint) {
  return hint && typeof hint === 'object' && !Array.isArray(hint) &&
    Object.keys(hint).length === 2 && hint.version === 1 && codes.includes(hint.code);
}
const rejected = code => ({hint:{version:1,code},proposed:[]});
function reference(text) {
  if (!text || /^(?:it|this|that|the object|this object|that object)$/.test(text)) return {implicit:true};
  if (/^object:\d{1,9}$/.test(text)) return {id:text};
  const words=text.replace(/^(?:the|this|that) /,'').replace(/ (?:object|fruit)$/,'').split(' ');
  return words.length && words.every(word=>features.has(word)) ? {features:words} : null;
}
export function parseHumanHint(content, observations, primitives, priorQuestion=null) {
  if (typeof content!=='string'||content.length>600) return rejected('too_long');
  // Normalization changes whitespace/case only; punctuation inside clauses is
  // not discarded. Quotes, qualifications and unknown words fail the grammar.
  const text=content.toLowerCase().trim().replace(/\s+/g,' ')
    .replace(/^(?:(?:can|could|would) you )?(?:please )?/,'')
    .replace(/(?:,? please)?[.!?]?$/,'').trim();
  const clauses=text.split(/\s*,\s*(?:and then |then |and )?|\s+(?:and then|then|and)\s+/);
  if (!clauses.length||clauses.length>6) return rejected('unsupported');
  const parsed=[];
  for(const clause of clauses){
    const match=command.exec(clause),ref=match&&reference(match[2]);
    if(!match||!ref||!primitives.includes(verbs[match[1]]))return rejected('unsupported');
    parsed.push({type:verbs[match[1]],ref});
  }
  let id=null,pulled=false;
  for(const {type,ref} of parsed){
    // Pull creates a new identity. The existing physical outcome path can bind
    // only a following implicit sample/release to that acquired material.
    // Never rewrite a source ID the human explicitly named, or guess which
    // result a second acquisition/pronoun intended.
    if(pulled&&(!ref.implicit||!['sample','release'].includes(type)))return rejected('unsupported');
    if(ref.implicit&&!id){
      if(!priorQuestion||!observations[priorQuestion])return rejected('unresolved');
      id=priorQuestion;
    }
    if(type==='pull')pulled=true;
    let next=ref.id;
    if(ref.features){
      const matches=Object.values(observations).filter(o=>{
        const words=Object.values(o.appearance||{}).join(' ').toLowerCase().split(/[^a-z]+/);
        return ref.features.every(word=>words.includes(word));
      });
      if(matches.length!==1)return rejected('unresolved');
      next=matches[0].id;
    }
    if(next){if(id&&id!==next)return rejected('unsupported');id=next;}
  }
  if(!id||!observations[id])return rejected('unresolved');
  return {hint:{version:1,code:'accepted'},proposed:parsed.map(({type})=>({type,targetId:id}))};
}
export function humanHintHelp(report){
  const code=report?.hint?.code;
  if(code==='accepted')return 'Restricted command understood, not completed. Each listed operation is one attempt; “kill” means one strike, not a guaranteed kill.';
  if(code==='legacy'||code==='restart')return 'Saved human advice is kept as a report only; no steps resume. Send a new simple command to request another attempt.';
  const reason=code==='too_long'?'The instruction exceeds the 600-character hint limit.':code==='unresolved'?'I cannot identify a specific observed target.':'The whole instruction does not match my restricted command grammar.';
  return `${reason} No physical steps proposed by this hint. Use one observed object ID or a unique visible description, for example “pull object:123, then sample it”. Up to six simple operations; no conditions, repetition instructions, or resulting-object references. This is not a prohibition; ordinary autonomous behavior continues.`;
}

/** Dialogue routing only, never action authority. Mentioning a verb in a
 * question, quotation or description does not itself request an attempt. */
export function looksLikeHumanHint(text){
  const lower=String(text||'').toLowerCase().trim().replace(/\s+/g,' ');
  const operation='(?:inspect(?:_object)?|look at|grasp|pick(?: up)?|pluck|take|release|drop|pull|sample|taste|bite|eat|strike|hit|kill|catch)';
  return new RegExp(`^(?:(?:(?:can|could|would) you|you can) )?(?:please )?${operation}\\b`).test(lower)||
    /^(?:if|unless|when|do not|don't|never|get close|approach)\b/.test(lower)&&new RegExp(`\\b${operation}\\b`).test(lower);
}
