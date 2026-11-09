// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): a pilha inteira do computador da pessoa, sem Xvfb nem Chromium.
// Servidor completo com NOD_COMPUTADORES=motor → ponte HTTP de verdade (chave de máquina, conectar, long-poll) → laço do
// motor (iniciarComputador) → socket de controle → supervisor REAL (com a tela falsa de tests/helpers/tela-falsa.mjs).
// Os bots chamam as ferramentas pelo HTTP interno com o token do turno, como o CLI. O que precisa de Xvfb, Chromium e
// systemd de verdade é o smoke da VM (scripts/e2e-computador-vm.sh).
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarSupervisor, escutarControle, servirControle, type Supervisor } from "../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../infra/computador/terminal.mjs";
import type { Agente } from "../../src/contracts/agente.ts";
import type { FrotaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { iniciarComputador, type LacoComputador } from "../../src/adapters/executor/computador.ts";
import { criarPonteHttp } from "../../src/adapters/executor/ponte-http.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const TELA_FALSA = fileURLToPath(new URL("../helpers/tela-falsa.mjs", import.meta.url));
/** O boot da tela (Xvfb + Chromium na VM) leva tempo: a primeira ação chega no meio dele e tem de esperar, não falhar. */
const BOOT_MS = 1500;
const MAIL = "https://mail.exemplo.com/";

type Bot = { agente: Agente; conversa: Conversa };
type Tela = { url: string; titulo: string; texto: string };

describeIntegracao("computador da pessoa: servidor → ponte → motor → supervisor real (NOD-96 PR 7)", () => {
  let srv: ServidorCompleto;
  let dir: string;
  let sup: Supervisor;
  let controle: Server;
  let terminal: Server;
  let laco: LacoComputador | null = null;
  let pausar: (() => void) | null = null;
  const bots: Bot[] = [];
  const logs: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-motor-e2e-"));
    const bin = async (nome: string, corpo: string) => {
      const f = join(dir, nome);
      await writeFile(f, `#!/bin/sh\n${corpo}\n`);
      await chmod(f, 0o755);
      return f;
    };
    const binarios = {
      dbus: await bin("dbus", 'for a in "$@"; do case "$a" in --address=*) echo "${a#--address=}";; esac; done; exec sleep 60'),
      keyring: await bin("keyring", "cat >/dev/null; exec sleep 60"),
      secretTool: await bin("secret-tool", "cat >/dev/null"),
      xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot",
    };
    terminal = criarServidorTerminal({ raiz: join(dir, "raiz") });
    await escutar(terminal, join(dir, "term.sock"));
    sup = criarSupervisor({
      raiz: join(dir, "raiz"), run: join(dir, "run"), terminal: join(dir, "term.sock"), bin: binarios, tela: TELA_FALSA,
      ambienteTela: { NOD_TELA_FALSA_ATRASO_MS: String(BOOT_MS) }, leitura: () => ({ memoria: "verde", processador: "verde" }),
      batimentoMs: 300, log: (m) => { logs.push(m); },
    });
    // Como o main do supervisor instalado (supervisor.mjs): carrega o disco e só então escuta.
    await sup.carregar();
    controle = servirControle(sup);
    await escutarControle(controle, join(dir, "ctl.sock"));

    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_COMPUTADORES: "motor" }, intervalos: { orquestradorMs: 3600000, schedulerMs: 3600000, expiracaoMs: 3600000 } });
    for (const modo of ["manual", "automatico", "automatico"]) {
      const b = await srv.json<Bot>("POST", "agentes", { dono: "pessoa", interativo: true });
      await srv.json("POST", `agentes/${b.agente.id}/modo-aprovacao`, { modo });
      bots.push(b);
    }
  }, 60000);

  afterAll(async () => {
    laco?.parar();
    pausar?.();
    if (sup) await sup.encerrar();
    await new Promise((r) => controle?.close(r));
    await new Promise((r) => terminal?.close(r));
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: bots.map((b) => b.agente.id), conversas: bots.map((b) => b.conversa.id) });
      await srv.desligar();
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 60000);

  /** A máquina Linux da pessoa: chave, conectar anunciando o computador e o laço do motor puxando os comandos. */
  async function ligarMaquina() {
    const { chave } = await srv.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "pc-da-pessoa" });
    const cliente = criarPonteHttp({ url: srv.url, chave, versao: "0.1.0" });
    const anuncio = { nome: "pc-da-pessoa", versaoContrato: 1, plataforma: "linux", inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 }, computador: { estado: "pronto" } };
    await cliente.ponte.conectar(anuncio as Parameters<typeof cliente.ponte.conectar>[0]);
    // O app renova o contato a cada volta do puxar; aqui um conectar a cada 5 s basta (o corte é 60 s).
    const t = setInterval(() => { void cliente.ponte.conectar(anuncio as Parameters<typeof cliente.ponte.conectar>[0]).catch(() => undefined); }, 5000);
    pausar = () => clearInterval(t);
    laco = iniciarComputador({ canal: cliente.computador, socket: join(dir, "ctl.sock"), batimentoMs: 300 });
  }

  const planos = new Map<string, PlanoTurno>();
  const plano = async (b: Bot) => {
    const ja = planos.get(b.agente.id);
    if (ja) return ja;
    const p = await srv.app.dentro(srv.pessoa, async (d) => {
      await d.tx(async (trx) => { await trx`update agentes set confirmado = true where id = ${b.agente.id}`; });
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: b.agente.id, conversaId: b.conversa.id, origem: "conversa", prazoEm: Date.now() + 600000, profundidade: 0, entradaTexto: "Use seu computador", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: randomUUID(), executor: "catcher" })).data;
    });
    planos.set(b.agente.id, p);
    return p;
  };
  async function ferramenta(b: Bot, nome: string, argumentos: Record<string, unknown> = {}): Promise<ResultadoChamada> {
    const p = await plano(b);
    const r = await fetch(`${srv.url}/api/interno/ferramentas/${nome}`, { method: "POST", headers: { authorization: `Bearer ${p.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos }) });
    expect(r.status).toBe(200);
    return await r.json() as ResultadoChamada;
  }
  /** A tela que a ferramenta devolveu (o conteúdo é o resultado do driver em JSON). */
  function telaDe(r: ResultadoChamada): Tela {
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!("conteudo" in r)) throw new Error(`sem conteúdo: ${JSON.stringify(r)}`);
    const tela = (JSON.parse(r.conteudo) as { tela?: Tela }).tela;
    if (!tela) throw new Error(`sem tela: ${r.conteudo.slice(0, 800)}`);
    return tela;
  }
  const cookies = (t: Tela) => Object.fromEntries((JSON.parse(t.texto) as { name: string; value: string }[]).map((c) => [c.name, c.value]));
  /** Os cookies que a tela do bot vê agora. `forcar` fura a dedup do NOD-161 (tela igual sai sem texto). */
  const logins = async (b: Bot) => {
    expect(await ferramenta(b, "computador_navegar", { url: MAIL })).toMatchObject({ ok: true });
    return cookies(telaDe(await ferramenta(b, "computador_observar", { forcar: true })));
  };
  /** Aprova o pedido do bot manual (o card da conversa) e devolve a resposta da decisão. */
  async function aprovar(decisaoId: string) {
    const itens = await srv.app.dentro(srv.pessoa, (d) => d.repos.itensAprovacao.listar(decisaoId));
    return srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { itens: itens.map((i) => ({ id: i.id, selecionado: true })) });
  }

  it("sem máquina conectada a ação falha na hora (sem contato), não espera os 60 s", async () => {
    const [, auto] = bots;
    const antes = Date.now();
    const r = await ferramenta(auto!, "computador_observar");
    expect(Date.now() - antes).toBeLessThan(10_000);
    expect(JSON.stringify(r)).toMatch(/sem contato|Nenhuma máquina|nenhuma máquina/i);
  }, 30000);

  it("instalação limpa: a primeira ação liga o computador (TOFU) no meio do boot da tela e volta a tela, sem erro", async () => {
    await ligarMaquina();
    const [, auto, outro] = bots;
    const antes = Date.now();
    // Dois bots agem juntos no boot (o computador é um só): o segundo espera o mesmo iniciar, nenhum falha. O mesmo
    // bot com duas ações juntas recebe "ocupado" na segunda — é a reserva por bot, coberta em computadores-http.
    const [a, b] = await Promise.all([ferramenta(auto!, "computador_navegar", { url: MAIL }), ferramenta(outro!, "computador_observar")]);
    const ms = Date.now() - antes;
    expect(telaDe(a).url).toBe(MAIL);
    expect(telaDe(b).titulo).toContain(outro!.agente.id);
    expect(ms).toBeGreaterThanOrEqual(BOOT_MS - 100);
    expect(ms).toBeLessThan(60_000);
    expect(JSON.stringify([a, b])).not.toMatch(/ERR_TUNNEL|nao_iniciou|nao_ficou_pronto/);
    // O servidor fixou a X25519 do supervisor (TOFU) e o supervisor a do servidor.
    const c = await srv.app.dentro(srv.pessoa, (d) => d.repos.computadores.daPessoa());
    expect(c?.supervisorPub).toBe(sup.estados().find((e) => e.computadorId === c?.id)?.supervisorPub);
    expect(sup.estados()[0]?.ligado).toBe(true);
  }, 90000);

  it("aprovações por bot: o manual espera o card, o automático segue; aprovar um não libera o outro", async () => {
    const [manual, auto] = bots;
    const pedido = await ferramenta(manual!, "computador_navegar", { url: `${MAIL}?entrar=sid:abc` });
    expect(pedido).toHaveProperty("aguardar");
    if (!("aguardar" in pedido)) throw new Error("aprovação ausente");
    // Enquanto o card do manual espera, o automático navega sem card e ainda não vê login nenhum.
    expect(await logins(auto!)).toEqual({});
    expect((await aprovar(pedido.aguardar)).status).toBe(200);
    // Aprovado o do manual, o login vale nas duas telas (o computador é um só, os logins são em comum)…
    await sup.assentar();
    expect(await logins(auto!)).toEqual({ sid: "abc" });
    // …e a próxima ação do manual pede card de novo; a do automático não.
    expect(await ferramenta(manual!, "computador_navegar", { url: MAIL })).toHaveProperty("aguardar");
    expect(await ferramenta(auto!, "computador_navegar", { url: MAIL })).toMatchObject({ ok: true });
    // As telas seguem abertas e uma por bot (o manual abriu a dele ao ser aprovado; `outro` abriu no boot).
    expect(Object.fromEntries((sup.estados()[0]?.telas ?? []).map((t) => [t.agenteId, t.estado]))).toEqual(Object.fromEntries(bots.map((b) => [b.agente.id, "aberta"])));
  }, 60000);

  it("bot criado depois nasce logado; telas de bots em paralelo nunca trocam", async () => {
    const novo = await srv.json<Bot>("POST", "agentes", { dono: "pessoa", interativo: true });
    bots.push(novo);
    const [, auto] = bots;
    expect(await logins(novo)).toEqual({ sid: "abc" });
    for (let volta = 0; volta < 5; volta++) {
      const rs = await Promise.all([auto!, novo].map((b, i) => ferramenta(b, "computador_navegar", { url: `https://b${i}.exemplo.com/v${volta}` })));
      rs.forEach((r, i) => {
        const t = telaDe(r);
        expect(t.url).toBe(`https://b${i}.exemplo.com/v${volta}`);
        expect(t.titulo).toContain([auto!, novo][i]!.agente.id);
      });
    }
  }, 90000);

  it("Atualizar e Redefinir pelo painel: fecham as telas, o Redefinir troca a chave do supervisor e o login fica", async () => {
    const [, auto] = bots;
    const daPessoa = () => srv.app.dentro(srv.pessoa, (d) => d.repos.computadores.daPessoa());
    const operar = async (operacao: string) => {
      expect((await srv.chamar("POST", "computador", { operacao })).status).toBe(200);
      const ate = Date.now() + 30_000;
      while ((await daPessoa())?.operacao) {
        if (Date.now() > ate) throw new Error(`${operacao} não terminou`);
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    const pubAntes = (await daPessoa())?.supervisorPub;
    await operar("atualizar");
    expect(await logins(auto!)).toEqual({ sid: "abc" });
    await operar("redefinir");
    const c = await daPessoa();
    // A X25519 nova veio na resposta assinada do `redefinir` e o servidor a fixou no lugar da antiga.
    expect(c?.supervisorPub).toBeTruthy();
    expect(c?.supervisorPub).not.toBe(pubAntes);
    expect(c?.supervisorPub).toBe(sup.estados().find((e) => e.computadorId === c?.id)?.supervisorPub);
    // A próxima ação religa (selando para a chave nova) e a tela reabre logada.
    expect(await logins(auto!)).toEqual({ sid: "abc" });
  }, 90000);

  it("RLS: outra pessoa do mesmo workspace e outro workspace não veem nem mexem no computador", async () => {
    const [, auto] = bots;
    const outraPessoa = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: randomUUID() });
    const outroTenant = srv.sessaoDe({ tenantId: randomUUID(), pessoaId: srv.pessoa.pessoaId });
    for (const s of [outraPessoa, outroTenant]) {
      expect([401, 403, 404]).toContain((await srv.chamar("GET", `agentes/${auto!.agente.id}/computador`, undefined, s)).status);
      expect([401, 403, 404]).toContain((await srv.chamar("POST", `agentes/${auto!.agente.id}/computador/acoes`, { tipo: "observar" }, s)).status);
      expect([401, 403, 404]).toContain((await srv.chamar("POST", `agentes/${auto!.agente.id}/computador`, { operacao: "redefinir" }, s)).status);
    }
    // No banco, sob a RLS da outra pessoa, o computador da pessoa não existe.
    expect(await srv.app.dentro({ tenantId: srv.pessoa.tenantId, pessoaId: outraPessoa.pessoaId }, (d) => d.repos.computadores.daPessoa())).toBeNull();
  }, 30000);

  it("NOD-96: no motor, a máquina da pessoa fora do ar tira o computador do plano e a frota mostra", async () => {
    const [, auto] = bots;
    await srv.app.dentro(srv.pessoa, async (d) => {
      const c = (await d.repos.computadores.daPessoa())!;
      expect((await d.repos.computadores.buscarVinculo(auto!.agente.id))?.id).toBe(c.id);
      await d.repos.computadores.registrarFalha(c.id, { motivo: "sem_resposta", em: Date.now(), limite: 1 });
    });
    const p = await srv.app.dentro(srv.pessoa, async (d) => {
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: auto!.agente.id, conversaId: auto!.conversa.id, origem: "conversa", prazoEm: Date.now() + 600000, profundidade: 0, entradaTexto: "Use seu computador", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: randomUUID(), executor: "catcher" })).data;
    });
    expect(p.catalogo.ferramentas.filter((f) => f.origem === "computador")).toEqual([]);
    expect(p.promptSistema).toContain("fora do ar");
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === auto!.agente.id)?.computadorForaDoAr).toMatchObject({ motivo: "sem_resposta" });
  }, 30000);

  it("NOD-96: no motor, o bot preso a um 'por_bot' antigo fora do ar recebe as ferramentas e a frota não o mostra fora do ar", async () => {
    const b = await srv.json<Bot>("POST", "agentes", { dono: "pessoa", interativo: true });
    bots.push(b);
    await srv.app.dentro(srv.pessoa, async (d) => {
      const velho = (await d.repos.computadores.obter(b.agente.id, true))!;
      expect(await d.repos.computadores.travar(velho.id)).not.toBeNull(); // é um 'por_bot'
      await d.repos.computadores.registrarFalha(velho.id, { motivo: "nao_iniciou", em: Date.now(), limite: 1 });
      // O da pessoa volta ao ar (o caso anterior o derrubou): só a saúde do por_bot antigo poderia tirar as ferramentas.
      await d.tx(async (trx) => { await trx`update computadores set indisponivel_desde = null, falha_motivo = null, falhas_seguidas = 0 where modelo = 'por_pessoa'`; });
    });
    const p = await plano(b);
    expect(p.catalogo.ferramentas.filter((f) => f.origem === "computador").map((f) => f.nome)).toContain("computador_observar");
    expect(p.promptSistema).not.toContain("fora do ar");
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === b.agente.id)?.computadorForaDoAr).toBeNull();
  }, 30000);
});
