// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): o lado de dentro do smoke na VM limpa (scripts/e2e-computador-vm.sh).
// Roda como o usuário `nod` (o do motor), fala com o supervisor REAL pelo socket que o systemd abriu e faz o papel do
// servidor: assina os comandos e sela a chave da máquina como o driver motor.ts faria. Confere o que o e2e local não
// alcança (Xvfb, Chromium, bwrap, systemd e IPAddressDeny de verdade). Sem dependências além do node e do chaves.mjs.
//
//   node na-vm.mjs [--socket /run/nod-computador/ctl.sock] [--telas 6]
//
// Sai com 0 só se todas as checagens passarem; cada uma imprime "ok" ou "FALHOU" com o motivo.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { assinarComando, chaveDaMaquina, chavesDeAssinatura, selar } from '../../infra/computador/chaves.mjs';

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : padrao; };
const SOCKET = arg('socket', '/run/nod-computador/ctl.sock');
const TELAS = Number(arg('telas', '6'));
const CRED = randomBytes(32).toString('hex');
// Ids do tamanho dos reais (uuid): com ids curtos o tmp da tela cabia no teto do socket unix e o Chrome abria (NOD-96, 28/10).
const ID = randomUUID();
const { privada, publica } = chavesDeAssinatura(CRED, ID);
const LOGIN = 'https://httpbin.org/cookies/set/sid/abc';
const VER_LOGIN = 'https://httpbin.org/cookies';

let falhas = 0;
const passo = (nome, ok, detalhe = '') => {
  if (!ok) falhas++;
  process.stdout.write(`${ok ? 'ok     ' : 'FALHOU '} ${nome}${detalhe ? ` — ${detalhe}` : ''}\n`);
};

/** A conexão com o supervisor: NDJSON nos dois sentidos; reconecta sozinha (o Atualizar reinicia o serviço). */
function conectar() {
  let sock = null; let buf = '';
  const esperando = new Map();
  const estados = new Map();
  const abrir = () => new Promise((ok, erro) => {
    const s = net.connect(SOCKET);
    s.setEncoding('utf8');
    s.once('connect', () => { sock = s; ok(); });
    s.once('error', erro);
    s.on('close', () => { if (sock === s) sock = null; });
    s.on('data', (b) => {
      buf += b;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.tipo === 'estado') estados.set(m.computadorId, m);
        else if (m.tipo === 'resultado' && esperando.has(m.id)) { esperando.get(m.id)(m); esperando.delete(m.id); }
      }
    });
  });
  const garantir = async () => {
    for (let t = 0; !sock; t++) {
      try { await abrir(); } catch (e) { if (t > 60) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
  };
  let n = 0;
  return {
    estados,
    garantir,
    async tratar(c, prazo = 90_000) {
      await garantir();
      const cmd = assinarComando({ id: `vm${++n}-${Date.now()}`, computadorId: ID, uso: 'equilibrado', prazoMs: Date.now() + 60_000, ...c }, privada);
      return new Promise((ok) => {
        const t = setTimeout(() => { esperando.delete(cmd.id); ok({ desfecho: 'falhou', motivo: 'sem_resposta_no_smoke' }); }, prazo);
        esperando.set(cmd.id, (r) => { clearTimeout(t); ok(r); });
        sock.write(`${JSON.stringify({ tipo: 'comando', comando: cmd })}\n`);
      });
    },
    fechar() { sock?.destroy(); },
  };
}

const sup = conectar();
const pubDoSupervisor = async () => {
  // Instalação limpa: o primeiro comando (ainda sem a chave do servidor fixada) faz o supervisor relatar a X25519.
  if (!sup.estados.get(ID)) await sup.tratar({ tipo: 'parar' });
  for (let t = 0; t < 50 && !sup.estados.get(ID)?.supervisorPub; t++) await new Promise((r) => setTimeout(r, 100));
  return sup.estados.get(ID)?.supervisorPub;
};
const iniciar = async () => {
  const pub = await pubDoSupervisor();
  const antes = Date.now();
  const r = await sup.tratar({ tipo: 'iniciar', servidorPub: publica, segredoSelado: selar(pub, chaveDaMaquina(CRED, ID)) });
  return { r, ms: Date.now() - antes, pub };
};
const acao = (agenteId, a) => sup.tratar({ tipo: 'acao', agenteId, acao: a });
const navegar = (agenteId, url) => acao(agenteId, { tipo: 'navegar', url });
const texto = (r) => r?.resultado?.tela?.texto ?? '';
const memLivreMb = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0) / 1024;

// Um servidor do próprio `nod` em 127.0.0.1: a tela e o terminal não podem alcançá-lo (IPAddressDeny).
const local = createServer((_q, s) => s.end('segredo-local-do-motor')).listen(8098, '127.0.0.1');

try {
  await sup.garantir();
  const ligar = await iniciar();
  passo('iniciar numa instalação limpa (TOFU) em menos de 60 s', ligar.r.desfecho === 'ok' && ligar.ms < 60_000, `${ligar.ms} ms ${ligar.r.motivo ?? ''}`);

  const bots = Array.from({ length: TELAS }, () => randomUUID());
  const primeira = await navegar(bots[0], 'https://example.com/');
  // O example.com tirou o "Example Domain" do corpo (fica só no <title>): vale o título ou o texto de hoje.
  const exemplo = (r) => /Example Domain/.test(r?.resultado?.tela?.titulo ?? '') || /documentation examples/.test(texto(r));
  passo('o Chromium real abre e navega', primeira.desfecho === 'ok' && exemplo(primeira), primeira.motivo ?? texto(primeira).slice(0, 80));

  // Login em comum: o bot 1 entra; o bot 2 (tela aberta depois) já vê o cookie.
  await navegar(bots[0], LOGIN);
  const outro = await navegar(bots[1], VER_LOGIN);
  passo('login em comum entre as telas', /"sid":\s*"abc"/.test(texto(outro)), texto(outro).slice(0, 120));

  // N telas ao mesmo tempo, cada uma no seu site; a memória sobra.
  const rs = await Promise.all(bots.map((b, i) => navegar(b, `https://example.com/?tela=${i}`)));
  const estado = sup.estados.get(ID);
  const abertas = (estado?.telas ?? []).filter((t) => t.estado === 'aberta').length;
  passo(`${TELAS} telas ao mesmo tempo`, rs.every((r) => r.desfecho === 'ok') && abertas >= TELAS, `abertas=${abertas} ${rs.map((r) => r.motivo ?? '').join(' ')}`);
  passo('memória sobrando com as telas de pé', memLivreMb() > 1024, `${Math.round(memLivreMb())} MB livres`);

  // Egress: metadata e o host local negados para a tela e para o terminal; a internet liberada.
  const meta = await navegar(bots[0], 'http://169.254.169.254/computeMetadata/v1/');
  // A navegação tem de FALHAR (IPAddressDeny corta a conexão: net::ERR_* no log do supervisor, motivo no resultado);
  // não basta o texto não parecer o do metadata — uma página de erro qualquer passaria.
  passo('tela não alcança o metadata (169.254.169.254)', meta.desfecho !== 'ok', `desfecho=${meta.desfecho} ${meta.motivo ?? ''}`);
  const host = await navegar(bots[0], 'http://127.0.0.1:8098/');
  passo('tela não alcança o 127.0.0.1 do motor', !texto(host).includes('segredo-local'), host.motivo ?? '');
  const term = await acao(bots[0], { tipo: 'terminal', comando: 'curl -s -m 5 http://169.254.169.254/ ; echo rc=$?; curl -s -m 5 http://127.0.0.1:8098/ ; echo rc=$?; curl -s -o /dev/null -m 10 -w "%{http_code}" https://example.com/; echo; id -un' });
  const saida = JSON.stringify(term.resultado ?? term);
  passo('terminal: sem metadata nem host local, com internet, como nod-pc-term', !/segredo-local|computeMetadata/.test(saida) && /200/.test(saida) && /nod-pc-term/.test(saida), saida.slice(0, 300));

  // Atualizar: o serviço reinicia (systemd, ativado por socket) e o login fica.
  const atu = await sup.tratar({ tipo: 'atualizar' });
  passo('Atualizar responde ok', atu.desfecho === 'ok', atu.motivo ?? '');
  await new Promise((r) => setTimeout(r, 7000));
  sup.estados.clear();
  const re1 = await iniciar();
  const depoisAtu = await navegar(bots[2], VER_LOGIN);
  passo('depois do Atualizar: religa com a mesma chave e o login fica', re1.r.desfecho === 'ok' && re1.pub === ligar.pub && /"sid":\s*"abc"/.test(texto(depoisAtu)), re1.r.motivo ?? texto(depoisAtu).slice(0, 120));

  // Redefinir: chave nova do supervisor (vai na resposta assinada), perfis do zero, logins ficam.
  const red = await sup.tratar({ tipo: 'redefinir' });
  passo('Redefinir responde ok com a X25519 nova', red.desfecho === 'ok' && !!red.supervisorPub && red.supervisorPub !== ligar.pub, red.motivo ?? '');
  const re2 = await iniciar();
  const depoisRed = await navegar(bots[3], VER_LOGIN);
  passo('depois do Redefinir: religa selando para a chave nova e o login fica', re2.r.desfecho === 'ok' && re2.pub === red.supervisorPub && /"sid":\s*"abc"/.test(texto(depoisRed)), re2.r.motivo ?? texto(depoisRed).slice(0, 120));

  // Comando sem assinatura válida é recusado (o `nod` alcança o socket, mas não manda no supervisor).
  // Com prazo: sem resposta em 15 s a checagem FALHA (silêncio não prova recusa) e o smoke segue.
  const forjado = await new Promise((ok) => {
    const s = net.connect(SOCKET); s.setEncoding('utf8'); let b = '';
    const t = setTimeout(() => { s.destroy(); ok(null); }, 15_000);
    const fim = (r) => { clearTimeout(t); s.destroy(); ok(r); };
    s.on('error', () => fim(null));
    s.on('data', (d) => { b += d; const l = b.split('\n').map((x) => x && JSON.parse(x)).find((m) => m?.tipo === 'resultado'); if (l) fim(l); });
    s.write(`${JSON.stringify({ id: 'forjado', computadorId: ID, tipo: 'acao', agenteId: bots[0], uso: 'livre', prazoMs: Date.now() + 60_000, acao: { tipo: 'observar' }, assinatura: 'AAAA' })}\n`);
  });
  passo('comando forjado é recusado', forjado !== null && forjado.desfecho !== 'ok', forjado ? forjado.motivo ?? '' : 'sem resposta em 15 s');
} catch (e) {
  passo('o smoke rodou até o fim', false, e instanceof Error ? e.message : String(e));
} finally {
  local.close();
  sup.fechar();
}
process.stdout.write(falhas ? `\n${falhas} checagem(ns) falharam\n` : '\ntodas as checagens passaram\n');
process.exit(falhas ? 1 : 0);
