// One production world; explicit disposable profiles are only for native QA.
const path=require('node:path'),os=require('node:os');
const {existsSync,lstatSync,realpathSync,statSync}=require('node:fs');
function inside(root,p){const r=path.relative(root,p);return r===''||(r!=='..'&&!r.startsWith(`..${path.sep}`)&&!path.isAbsolute(r));}
function canonical(p){p=path.resolve(p);if(existsSync(p))return realpathSync(p);const parent=path.dirname(p);if(parent===p)throw new Error('Cannot resolve profile.');return path.join(canonical(parent),path.basename(p));}
// realpath does not normalize case on case-insensitive filesystems. Compare
// directory identities as well as paths, without lowercasing Unix names.
function statIfPresent(p){try{return statSync(p);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function physicallyInside(root,p){
 const target=statIfPresent(root);if(!target)return false;
 for(let cursor=p;;cursor=path.dirname(cursor)){
  const info=statIfPresent(cursor);
  if(info&&info.dev===target.dev&&info.ino===target.ino)return true;
  if(path.dirname(cursor)===cursor)return false;
 }
}
function resolveProfileRoute({argv,isPackaged,defaultUserDataPath}){
 if(!Array.isArray(argv)||typeof defaultUserDataPath!=='string')throw new TypeError('Missing profile inputs.');
 if(argv.some(a=>/^--(?:recovered|test-recovered|test-ozark-pilot|test-native-qa)/.test(a)))throw new Error('Retired world/profile options are unsupported.');
 if(argv.some(a=>a.startsWith('--test')&&a!=='--test'&&!a.startsWith('--test-profile='))||argv.some(a=>a.startsWith('--smoke-test')&&a!=='--smoke-test'))throw new Error('Malformed test launch option.');
 const flags=argv.filter(a=>a==='--test'),options=argv.filter(a=>a.startsWith('--test-profile'));
 if(flags.length>1||options.length>1||options.some(a=>!a.startsWith('--test-profile=')))throw new Error('Invalid or duplicate test profile options.');
 const isTest=flags.length===1,product=path.resolve(defaultUserDataPath);
 if(isTest&&isPackaged)throw new Error('Test profiles are unavailable in packaged launches.');
 if(isTest!==(options.length===1))throw new Error('Test mode requires an explicit isolated profile.');
 if(!isTest)return Object.freeze({isTest:false,userDataPath:product});
 const value=options[0].slice('--test-profile='.length);
 if(!path.isAbsolute(value)||value.length>1024)throw new Error('Test profile must be an absolute directory.');
 const temp=path.resolve(os.tmpdir()),canonicalTemp=canonical(temp),candidate=path.resolve(value);
 // Accept the OS spelling and its exact canonical root (macOS /var aliases),
 // not arbitrary symlink aliases beneath either root.
 const base=inside(temp,candidate)?temp:canonicalTemp;
 if(candidate===base||!inside(base,candidate))throw new Error('Test profile must stay inside the disposable OS temporary directory.');
 let cursor=canonicalTemp;
 for(const segment of path.relative(base,candidate).split(path.sep)){
  cursor=path.join(cursor,segment);
  let info;try{info=lstatSync(cursor);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(info?.isSymbolicLink())throw new Error('Test profile cannot use a symlink.');
  // Resolve aliases; inode checks below handle case-insensitive identity.
  if(info)cursor=realpathSync(cursor);
 }
 const comparableProduct=canonical(product);
 if(inside(comparableProduct,cursor)||inside(cursor,comparableProduct)||physicallyInside(comparableProduct,cursor)||physicallyInside(cursor,comparableProduct))throw new Error('Test profile must be separate from product profile.');
 return Object.freeze({isTest:true,userDataPath:cursor});
}
module.exports={resolveProfileRoute};
