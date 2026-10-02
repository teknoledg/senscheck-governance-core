// Preload: any attempt to open a network connection or call fetch/DNS aborts the process with exit code 99.
const fail = (what) => {
  process.stderr.write(`UNEXPECTED NETWORK ACCESS: ${what}\n`);
  process.exit(99);
};
const net = require("node:net");
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  // allow unix sockets / pipes (stdio transports), refuse TCP
  if (a && typeof a === "object" && (a.path || a.fd !== undefined)) return origConnect.apply(this, args);
  if (typeof a === "string") return origConnect.apply(this, args);
  return fail(`tcp connect ${JSON.stringify(a)}`);
};
const dns = require("node:dns");
for (const fn of ["lookup", "resolve", "resolve4", "resolve6"]) dns[fn] = (...a) => fail(`dns.${fn}(${a[0]})`);
if (typeof globalThis.fetch === "function") globalThis.fetch = (...a) => fail(`fetch(${a[0]})`);
const dgram = require("node:dgram");
dgram.createSocket = () => fail("dgram");
