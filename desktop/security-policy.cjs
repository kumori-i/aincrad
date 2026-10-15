// Worker response policy, shared by the desktop protocol and loopback QA server.
// Module imports are scripts. Fetch, eval and nested workers remain unavailable.
exports.WORKER_CSP="default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
