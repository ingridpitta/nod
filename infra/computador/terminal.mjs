// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §4): o terminal do computador da pessoa. Roda como `nod-pc-term`
// (nod-computador-terminal.service), separado do supervisor: escreve só no workspace, não tem DISPLAY e herda o mesmo
// IPAddressDeny. Quem fala com ele é só o supervisor (socket 0660, grupo nod-pc). Um pedido por conexão:
// {computadorId, comando} → {saida, codigoSaida}, como a ação `terminal` do runtime de hoje.
import { clearTimeout, setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { access, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PRAZO_TERMINAL_MS = 20_000;
export const SAIDA_MAXIMA = 30_000;
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/** Roda `comando` no bash, com cwd no workspace do computador e um ambiente mínimo (sem DISPLAY, sem credenciais). */
export function rodarComando({ workspace, comando, prazoMs = PRAZO_TERMINAL_MS, path: caminhoPath = process.env.PATH }) {
  return new Promise((resolve) => {
    const proc = spawn('/bin/bash', ['-c', comando], {
      cwd: workspace,
      env: { PATH: caminhoPath ?? '/usr/local/bin:/usr/bin:/bin', HOME: workspace, LANG: 'C.UTF-8', TERM: 'dumb' },
      detached: true,
    });
    proc.stdin.end();
    let saida = '';
    let estourou = false;
    const coletar = (b) => {
      saida = (saida + b.toString()).slice(-SAIDA_MAXIMA);
    };
    proc.stdout.on('data', coletar);
    proc.stderr.on('data', coletar);
    const encerrar = () => {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch { /* segue */ }
    };
    const timer = setTimeout(() => {
      estourou = true;
      encerrar();
    }, prazoMs);
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ saida: 'Comando indisponível.', codigoSaida: 1 });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ saida: saida + (estourou ? `\nLimite de ${Math.round(prazoMs / 1000)} segundos atingido.` : ''), codigoSaida: code ?? 124 });
    });
  });
}

/** O servidor do terminal. `raiz`: /var/lib/nod-computador; o workspace é raiz/<id>/workspace. */
export function criarServidorTerminal({ raiz }) {
  return net.createServer({ allowHalfOpen: true }, (socket) => {
    let corpo = '';
    socket.setTimeout(PRAZO_TERMINAL_MS + 10_000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (b) => {
      corpo += b;
      if (corpo.length > 64_000) socket.destroy();
    });
    socket.on('end', async () => {
      let pedido;
      try {
        pedido = JSON.parse(corpo);
      } catch {
        socket.end(JSON.stringify({ erro: 'acao_falhou' }));
        return;
      }
      const comando = typeof pedido?.comando === 'string' ? pedido.comando : '';
      if (!ID_VALIDO.test(String(pedido?.computadorId ?? '')) || !comando.trim() || comando.length > 8000) {
        socket.end(JSON.stringify({ erro: 'acao_falhou' }));
        return;
      }
      const workspace = path.join(raiz, pedido.computadorId, 'workspace');
      if (!(await access(workspace).then(() => true, () => false))) {
        socket.end(JSON.stringify({ erro: 'nao_iniciou' }));
        return;
      }
      socket.end(JSON.stringify({ resultado: await rodarComando({ workspace, comando }) }));
    });
  });
}

/** Socket ativado pelo systemd (LISTEN_FDS) ou, fora dele, o caminho em NOD_PC_TERMINAL. */
export async function escutar(servidor, caminho) {
  if (process.env.LISTEN_FDS === '1' && process.env.LISTEN_PID === String(process.pid)) {
    servidor.listen({ fd: 3 });
    return;
  }
  await unlink(caminho).catch(() => {});
  await new Promise((r) => servidor.listen(caminho, r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o007);
  const servidor = criarServidorTerminal({ raiz: process.env.NOD_PC_RAIZ ?? '/var/lib/nod-computador' });
  await escutar(servidor, process.env.NOD_PC_TERMINAL ?? '/run/nod-computador/term.sock');
}
