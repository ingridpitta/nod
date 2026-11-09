import net from 'node:net';
import process from 'node:process';
const socket = net.connect('/tmp/nod-computer.sock');
socket.setTimeout(65000, () => { socket.destroy(); process.exitCode = 1; });
socket.on('error', () => { process.exitCode = 1; });
process.stdin.pipe(socket);
socket.pipe(process.stdout);
