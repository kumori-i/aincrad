// One production world; explicit disposable profiles are only for native QA.
const path=require('node:path'),os=require('node:os');
const {existsSync,lstatSync,realpathSync}=require('node:fs');
function inside(root,p){const r=path.relative(root,p);return r===''||(r!=='..'&&!r.startsWith(`..${path.sep}`)&&!path.isAbsolute(r));}
function canonical(p){p=path.resolve(p);if(existsSync(p))return realpathSync(p);const parent=path.dirname(p);if(parent===p)throw new Error('Cannot resolve profile.');return path.join(canonical(parent),path.basename(p));}
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
 const temp=path.resolve(os.tmpdir()),candidate=path.resolve(value);
 if(candidate===temp||!inside(temp,candidate))throw new Error('Test profile must stay inside the disposable OS temporary directory.');
 let cursor=canonical(temp);
 for(const segment of path.relative(temp,candidate).split(path.sep)){cursor=path.join(cursor,segment);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw new Error('Test profile cannot use a symlink.');}
 const comparableProduct=canonical(product);
 if(inside(comparableProduct,cursor)||inside(cursor,comparableProduct))throw new Error('Test profile must be separate from product profile.');
 return Object.freeze({isTest:true,userDataPath:cursor});
}
module.exports={resolveProfileRoute};
