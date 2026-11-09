import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { FabricaSocket } from "../../src/adapters/executor/cerebro-ligacao.ts";
import type { Driver } from "../../src/adapters/executor/spi.ts";
import { NOTA_CONEXAO_VOLTOU } from "../../src/adapters/voz/orquestrador.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao } from "../../src/contracts/ligacao.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Rotina } from "../../src/contracts/rotina.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import type { MsgMidiaServidor } from "../../src/contracts/voz.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Ligação ponta a ponta com custo zero (definido em 2026-10-04, ADR-071/072): servidor completo, executor catcher em
 * modo ligação (responde "Entendi: …") e voz falsa (STT roteirizado, TTS de silêncio). Um cliente WebSocket faz o papel
 * do app: abre a mídia com cookie e Origin, ouve a saudação, fala por texto e por áudio, desliga. Confere a linha
 * "Chat de voz", a transcrição, o resumo do bot e o turno-cérebro concluído.
 */
let srv: ServidorCompleto;
const criados = { agentes: [] as string[], conversas: [] as string[] };

beforeAll(async () => {
  srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas", NOD_VOZ_FALSO_ROTEIRO: "Oi, tudo bem com você?|pode criar" } });
});

afterAll(async () => {
  try {
    await srv.fechar();
  } finally {
    await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
    await srv.desligar();
  }
});

type Cliente = { msgs: MsgMidiaServidor[]; quadrosDeVoz: number; ws: WebSocket; fechou: string | null; esperarMsg(f: (m: MsgMidiaServidor) => boolean, nome: string, timeoutMs?: number): Promise<MsgMidiaServidor> };

async function abrirMidia(ligacaoId: string, origin: string, s: ServidorCompleto = srv): Promise<Cliente> {
  const url = `${s.url.replace("http", "ws")}/api/t/${s.pessoa.tenantId}/voz/v1/midia`;
  const ws = new WebSocket(url, { headers: { cookie: s.pessoa.cookie, origin } });
  const c: Cliente = {
    msgs: [],
    quadrosDeVoz: 0,
    ws,
    fechou: null,
    async esperarMsg(f, nome, timeoutMs = 8_000) {
      return s.esperar(async () => {
        const m = c.msgs.find(f);
        if (m) return m;
        // NOD-184: a mídia fechada pelo servidor não traz mais nada — falha já, com o motivo, em vez de estourar o prazo.
        if (c.fechou) throw new Error(`a mídia fechou (${c.fechou}) esperando: ${nome}`);
        return null;
      }, { nome, timeoutMs });
    },
  };
  ws.on("close", (codigo, motivo) => {
    c.fechou = `${codigo} ${String(motivo)}`.trim();
  });
  ws.on("message", (dados, binario) => {
    if (binario) {
      c.quadrosDeVoz++;
      const b = dados as Buffer;
      // O cliente de verdade relata o fim de cada fala; aqui, na hora (o TTS falso é silêncio).
      const utt = b.readUInt16LE(5);
      ws.send(JSON.stringify({ t: "tocou-fim", utt }));
      return;
    }
    c.msgs.push(JSON.parse(String(dados)) as MsgMidiaServidor);
  });
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
    ws.once("unexpected-response", (_req, res) => j(new Error(`upgrade recusado: ${res.statusCode}`)));
  });
  ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId, entrada: "pcm16", saida: "pcm16" }));
  return c;
}

/** 20 ms de PCM16 16 kHz com um tom (fala) ou silêncio, no quadro 0x01 do protocolo. */
function quadroMicrofone(seq: number, comVoz: boolean): Buffer {
  const amostras = 320;
  const b = Buffer.alloc(5 + amostras * 2);
  b.writeUInt8(0x01, 0);
  b.writeUInt32LE(seq, 1);
  for (let i = 0; i < amostras; i++) b.writeInt16LE(comVoz ? Math.round(Math.sin((i + seq * amostras) / 6) * 9000) : 0, 5 + i * 2);
  return b;
}

/**
 * Uma fala pelo microfone no ritmo do app: blocos de 100 ms (5 quadros) em tempo real. Em rajada, as duas falas do teste
 * (3,6 s de áudio) chegavam ~1,2 s depois de a mídia abrir, acima de 1,2× o tempo real + 2 s: a guarda de abuso fechava a
 * mídia com 4429 e o "pode criar" nunca virava comando (NOD-184; só passava com o Mac lento).
 */
async function falarPeloMicrofone(cli: Cliente, seq: { n: number }, quadrosComVoz: number, quadrosDeSilencio: number): Promise<void> {
  const total = quadrosComVoz + quadrosDeSilencio;
  for (let i = 0; i < total; i++) {
    cli.ws.send(quadroMicrofone(seq.n++, i < quadrosComVoz));
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
  }
}

it("liga, ouve a saudação, fala por texto e por áudio, desliga: linha, transcrição, resumo e turno concluído", async () => {
  const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
  // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
  await srv.json("POST", `agentes/${agente.id}/modo-aprovacao`, { modo: "manual" });
  criados.agentes.push(agente.id);
  criados.conversas.push(conversa.id);

  const antes = await srv.json<DisponibilidadeLigacao>("GET", `ligacoes/disponibilidade?agenteId=${agente.id}`);
  expect(antes).toMatchObject({ disponivel: true, consentimentoNecessario: true });
  // Sem consentimento a ligação é recusada.
  expect((await srv.chamar("POST", "ligacoes", { agenteId: agente.id })).status).toBe(409);
  await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });

  const { ligacao } = await srv.json<{ ligacao: Ligacao; maxS: number }>("POST", "ligacoes", { agenteId: agente.id });
  expect(ligacao.estado).toBe("chamando");
  // Uma ligação viva por pessoa.
  expect((await srv.chamar("POST", "ligacoes", { agenteId: agente.id })).status).toBe(409);

  // Origin de outro site: recusado no upgrade.
  await expect(abrirMidia(ligacao.id, "https://outro.exemplo")).rejects.toThrow(/403/);

  const host = new URL(srv.url).host;
  const cli = await abrirMidia(ligacao.id, `http://${host}`);
  await cli.esperarMsg((m) => m.t === "pronto", "pronto");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Nina"), "saudação");
  // O catcher puxa o turno da ligação e abre o canal do cérebro.
  await cli.esperarMsg((m) => m.t === "cerebro" && m.online, "cérebro online", 10_000);

  cli.ws.send(JSON.stringify({ t: "texto", conteudo: "quero criar uma rotina" }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("quero criar uma rotina"), "resposta ao texto");

  // Fala por áudio: 600 ms de tom e 1,2 s de silêncio → STT falso → "Oi, tudo bem com você?".
  const seq = { n: 0 };
  await falarPeloMicrofone(cli, seq, 30, 60);
  await cli.esperarMsg((m) => m.t === "legenda" && m.final && m.texto.includes("tudo bem"), "legenda final");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("tudo bem"), "resposta à fala");
  expect(cli.quadrosDeVoz).toBeGreaterThan(0);

  const viva = await srv.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva");
  expect(viva.ligacao?.estado).toBe("em_curso");

  // Aprovação por voz (ADR-074): o bot propõe uma rotina; o servidor lê o card, abre a janela, e "pode criar" vira um
  // comando que o cliente manda à rota de decisão — que confere o comando de uso único e cria a rotina.
  const rotina = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "poste um resumo dos PRs abertos", fonte: "PRs abertos", entregavel: "resumo curto", limites_aprovacao: "nada sai sem aprovação", politica_sem_dado: "diga que não houve" };
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `cria uma rotina [[tool: criar_rotina ${JSON.stringify(rotina)}]] [[delta: Proposta de rotina enviada.]]` }));
  const leitura = await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "leitura", "leitura do card", 10_000);
  expect(leitura.t === "bot-fala" && leitura.texto).toMatch(/Para aprovar/);
  const janela = await cli.esperarMsg((m) => m.t === "janela", "janela aberta");
  const decisaoId = janela.t === "janela" ? janela.decisaoId : "";
  // Um comando forjado (sem passar pela janela) é recusado.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: "forjado", acao: "aprovar" })).status).toBe(403);
  await falarPeloMicrofone(cli, seq, 30, 60);
  const comando = await cli.esperarMsg((m) => m.t === "comando", "comando de voz");
  if (comando.t !== "comando") throw new Error("sem comando");
  expect(comando.acao).toBe("aprovar");
  // A voz decide o card inteiro: "sempre" junto é recusado, e o comando continua válido para o pedido certo.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar", sempre: true })).status).toBe(400);
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar" })).status).toBe(200);
  // Uso único.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar" })).status).toBe(403);
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("aprovado"), "resultado falado");
  const rotinas = await srv.json<{ rotinas: { id: string }[] } | { id: string }[]>("GET", `agentes/${agente.id}/rotinas`).catch(() => null);
  if (rotinas) expect(Array.isArray(rotinas) ? rotinas.length : rotinas.rotinas.length).toBeGreaterThan(0);

  // iniciar_tarefa (ADR-072): o trabalho vira um turno do bot ligado à ligação; quando termina, o bot avisa falando.
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `revisa o PR [[tool: iniciar_tarefa {"pedido":"revisar o PR 42"}]] [[delta: Vou revisar e te aviso.]]` }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Vou revisar"), "bot anuncia a tarefa");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Aviso recebido"), "aviso falado do fim da tarefa", 15_000);

  cli.ws.send(JSON.stringify({ t: "tchau" }));
  await cli.esperarMsg((m) => m.t === "fim", "fim");

  const encerrada = await srv.esperar(async () => {
    const l = await srv.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva");
    return l.ligacao === null ? true : null;
  }, { nome: "ligação encerrada" });
  expect(encerrada).toBe(true);

  const { falas } = await srv.json<{ falas: FalaLigacao[] }>("GET", `ligacoes/${ligacao.id}/falas`);
  expect(falas.filter((f) => f.autor === "pessoa").map((f) => f.texto)).toEqual(expect.arrayContaining(["quero criar uma rotina", "Oi, tudo bem com você?", "pode criar"]));
  expect(falas.some((f) => f.tipo === "leitura")).toBe(true);
  expect(falas.some((f) => f.autor === "bot" && f.texto.includes("Entendi"))).toBe(true);

  // A linha "Chat de voz · mm:ss" e o resumo do bot (o turno-cérebro entregou no `fim`).
  const dto = await srv.esperar(async () => {
    const d = await srv.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`);
    return d.mensagens.some((m) => m.texto.startsWith("Resumo da ligação")) ? d : null;
  }, { nome: "resumo na conversa", timeoutMs: 15_000 });
  const linha = dto.mensagens.find((m) => m.payload?.kind === "ligacao");
  expect(linha?.texto).toMatch(/^Chat de voz · \d\d:\d\d$/);
  // O turno-cérebro nunca aparece como trabalho do bot na tela.
  expect(dto.turnosEmCurso ?? []).toEqual([]);

  // Apagar a transcrição: as falas somem, o registro e o resumo ficam.
  await srv.json("DELETE", `ligacoes/${ligacao.id}/falas`);
  const depois = await srv.json<{ falas: FalaLigacao[]; apagadaEm: number | null }>("GET", `ligacoes/${ligacao.id}/falas`);
  expect(depois.falas).toEqual([]);
  expect(depois.apagadaEm).not.toBeNull();
  await srv.json("POST", `ligacoes/${ligacao.id}/avaliacao`, { nota: "boa" });
}, 60_000);

/**
 * O cérebro cai no meio (definido em 2026-10-05, rede de segurança da ligação). Reproduz, com custo zero, a ligação de
 * produção do mesmo dia: a conta do Claude Code logada e sem acesso, o turno-cérebro falha, e a bot ficava muda depois da
 * saudação. Servidor completo com DUAS IAs falsas no lugar dos CLIs (o laço de voz do catcher atrás de cada uma): a que
 * faz o papel do Claude Code cai quando o teste manda, entregando a falha com `causaSemIa` como o laço de voz de verdade
 * faz (comContaSemAcesso); a do Codex funciona. Prova que a frase sai, que o aviso chega à mídia, que nada do que a pessoa diz na espera
 * vira vez, e que "continuar com o ChatGPT" abre OUTRO turno-cérebro para a MESMA ligação, no outro harness.
 */
describe("o cérebro cai no meio da ligação", () => {
  let srv2: ServidorCompleto;
  const criados2 = { agentes: [] as string[], conversas: [] as string[] };
  const planos: PlanoTurno[] = [];
  let derrubarOClaude: () => void = () => undefined;
  const queda = new Promise<void>((r) => { derrubarOClaude = r; });

  function iaFalsa(id: "claude-cli" | "codex-cli", urlNod: string): Driver {
    const base = criarCatcherDriver({ urlNod });
    return {
      meta: { id, locality: "local" },
      async create(cfg) {
        const inst = await base.create(cfg);
        return {
          sondar: async () => ({ estado: "pronto", versao: `${id}-falso`, em: Date.now() }),
          dispose: () => inst.dispose(),
          adapter(plano) {
            planos.push(plano);
            const a = inst.adapter(plano);
            if (id !== "claude-cli" || plano.modoTurno !== "ligacao") return a;
            return {
              async rodarTurno(sinks) {
                const rodando = a.rodarTurno(sinks);
                await queda;
                // O CLI morreu: o laço de voz fecha o canal do cérebro e o turno é entregue como falha, com a causa.
                await a.interromper();
                const r = await rodando;
                // O mesmo formato que o laço de voz do Claude entrega (comContaSemAcesso, src/domain/conta-da-ia.ts).
                const { motivoInterrupcao: _fora, ...resto } = r;
                return { ...resto, desfecho: "falha", motivoFalha: "nao_autenticado", texto: "", erroCru: "conta sem acesso (simulado)", causaSemIa: "conta_sem_acesso" };
              },
              interromper: () => a.interromper(),
            };
          },
        };
      },
    };
  }

  beforeAll(async () => {
    srv2 = await servidorCompleto({ env: { NOD_LIGACAO: "todas", NOD_EXECUTOR: "auto", NOD_MODELO: "auto" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod }), iaFalsa("claude-cli", urlNod), iaFalsa("codex-cli", urlNod)] });
  }, 30_000);

  /**
   * O Mac anuncia as duas IAs, como o app desktop faz (`harnesses`). Sem isso, o orquestrador local anuncia um inventário
   * só, e a reprovação da IA que caiu (ponte-interna, reprovarHarness) deixa a máquina sem nenhuma IA pronta até o
   * próximo anúncio dele (60 s): o turno do Codex não seria reivindicado.
   */
  async function anunciarAsDuasIas(): Promise<void> {
    const pronto = { estado: "pronto", versao: "falso", em: Date.now() } as const;
    await srv2.app.ponte.conectar({ machineId: srv2.machineId, nome: "mac-de-teste", inventario: pronto, versaoContrato: 1, ligacao: true, harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
  }

  afterAll(async () => {
    if (!srv2) return;
    derrubarOClaude();
    try {
      await srv2.fechar();
    } finally {
      await limparPessoaE2E(srv2.db, srv2.dbDono, { tenantId: srv2.pessoa.tenantId, pessoaId: srv2.pessoa.pessoaId }, criados2);
      await srv2.desligar();
    }
  }, 30_000);

  it("a frase sai, o aviso chega à mídia, a espera não cria vez, e continuar com a outra IA reabre o cérebro na mesma ligação", async () => {
    const { agente, conversa } = await srv2.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
    await srv2.json("POST", `agentes/${agente.id}/modo-aprovacao`, { modo: "manual" });
    criados2.agentes.push(agente.id);
    criados2.conversas.push(conversa.id);
    await srv2.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv2.json<{ ligacao: Ligacao; maxS: number }>("POST", "ligacoes", { agenteId: agente.id });

    const cli = await abrirMidia(ligacao.id, `http://${new URL(srv2.url).host}`, srv2);
    await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Nina"), "saudação");
    await cli.esperarMsg((m) => m.t === "cerebro" && m.online, "cérebro online", 10_000);
    // O bot em automático roda no Claude (o preferido); é esse o primeiro turno-cérebro.
    const primeiro = await srv2.esperar(async () => planos.find((p) => p.modoTurno === "ligacao") ?? null, { nome: "plano do primeiro cérebro" });
    expect(primeiro).toMatchObject({ harness: "claude-cli", ligacaoVoz: { ligacaoId: ligacao.id } });

    // Com o cérebro de pé, ninguém abre um segundo: a rota só vale com a ligação esperando a escolha.
    expect((await srv2.chamar("POST", `ligacoes/${ligacao.id}/continuar`, { ia: "codex-cli" })).status).toBe(409);

    cli.ws.send(JSON.stringify({ t: "texto", conteudo: "oi, tudo certo" }));
    await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("tudo certo"), "resposta do primeiro cérebro");

    // ---- o cérebro cai ----
    await anunciarAsDuasIas();
    derrubarOClaude();
    const aviso = await cli.esperarMsg((m) => m.t === "sem-ia", "aviso sem IA", 20_000);
    expect(aviso).toMatchObject({ t: "sem-ia", causa: "conta_sem_acesso", ia: "claude-cli", ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }] });
    if (aviso.t === "sem-ia") expect(aviso.ate).toBeGreaterThan(Date.now() + 60_000);
    const frase = await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto === "Não consegui usar a IA deste Mac. As opções estão na tela.", "a frase fixa");
    expect(frase).toMatchObject({ tipo: "aviso" });
    await cli.esperarMsg((m) => m.t === "estado" && m.fase === "aguardando_escolha", "esperando a escolha");
    // O turno que caiu ficou interrompido, com o motivo; a ligação segue viva.
    const caido = await srv2.esperar(async () => {
      const { turno } = await srv2.json<{ turno: Turno }>("GET", `turnos/${primeiro.turnoId}`);
      return turno.estado === "interrompido" ? turno : null;
    }, { nome: "turno-cérebro interrompido" });
    expect(caido).toMatchObject({ origem: "ligacao", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" });
    expect((await srv2.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva")).ligacao).toMatchObject({ id: ligacao.id, estado: "em_curso" });

    // ---- a espera não cobra a pessoa: o que ela escreve agora não vira vez nem resposta ----
    const antes = cli.msgs.length;
    cli.ws.send(JSON.stringify({ t: "texto", conteudo: "alguém me ouve?" }));
    await new Promise((r) => setTimeout(r, 600));
    const naEspera = cli.msgs.slice(antes);
    expect(naEspera.filter((m) => m.t === "estado" && (m.fase === "pensando" || m.fase === "ouvindo"))).toEqual([]);
    expect(naEspera.filter((m) => m.t === "bot-fala" && m.tipo === "conteudo")).toEqual([]);

    // ---- continuar com a outra IA ----
    expect((await srv2.chamar("POST", `ligacoes/${ligacao.id}/continuar`, { ia: "gemini" })).status).toBe(400);
    const { ligacao: mesma } = await srv2.json<{ ligacao: Ligacao }>("POST", `ligacoes/${ligacao.id}/continuar`, { ia: "codex-cli" });
    expect(mesma).toMatchObject({ id: ligacao.id, religacoes: 1 });
    // Já escolhido: a segunda chamada não abre um terceiro cérebro.
    expect((await srv2.chamar("POST", `ligacoes/${ligacao.id}/continuar`, { ia: "codex-cli" })).status).toBe(409);

    const voltou = await cli.esperarMsg((m) => m.t === "ia-voltou", "o cérebro novo atendeu", 20_000);
    expect(voltou).toEqual({ t: "ia-voltou", ia: "codex-cli", trocou: true });
    const segundo = await srv2.esperar(async () => planos.find((p) => p.modoTurno === "ligacao" && p.turnoId !== primeiro.turnoId) ?? null, { nome: "plano do segundo cérebro" });
    expect(segundo).toMatchObject({ harness: "codex-cli", executor: "local", ligacaoVoz: { ligacaoId: ligacao.id } });
    expect(segundo.conversaId).toBe(primeiro.conversaId);
    // A bot retoma em voz pelo cérebro novo: o pedido de retomada chega a ele como uma vez do sistema, e o catcher
    // responde "Entendi: <o que recebeu>" — a resposta é falada.
    await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("Você assumiu a ligação agora"), "a bot retoma", 20_000);
    // …e a ligação voltou a ouvir: a vez seguinte é respondida por ele.
    cli.ws.send(JSON.stringify({ t: "texto", conteudo: "agora sim" }));
    await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("agora sim"), "resposta do cérebro novo");
    expect((await srv2.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva")).ligacao?.id).toBe(ligacao.id);

    // ---- a ligação termina como qualquer outra: uma linha, um resumo, o turno novo concluído ----
    cli.ws.send(JSON.stringify({ t: "tchau" }));
    await cli.esperarMsg((m) => m.t === "fim" && m.motivo === "pessoa_desligou", "fim");
    const concluido = await srv2.esperar(async () => {
      const { turno } = await srv2.json<{ turno: Turno }>("GET", `turnos/${segundo.turnoId}`);
      return turno.estado === "concluido" ? turno : null;
    }, { nome: "segundo turno-cérebro concluído", timeoutMs: 15_000 });
    expect(concluido).toMatchObject({ origem: "ligacao", harness: "codex-cli" });
    const dto = await srv2.esperar(async () => {
      const d = await srv2.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`);
      return d.mensagens.some((m) => m.texto.startsWith("Resumo da ligação")) ? d : null;
    }, { nome: "resumo na conversa", timeoutMs: 15_000 });
    expect(dto.mensagens.filter((m) => m.payload?.kind === "ligacao")).toHaveLength(1);
    const { falas } = await srv2.json<{ falas: FalaLigacao[] }>("GET", `ligacoes/${ligacao.id}/falas`);
    expect(falas.some((f) => f.autor === "bot" && f.texto === "Não consegui usar a IA deste Mac. As opções estão na tela.")).toBe(true);
    // O que foi escrito na espera não entrou na ligação.
    expect(falas.some((f) => f.texto.includes("alguém me ouve"))).toBe(false);
  }, 120_000);
});

/**
 * NOD-168: a rede do Mac cai com o card de aprovação na tela. O canal do cérebro fecha sem código de fim, o executor
 * religa a MESMA sessão e o servidor manda "A conexão voltou" em vez da abertura. Aprovar na tela durante a queda (dois
 * cliques ao mesmo tempo) decide uma vez só, cria uma rotina só, e a nota da decisão chega ao cérebro quando ele volta, depois da de religação.
 */
describe("a rede cai com o card na tela (NOD-168)", () => {
  let srv3: ServidorCompleto;
  const criados3 = { agentes: [] as string[], conversas: [] as string[] };
  const sockets: { s: { close(codigo?: number): void }; recebidas: Record<string, unknown>[] }[] = [];
  const fabricaEspia: FabricaSocket = (url, headers) => {
    const Ctor: unknown = Reflect.get(globalThis, "WebSocket");
    const s = Reflect.construct(Ctor as new (...a: unknown[]) => object, [url, { headers }]) as ReturnType<FabricaSocket>;
    const espia = { s, recebidas: [] as Record<string, unknown>[] };
    s.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") espia.recebidas.push(JSON.parse(ev.data) as Record<string, unknown>);
    });
    sockets.push(espia);
    return s;
  };

  beforeAll(async () => {
    srv3 = await servidorCompleto({ env: { NOD_LIGACAO: "todas" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, fabricaSocket: fabricaEspia })] });
  }, 30_000);

  afterAll(async () => {
    if (!srv3) return;
    try {
      await srv3.fechar();
    } finally {
      await limparPessoaE2E(srv3.db, srv3.dbDono, { tenantId: srv3.pessoa.tenantId, pessoaId: srv3.pessoa.pessoaId }, criados3);
      await srv3.desligar();
    }
  }, 30_000);

  it("aprovar durante a queda decide uma vez; o cérebro religado recebe a nota, não a abertura", async () => {
    const { agente, conversa } = await srv3.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
    await srv3.json("POST", `agentes/${agente.id}/modo-aprovacao`, { modo: "manual" });
    criados3.agentes.push(agente.id);
    criados3.conversas.push(conversa.id);
    await srv3.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv3.json<{ ligacao: Ligacao; maxS: number }>("POST", "ligacoes", { agenteId: agente.id });
    const cli = await abrirMidia(ligacao.id, `http://${new URL(srv3.url).host}`, srv3);
    await cli.esperarMsg((m) => m.t === "cerebro" && m.online, "cérebro online", 10_000);

    const rotina = { cron: "0 9 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "resuma os PRs abertos", fonte: "PRs abertos", entregavel: "resumo curto", limites_aprovacao: "nada sai sem aprovação", politica_sem_dado: "diga que não houve" };
    cli.ws.send(JSON.stringify({ t: "texto", conteudo: `cria uma rotina [[tool: criar_rotina ${JSON.stringify(rotina)}]] [[delta: Proposta enviada.]]` }));
    const janela = await cli.esperarMsg((m) => m.t === "janela", "janela aberta", 10_000);
    const decisaoId = janela.t === "janela" ? janela.decisaoId : "";
    expect(sockets).toHaveLength(1);

    // ---- a rede cai: fechamento sem código de fim, o executor vai religar ----
    sockets[0]?.s.close(4000);
    await cli.esperarMsg((m) => m.t === "cerebro" && !m.online, "cérebro fora");
    const [a, b] = await Promise.all([srv3.chamar("POST", `decisoes/${decisaoId}/decidir`, {}), srv3.chamar("POST", `decisoes/${decisaoId}/decidir`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    // ---- religou: a mesma sessão, outro socket ----
    await srv3.esperar(async () => (cli.msgs.filter((m) => m.t === "cerebro" && m.online).length >= 2 ? true : null), { nome: "cérebro religado", timeoutMs: 10_000 });
    const religado = await srv3.esperar(async () => {
      const r = sockets[1]?.recebidas ?? [];
      return r.some((m) => m.t === "nota" && typeof m.texto === "string" && m.texto.includes("decidiu na tela")) ? r : null;
    }, { nome: "nota da decisão no cérebro religado" });
    expect(religado.filter((m) => m.t === "nota").map((m) => m.texto)[0]).toBe(NOTA_CONEXAO_VOLTOU);
    expect(religado.filter((m) => m.t === "nota" && m.texto === NOTA_CONEXAO_VOLTOU)).toHaveLength(1);
    expect(religado.filter((m) => m.t === "vez" && m.n === 0)).toEqual([]);

    const { rotinas } = await srv3.json<{ rotinas: { rotina: Rotina }[] }>("GET", "rotinas");
    expect(rotinas.filter((x) => x.rotina.agenteId === agente.id)).toHaveLength(1);
    // A ligação seguiu viva e responde de novo.
    cli.ws.send(JSON.stringify({ t: "texto", conteudo: "voltou?" }));
    await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("voltou?"), "resposta depois da religação", 10_000);
    cli.ws.send(JSON.stringify({ t: "tchau" }));
    await cli.esperarMsg((m) => m.t === "fim", "fim");
  }, 60_000);
});
