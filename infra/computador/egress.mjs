import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

// definido em 2026-09-18: somente IPv4 público; DNS fixado no socket evita rebinding.
export function publico(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
}
async function resolver(host, port) {
  if (![80,443].includes(port)) throw new Error('destino');
  const ips = await dns.lookup(host, { family:4, all:true });
  if (!ips.length || ips.some(x => !publico(x.address))) throw new Error('destino');
  return ips[0].address;
}
export function servidorEgress() {
  const server = http.createServer(async (req,res) => {
    try {
      const u = new URL(req.url);
      if (u.protocol !== 'http:' || u.username || u.password) throw new Error('destino');
      const ip = await resolver(u.hostname, Number(u.port || 80));
      const headers = {...req.headers, host:u.host};
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const out = http.request({host:ip,port:Number(u.port || 80),method:req.method,path:u.pathname+u.search,headers}, r => {res.writeHead(r.statusCode ?? 502,r.headers);r.pipe(res);});
      out.on('error', () => res.destroy()); req.pipe(out);
    } catch {res.writeHead(403);res.end('destino bloqueado');}
  });
  server.on('connect', async (req,socket,head) => {
    try {
      const u = new URL('https://'+req.url);
      const port = Number(u.port || 443);
      const ip = await resolver(u.hostname,port);
      const out = net.connect(port,ip, () => {socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');out.write(head);socket.pipe(out);out.pipe(socket);});
      out.on('error',()=>socket.destroy());socket.on('error',()=>out.destroy());
      socket.on('close',()=>out.destroy());
    } catch {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) servidorEgress().listen(3128,'0.0.0.0');
