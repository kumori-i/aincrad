// Compatibility alias for earlier check instructions. The desktop build is primary.
import { buildApplication } from './build.mjs';
console.log('Built Aincrad desktop application:',(await buildApplication()).destination);
