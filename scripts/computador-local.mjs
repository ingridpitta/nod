#!/usr/bin/env node
// definido em 2026-10-22 (NOD-96 PR 2, ADR-122): roda o supervisor do computador por pessoa como processo comum, sem
// servidor e sem systemd. Sobe o terminal e o supervisor numa pasta temporária, faz o papel do servidor (assina os
// comandos com uma credencial de teste e fixa a chave por TOFU) e manda: iniciar → navegar → observar → terminal →
// fechar_tela → parar. Imprime cada resultado (a imagem só pelo tamanho) e o estado relatado.
//
//   node scripts/computador-local.mjs [--url https://example.com] [--bots 2] [--manter] [--cookies]
//
// --cookies: sobe um HTTP local que grava um cookie no bot1 e confere que o bot2 (outra tela) o recebe pela loja.
//
// Os binários vêm do PATH ou de NOD_PC_XVFB, NOD_PC_OPENBOX, NOD_PC_CHROMIUM, NOD_PC_BWRAP ("nao" = sem bwrap),
// NOD_PC_XDOTOOL, NOD_PC_XCLIP, NOD_PC_SCROT, NOD_PC_DBUS, NOD_PC_KEYRING e NOD_PC_SECRET_TOOL.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { assinarComando, chaveDaMaquina, chavesDeAssinatura, selar } from '../infra/computador/chaves.mjs';
import { criarSupervisor } from '../infra/computador/supervisor.mjs';
import { criarServidorTerminal, escutar } from '../infra/computador/terminal.mjs';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://example.com' }, bots: { type: 'string', default: '1' }, manter: { type: 'boolean', default: false }, cookies: { type: 'boolean', default: false } } });
const escrever = (m) => process.stdout.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
const resumo = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'imagem' && typeof v === 'string' ? `<${v.length} b64>` : k === 'texto' && typeof v === 'string' ? `${v.slice(0, 80)}…` : v)));

const dir = await mkdtemp(path.join(tmpdir(), 'nod-computador-local-'));
const raiz = path.join(dir, 'raiz');
const terminal = path.join(dir, 'term.sock');
const credencial = randomBytes(32).toString('hex');
const id = 'local';
const servidor = chavesDeAssinatura(credencial, id);
const term = criarServidorTerminal({ raiz });
await escutar(term, terminal);
const supervisor = criarSupervisor({ raiz, run: path.join(dir, 'run'), terminal, sandbox: process.env.NOD_PC_SANDBOX !== 'nao' });
supervisor.ouvir((m) => { if (m.tipo === 'estado') escrever({ estado: m.telas.map((t) => `${t.agenteId}:${t.estado}${t.memoriaMb ? `:${t.memoriaMb}MB` : ''}`), ligado: m.ligado }); });

const cmd = (c) => assinarComando({ id: randomUUID(), computadorId: id, uso: 'equilibrado', prazoMs: Date.now() + 60_000, ...c }, servidor.privada);
const mandar = async (c) => {
  const r = await supervisor.tratar(cmd(c));
  escrever({ comando: c.tipo, ...(c.acao ? { acao: c.acao.tipo } : {}), ...(c.agenteId ? { agenteId: c.agenteId } : {}), ...resumo(r) });
  return r;
};

let codigo = 0;
try {
  await supervisor.tratar(cmd({ tipo: 'parar' })); // cria o computador (e o par X25519); antes do TOFU é recusado
  const pub = supervisor.estados()[0].supervisorPub;
  if ((await mandar({ tipo: 'iniciar', servidorPub: servidor.publica, segredoSelado: selar(pub, chaveDaMaquina(credencial, id)) })).desfecho !== 'ok') throw new Error('não iniciou');
  const bots = Array.from({ length: Number(values.bots) }, (_, i) => `bot${i + 1}`);
  for (const agenteId of bots) {
    const nav = await mandar({ tipo: 'acao', agenteId, acao: { tipo: 'navegar', url: values.url } });
    if (nav.desfecho !== 'ok') codigo = 1;
    await mandar({ tipo: 'acao', agenteId, acao: { tipo: 'observar' } });
  }
  if (values.cookies) {
    const local = http.createServer((req, res) => {
      if (req.url === '/gravar') res.setHeader('Set-Cookie', 'sessao=compartilhada; Path=/; Max-Age=3600');
      res.setHeader('Content-Type', 'text/html');
      res.end(`<title>cookies</title><pre>${(req.headers.cookie ?? 'sem cookie').replace(/</g, '')}</pre>`);
    });
    await new Promise((r) => local.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${local.address().port}`;
    const outro = bots[1] ?? 'bot2';
    await mandar({ tipo: 'acao', agenteId: bots[0], acao: { tipo: 'navegar', url: `${base}/gravar` } });
    await supervisor.assentar();
    const visto = await mandar({ tipo: 'acao', agenteId: outro, acao: { tipo: 'navegar', url: `${base}/ver` } });
    const ok = String(visto.resultado?.tela?.texto ?? '').includes('sessao=compartilhada');
    escrever(`cookies repassados entre telas: ${ok ? 'sim' : 'NÃO'}`);
    if (!ok) codigo = 1;
    if (!bots.includes(outro)) bots.push(outro);
    local.close();
  }
  await mandar({ tipo: 'acao', agenteId: bots[0], acao: { tipo: 'terminal', comando: 'pwd; ls; echo "DISPLAY=${DISPLAY:-}"' } });
  if (!values.manter) for (const agenteId of bots) await mandar({ tipo: 'fechar_tela', agenteId });
  await mandar({ tipo: 'parar' });
} catch (e) {
  escrever(`falhou: ${e?.message}`);
  codigo = 1;
} finally {
  await supervisor.encerrar();
  term.close();
  if (!values.manter) await rm(dir, { recursive: true, force: true });
  else escrever(`pasta: ${dir}`);
}
process.exit(codigo);
