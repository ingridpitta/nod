import { describe, expect, it, vi } from "vitest";
import { ErroTransporteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";
import { ErroBancoOcupado, ErroTxEncerrada } from "../../../src/db/tx.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano, PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { chamarFerramenta, errosDoSchema, validarArgsNod } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { criarConectoresVivos } from "../../../src/services/conectores-vivos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos, type OpcoesDepsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;

const nod = (nome: keyof typeof FERRAMENTAS_NOD): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] });

async function cenario(opcoes: OpcoesDepsFalsos = {}, plano: Partial<PlanoTurno> = {}) {
  const { deps, banco, chamadas, contextos } = depsFalsos({ agora: AGORA, ...opcoes });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  // NOD-316: o bot nasce em Automático; estes casos partem do Manual, explícito.
  await deps.repos.agentes.definirModoAprovacao(agente?.id ?? "", "manual");
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const conectorId = conector?.id ?? "";
  await deps.repos.conectores.registrarSonda(conectorId, {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "somar", descricao: "soma", schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }, readOnlyHint: true },
      { nome: "enviar", descricao: "envia", schema: { type: "object", properties: { para: { type: "string" } }, required: ["para"] }, readOnlyHint: false },
    ],
  });
  const consentimento = await deps.repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: { autor_tipo: "pessoa", autor_id: deps.escopo.pessoaId, sob_procuracao_de: null, conta_de_execucao: deps.escopo.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "consentimento", texto: "ok", confianca: "confiavel" });
  await deps.repos.concessoes.conceder({ agenteId: agente?.id ?? "", conectorId, capacidade: "somar", mensagemId: consentimento?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  await deps.repos.turnos.reivindicar({ machineId: "m1", agora: AGORA });
  const turnoId = turno?.id ?? "";
  const agenteId = agente?.id ?? "";
  const conversaId = conversa?.id ?? "";
  const planoBase = planoDeTeste({
    turnoId,
    agenteId,
    conversaId,
    expiraEm: AGORA + 60_000,
    catalogo: {
      ferramentas: [
        nod("lembrar"),
        nod("pedir_aprovacao"),
        nod("pedir_a_pessoa"),
        { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
        { nome: "exemplo__enviar", nomeMcp: "mcp__nod__exemplo__enviar", origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object", properties: { para: { type: "string" } }, required: ["para"] } },
      ],
      servidores: [{ conectorId, nome: "exemplo", trust: "untrusted", transporte: "stdio" }],
    },
    ...plano,
  });
  const chamar = (nome: string, argumentos: unknown, p: PlanoTurno | null = planoBase) => chamarFerramenta(deps as Deps, { turnoId, agenteId, nome, argumentos, plano: p });
  const trilha = () => banco.trilha.map((l) => [l.kind, l.ferramenta, l.motivo] as const);
  const turnoAtual = () => banco.turnos.find((t) => t.id === turnoId);
  return { deps, banco, chamadas, contextos, chamar, trilha, turnoAtual, turnoId, agenteId, conversaId, conectorId, consentimentoId: consentimento?.id ?? "", plano: planoBase };
}

describe("chamarFerramenta: gates, despacho por tabela e trilha (ADR-013, EMENDA 5/10/16; sem o gate da EMENDA 15 desde a ADR-066)", () => {
  it("sem plano ou plano expirado → negação terminal plano_ausente, trilha escrita, turno interrompido", async () => {
    const c = await cenario();
    const r1 = await c.chamar("lembrar", { tipo: "fato", texto: "x" }, null);
    expect(r1.data).toMatchObject({ ok: false, negacao: { classe: "plano_ausente", motivo: "plano_ausente", terminal: true, desde: AGORA } });
    const r2 = await c.chamar("lembrar", { tipo: "fato", texto: "x" }, { ...c.plano, expiraEm: AGORA });
    expect(r2.data).toMatchObject({ ok: false, negacao: { motivo: "plano_expirado", terminal: true } });
    expect(c.trilha()).toEqual([
      ["negacao", "lembrar", "plano_ausente"],
      ["negacao", "lembrar", "plano_expirado"],
    ]);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBe(AGORA);
    expect(r1.events?.map((e) => e.kind)).toEqual(["negacao"]);
  });

  it("parada ativa é terminal; consulta que FALHA (null) também é parada (EMENDA 10)", async () => {
    const c = await cenario();
    await c.deps.repos.paradas.ativar({ conversaId: c.conversaId, agora: AGORA });
    const r = await c.chamar("lembrar", { tipo: "fato", texto: "x" });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "ferramenta_negada", motivo: "parada_ativa", terminal: true } });
    expect(c.chamadas).toHaveLength(0);

    const d = await cenario();
    d.deps.repos.paradas.ativa = async () => null;
    const rNull = await d.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(rNull.data).toMatchObject({ ok: false, negacao: { motivo: "parada_ativa", terminal: true } });
    expect(d.chamadas).toHaveLength(0);
  });

  // NOD-311: o Parar do chat não deixa parada aberta; a trava do turno parado é o pararSolicitadoEm dele.
  it("turno com Parar pedido (pararSolicitadoEm) é negado como parada_ativa, sem parada aberta", async () => {
    const c = await cenario();
    await c.deps.repos.turnos.pedirInterrupcao([c.turnoId], AGORA - 1);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBe(AGORA - 1);
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "ferramenta_negada", motivo: "parada_ativa", terminal: true } });
    expect(c.chamadas).toHaveLength(0);
  });

  it("nome fora do plano → fora_do_catalogo terminal (nunca chega ao conector)", async () => {
    const c = await cenario();
    const r = await c.chamar("exemplo__apagar_tudo", {});
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo", terminal: true } });
    expect(c.chamadas).toHaveLength(0);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBe(AGORA);
  });

  it("ferramenta nod: args inválidos → args_invalidos transitória (turno segue); args válidos despacham para deps.useCases pela tabela", async () => {
    const c = await cenario();
    const ruim = await c.chamar("lembrar", { tipo: "opiniao", texto: "x" });
    expect(ruim.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos", terminal: false } });
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
    const bom = await c.chamar("lembrar", { tipo: "fato", texto: "gosta de café" });
    expect(bom.data).toEqual({ ok: true, conteudo: JSON.stringify({ ok: true, id: "memoria-falsa" }), confianca: "confiavel" });
    expect(c.trilha()).toEqual([
      ["negacao", "lembrar", "args_invalidos"],
      ["tool_call", "lembrar", null],
    ]);
    expect(c.banco.catcher.map((r) => r.tipo)).toEqual(["tool_call"]);
  });

  it("NOD-61 (ADR-026): buscar_conversas e ler_conversa voltam nao_confiavel — o histórico tem conteúdo de fora; args fora do schema não despacham", async () => {
    const c = await cenario();
    const p = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: [...c.plano.catalogo.ferramentas, nod("buscar_conversas"), nod("ler_conversa")] } };
    c.deps.useCases.buscarConversas = async () => ({ data: { resultados: [], mais_antigos: null } });
    c.deps.useCases.lerConversa = async () => ({ data: { erro: "nao_encontrado" } });
    expect((await c.chamar("buscar_conversas", { termo: "orçamento" }, p)).data).toEqual({ ok: true, conteudo: JSON.stringify({ resultados: [], mais_antigos: null }), confianca: "nao_confiavel" });
    expect((await c.chamar("ler_conversa", { mensagem_id: "x" }, p)).data).toEqual({ ok: true, conteudo: JSON.stringify({ erro: "nao_encontrado" }), confianca: "nao_confiavel" });
    expect((await c.chamar("buscar_conversas", { termo: "a" }, p)).data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
  });

  it("pedir_aprovacao pendente vira {aguardar}; pedir_a_pessoa malformado vira decisão tipo 'pergunta', nunca 'permissao' (EMENDA 16)", async () => {
    const c = await cenario();
    const email = await c.deps.repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await c.deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, agora: AGORA, catalogo: [{ nome: "enviar", descricao: "", schema: { type: "object" }, readOnlyHint: false }] });
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "a", destino: { conector: "email", ferramenta: "enviar", argumentos: {} } }] });
    expect(r.data).toHaveProperty("aguardar");
    const decisaoId = (r.data as { aguardar: string }).aguardar;
    expect(c.banco.decisoes.find((d) => d.id === decisaoId)?.tipo).toBe("aprovacao");

    const p = await c.chamar("pedir_a_pessoa", { tipo: "permissao_total", quem_destrava: 42 });
    expect(p.data).toMatchObject({ ok: true, confianca: "confiavel" });
    const pergunta = c.banco.decisoes.find((d) => d.tipo === "pergunta");
    expect(pergunta).toBeDefined();
    expect(pergunta?.decisorId).toBe(c.deps.escopo.pessoaId);
    expect(c.banco.decisoes.some((d) => d.tipo === "permissao")).toBe(false);
    // Emenda da ADR-045: a conversa recebe a fala do agente LIGADA à decisão. Plano "pergunta com botões" (2026-10-18): a
    // frase da fila é a mesma fala, inteira — o molde "parei para perguntar a …" saiu.
    const fala = c.banco.mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa");
    expect(fala?.payload).toEqual({ kind: "pedido_a_pessoa", decisaoId: pergunta?.id });
    expect(fala?.texto).toBe("(pedido sem texto)");
    expect(pergunta?.frase).toBe("(pedido sem texto)");
    expect(c.banco.mensagens.some((m) => m.texto.startsWith("parei"))).toBe(false);
  });

  it("conector: concessão ativa lida AGORA — somar (concedida) chama o conector e volta nao_confiavel; enviar (sem concessão) é capacidade_desligada terminal", async () => {
    const c = await cenario();
    const ok = await c.chamar("exemplo__somar", { a: 17, b: 25 });
    expect(ok.data).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    expect(c.chamadas).toEqual([{ conectorId: c.conectorId, tool: "somar", args: { a: 17, b: 25 } }]);
    const negada = await c.chamar("exemplo__enviar", { para: "x" });
    expect(negada.data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada", terminal: true } });
    expect(c.chamadas).toHaveLength(1);
    expect(c.trilha()).toEqual([
      ["tool_call", "exemplo__somar", null],
      ["negacao", "exemplo__enviar", "capacidade_desligada"],
    ]);
    expect(c.banco.trilha[0]?.conectorId).toBe(c.conectorId);
  });

  it("NOD-443 (revisão 5 do PR #628, achado 1): a pedido de outra pessoa, nenhuma ferramenta de conector roda — nem a leitura concedida", async () => {
    const c = await cenario();
    const deOutra = { ...c.plano, autoria: { ...c.plano.autoria, sob_procuracao_de: "outra-pessoa" } };
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 }, deOutra);
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "ferramenta_negada", motivo: "fora_do_catalogo" } });
    expect(c.chamadas).toEqual([]);
    expect(c.trilha()).toEqual([["negacao", "exemplo__somar", "fora_do_catalogo"]]);
    expect(c.banco.trilha[0]?.conectorId).toBe(c.conectorId);
    // A procuração da própria dona (pedido de colega dela) lê como antes (cenário novo: a negação acima é terminal).
    const d = await cenario();
    const daDona = { ...d.plano, autoria: { ...d.plano.autoria, sob_procuracao_de: d.plano.autoria.conta_de_execucao } };
    expect((await d.chamar("exemplo__somar", { a: 1, b: 2 }, daDona)).data).toMatchObject({ ok: true });
  });

  it("NOD-443 (revisão 6 do PR #628, achado 5): a pedido de outra pessoa, nenhuma ferramenta fora da lista do pedido roda — nem do nod (ver_colegas, ler_artefato, lembrar) nem do computador", async () => {
    const computador: FerramentaPlano = { nome: "computador_observar", nomeMcp: "mcp__nod__computador_observar", origem: "computador", conectorId: null, readOnlyHint: true, tocaDadoPessoal: true, schema: { type: "object" } };
    const casos: [string, unknown][] = [["ver_colegas", {}], ["ler_artefato", { artefato_id: "00000000-0000-4000-8000-000000000000" }], ["lembrar", { tipo: "fato", texto: "x" }], ["computador_observar", {}]];
    for (const [nome, args] of casos) {
      const c = await cenario();
      const deOutra: PlanoTurno = { ...c.plano, autoria: { ...c.plano.autoria, sob_procuracao_de: "outra-pessoa" }, catalogo: { ...c.plano.catalogo, ferramentas: [...c.plano.catalogo.ferramentas, nod("ver_colegas"), nod("ler_artefato"), computador] } };
      const r = await c.chamar(nome, args, deOutra);
      expect(r.data, nome).toMatchObject({ ok: false, negacao: { classe: "ferramenta_negada", motivo: "fora_do_catalogo" } });
      expect(c.trilha(), nome).toEqual([["negacao", nome, "fora_do_catalogo"]]);
    }
    // O que a lista permite segue rodando (pedir_a_pessoa abre a pergunta), e a procuração da própria dona lê os colegas.
    const d = await cenario();
    const deOutra = { ...d.plano, autoria: { ...d.plano.autoria, sob_procuracao_de: "outra-pessoa" } };
    expect((await d.chamar("pedir_a_pessoa", { pergunta: "qual?" }, deOutra)).data).not.toMatchObject({ ok: false });
    const e = await cenario();
    const daDona: PlanoTurno = { ...e.plano, autoria: { ...e.plano.autoria, sob_procuracao_de: e.plano.autoria.conta_de_execucao }, catalogo: { ...e.plano.catalogo, ferramentas: [...e.plano.catalogo.ferramentas, nod("ver_colegas")] } };
    expect((await e.chamar("ver_colegas", {}, daDona)).data).toMatchObject({ ok: true });
  });

  it("revogação entre enfileirar e chamar → capacidade_desligada; conector desabilitado idem", async () => {
    const c = await cenario();
    const [g] = await c.deps.repos.concessoes.doAgente(c.agenteId);
    await c.deps.repos.concessoes.revogar(g?.id ?? "");
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
    const d = await cenario();
    await d.deps.repos.conectores.habilitar(d.conectorId, false);
    expect((await d.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
    expect(c.chamadas.length + d.chamadas.length).toBe(0);
  });

  it("ADR-066: não há mais gate de rotina — num turno de rotina a escrita direta passa pela decisão do modo: no manual, alcance_insuficiente TRANSITÓRIA (peça aprovação); no automático roda; readOnly passa sempre", async () => {
    const c = await cenario({}, { modoTurno: "rotina", politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 } });
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("exemplo__enviar", { para: "x" });
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: true });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["somar", "enviar"]);
  });

  it("ADR-066: ler um app de fora marca o turno; dali em diante, no manual, a regra 'Sempre permitir' cai e a escrita direta volta ao pedir_aprovacao — no automático segue", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
    expect(await c.deps.repos.turnos.contaminado(c.turnoId)).toBe(false);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    // "exemplo" não tem curadoria de conteúdo interno: chamar o app marca o turno (conectorTrazConteudoDeFora).
    expect(await c.deps.repos.turnos.contaminado(c.turnoId)).toBe(true);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["enviar", "enviar"]);
  });

  it("modos de aprovação, PR 1: a escrita direta que RODA conta o gatilho (via chamada); a que volta com 'peça aprovação' conta no pedir_aprovacao", async () => {
    const saida = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const c = await cenario();
      await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
      await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
      const medidas = () => saida.mock.calls.map((x) => String(x[0])).filter((l) => l.includes("\"revisor_seria_chamado\"")).map((l) => JSON.parse(l) as Record<string, unknown>);
      // Turno limpo: o envio roda pela regra da pessoa e não teria revisor.
      expect((await c.chamar("exemplo__enviar", { para: "segredo@fora" })).data).toMatchObject({ ok: true });
      expect(medidas()).toEqual([]);
      // A chamada marcou o turno: no manual, a próxima volta com "peça aprovação" e não conta aqui.
      expect((await c.chamar("exemplo__enviar", { para: "segredo@fora" })).data).toMatchObject({ ok: false });
      expect(medidas()).toEqual([]);
      await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
      // Revisão do PR #402: a chamada recusada pelo schema não roda e não conta (a corrigida contaria de novo).
      expect((await c.chamar("exemplo__enviar", { para: 42 })).data).toMatchObject({ ok: false });
      expect(medidas()).toEqual([]);
      expect((await c.chamar("exemplo__enviar", { para: "segredo@fora" })).data).toMatchObject({ ok: true });
      expect(medidas()).toEqual([expect.objectContaining({ gatilho: "envio_apos_fora", origem: "app", via: "chamada", modo: "automatico", contaminado: true, contaminado_conversa: true })]);
      expect(saida.mock.calls.map((x) => String(x[0])).join("\n")).not.toContain("segredo@fora");
    } finally {
      saida.mockRestore();
    }
  });

  it("ADR-066: merge e aprovar PR não têm mais negação direta — no manual pedem a pessoa até com 'Sempre permitir' (nunca permanente); no automático rodam na conversa e numa rotina (merge de PR não é 'apagar'; mesclar registros continua sendo)", async () => {
    const montar = async (capacidade: string, modoTurno: PlanoTurno["modoTurno"]) => {
      const c = await cenario();
      const catalogo = (await c.deps.repos.conectores.buscar(c.conectorId))?.catalogo ?? [];
      await c.deps.repos.conectores.registrarSonda(c.conectorId, { ok: true, agora: AGORA, catalogo: [...catalogo, { nome: capacidade, descricao: capacidade, schema: { type: "object" }, readOnlyHint: false }] });
      await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade, mensagemId: c.consentimentoId });
      const nome = `exemplo__${capacidade}`;
      const plano: PlanoTurno = { ...c.plano, modoTurno, catalogo: { ...c.plano.catalogo, ferramentas: [...c.plano.catalogo.ferramentas, { nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: c.conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } }] } };
      return { ...c, agir: () => c.chamar(nome, {}, plano) };
    };
    const manual = await montar("pr_merge", "conversa");
    await manual.deps.repos.permissoesPermanentes.criar({ agenteId: manual.agenteId, conectorId: manual.conectorId, capacidade: "pr_merge", itemOrigemId: "i", mensagemId: manual.consentimentoId, regraVersao: 1 });
    expect((await manual.agir()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(manual.chamadas).toHaveLength(0);
    // Antes da ADR-066 o merge era negado direto em QUALQUER modo (só por item de pedir_aprovacao).
    const naConversa = await montar("pr_merge", "conversa");
    await naConversa.deps.repos.agentes.definirModoAprovacao(naConversa.agenteId, "automatico");
    expect((await naConversa.agir()).data).toMatchObject({ ok: true });
    // Numa rotina (ninguém pediu na conversa), o arriscado pararia o automático: merge e revisar PR não são mais arriscados.
    const rodados: string[] = [];
    for (const capacidade of ["pr_merge", "GITHUB_MERGE_A_PULL_REQUEST", "pr_revisar"]) {
      const naRotina = await montar(capacidade, "rotina");
      await naRotina.deps.repos.agentes.definirModoAprovacao(naRotina.agenteId, "automatico");
      expect({ capacidade, r: (await naRotina.agir()).data }).toMatchObject({ capacidade, r: { ok: true } });
      rodados.push(...naRotina.chamadas.map((x) => x.tool));
    }
    expect([...naConversa.chamadas.map((x) => x.tool), ...rodados]).toEqual(["pr_merge", "pr_merge", "GITHUB_MERGE_A_PULL_REQUEST", "pr_revisar"]);
    // Mesclar REGISTROS (apaga um deles) continua no grupo "apagar": numa rotina, o automático para.
    const mesclar = await montar("CONTACTS_MERGE", "rotina");
    await mesclar.deps.repos.agentes.definirModoAprovacao(mesclar.agenteId, "automatico");
    expect((await mesclar.agir()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(mesclar.chamadas).toHaveLength(0);
  });

  it("ADR-062: a escrita direta passa pela decisão do card — no manual pede aprovação, com regra ou no automático roda", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    // A regra "Sempre permitir" vale pela linha ativa agora, no mesmo turno.
    const regra = await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    await c.deps.repos.permissoesPermanentes.desativar(regra?.id ?? "", "revogada_pela_pessoa", AGORA);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["enviar", "enviar"]);
  });

  it("ADR-062: pedir_aprovacao confere os argumentos no schema do conector — o erro volta ao bot como dado, sem card", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "a", destino: { conector: "exemplo", ferramenta: "enviar", argumentos: {} } }] });
    expect(r.data).toMatchObject({ ok: true });
    const volta = JSON.parse((r.data as { conteudo: string }).conteudo) as { estado: string; erros: string[]; instrucao: string };
    expect(volta.estado).toBe("recusada");
    expect(volta.erros.join(" ")).toContain("para");
    expect(volta.erros.join(" ")).toContain("exemplo.enviar");
    expect(c.banco.decisoes).toHaveLength(0);
  });

  it("conector que cai → conector_indisponivel transitória; a queda sozinha não marca o app (NOD-374: a sonda de confirmação decide); args fora do schema do conector → args_invalidos", async () => {
    const c = await cenario({ responder: () => { throw new Error("conector_indisponivel"); } });
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "conector_indisponivel", terminal: false } });
    expect(await c.deps.repos.conectores.buscar(c.conectorId)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, timeoutsSeguidos: 0 });
    const invalido = await c.chamar("exemplo__somar", { a: "um" });
    expect(invalido.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    expect(c.chamadas).toHaveLength(1);
  });

  it("NOD-157: o readOnlyHint chega ao serviço como somenteLeitura; ferramenta sem o hint é tratada como escrita", async () => {
    const c = await cenario();
    await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(c.contextos).toEqual([{ rotina: false, somenteLeitura: true }]);
    // Escrita (hint falso) e ferramenta sem o hint: as duas chegam como escrita, que só repete em 429.
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    await c.chamar("exemplo__enviar", { para: "x" });
    expect(c.contextos[1]).toEqual({ rotina: false, somenteLeitura: false });
    const semHint = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: c.plano.catalogo.ferramentas.map((f) => (f.nome === "exemplo__enviar" ? { ...f, readOnlyHint: undefined as unknown as boolean } : f)) } };
    await c.chamar("exemplo__enviar", { para: "x" }, semHint);
    expect(c.contextos[2]).toEqual({ rotina: false, somenteLeitura: false });
  });

  it("NOD-157/374: chamada que recupera dentro do serviço não escreve no app; a que esgota por timeout conta UMA vez e nega", async () => {
    const ok = await cenario();
    const gravarOk = vi.spyOn(ok.deps.repos.conectores, "gravarEstadoFalha");
    await ok.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(gravarOk).not.toHaveBeenCalled();
    expect((await ok.deps.repos.conectores.buscar(ok.conectorId))?.ultimaFalha).toBeNull();

    const t = await cenario({ responder: () => { throw new Error("timeout_transporte"); } });
    const gravar = vi.spyOn(t.deps.repos.conectores, "gravarEstadoFalha");
    const rt = await t.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(rt.data).toMatchObject({ ok: false, negacao: { motivo: "timeout_transporte" } });
    expect(await t.deps.repos.conectores.buscar(t.conectorId)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, timeoutsSeguidos: 1 });

    const c = await cenario({ responder: () => { throw new Error("conector_indisponivel"); } });
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "conector_indisponivel", terminal: false } });
    expect(r.data).not.toHaveProperty("negacao.causa");
  });

  it.each([
    ["banco_ocupado", () => new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 10_000)],
    ["tx_encerrada", () => new ErroTxEncerrada()],
    ["statement_timeout (57014)", () => Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })],
    ["lock_timeout (55P03)", () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" })],
  ])("NOD-266: %s durante a chamada é falha nossa, não do app — relança sem marcar o app nem negação", async (_nome, erro) => {
    const c = await cenario({ responder: () => { throw erro(); } });
    const marcar = vi.spyOn(c.deps.repos.conectores, "gravarEstadoFalha");
    await expect(c.chamar("exemplo__somar", { a: 1, b: 2 })).rejects.toBeInstanceOf(erro().constructor);
    expect(marcar).not.toHaveBeenCalled();
    expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toBeNull();
  });

  it("NOD-193: sessão MCP expirada (404 com mcp-session-id) uma vez e depois 200 → ok: true, sem marcarFalha", async () => {
    let sessoes = 0;
    let expirar = 1;
    const metodos: string[] = [];
    const fetchImpl: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      metodos.push(q.method);
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} }, { headers: { "mcp-session-id": `S${++sessoes}` } });
      if (!q.id) return new Response(null, { status: 202 });
      if (expirar-- > 0) return new Response("x", { status: 404 });
      return Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "3" }] } });
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const vivos = criarConectoresVivos({ agora: () => AGORA, fetchImpl, carregar: async () => ({ nome: "exemplo", transporte: "http", url: "https://mcp.exemplo.com/mcp" }) });
    try {
      const c = await cenario({ responder: (ch) => vivos.chamar(ch.conectorId, ch.tool, ch.args, { rotina: false, somenteLeitura: true }) });
      const marcar = vi.spyOn(c.deps.repos.conectores, "gravarEstadoFalha");
      const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
      expect(r.data).toMatchObject({ ok: true });
      expect(marcar).not.toHaveBeenCalled();
      expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toBeNull();
      expect(metodos.filter((m) => m === "tools/call")).toHaveLength(2);
      expect(metodos.filter((m) => m === "initialize")).toHaveLength(2);
    } finally {
      log.mockRestore();
      await vivos.fechar();
    }
  });

  it("NOD-157: 401/403 do conector nega com causa acesso_recusado (falha_tecnica), sem enum novo e sem dizer 'servidor fora'", async () => {
    for (const status of [401, 403]) {
      const c = await cenario({ responder: () => { throw new ErroTransporteMcp("conector_indisponivel", `http ${status}`, { status }); } });
      const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
      expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "falha_tecnica", causa: "acesso_recusado", terminal: false } });
      // NOD-374: 401/403 aparece na hora (re-sondar não resolve) e não re-sonda.
      expect(await c.deps.repos.conectores.buscar(c.conectorId)).toMatchObject({ ultimaFalha: { motivo: "falha_tecnica", em: AGORA, causa: "acesso_recusado" }, foraDoArDesde: AGORA, proximaSondaEm: null });
    }
  });

  it("NOD-374: sucesso num app com falha aberta limpa e registra a volta na trilha; sucesso num app sem falha não escreve", async () => {
    let falhar = true;
    const c = await cenario({ responder: () => { if (falhar) throw new ErroTransporteMcp("conector_indisponivel", "http 401", { status: 401 }); return { conteudo: "3", isError: false }; } });
    await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect((await c.deps.repos.conectores.buscar(c.conectorId))?.foraDoArDesde).toBe(AGORA);
    falhar = false;
    const limpar = vi.spyOn(c.deps.repos.conectores, "limparFalha");
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(r.data).toMatchObject({ ok: true });
    expect(limpar).toHaveBeenCalledTimes(1);
    expect(await c.deps.repos.conectores.buscar(c.conectorId)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, falhasSeguidas: 0, timeoutsSeguidos: 0 });
    expect(c.banco.trilha.filter((t) => t.kind === "conector_recuperado")).toEqual([expect.objectContaining({ agenteId: c.agenteId, conectorId: c.conectorId, ferramenta: "exemplo", motivo: "falha_tecnica", regra: "regra:disjuntor_conector" })]);
    await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(limpar).toHaveBeenCalledTimes(1);
  });
});

describe("validação pelo subconjunto JSON Schema", () => {
  it("NOD-317: so_com_pendencia saiu do schema, mas o modelo que ainda o mande não derruba criar/atualizar_rotina — o campo é descartado", () => {
    const rotina = { cron: "0 8 * * *", fuso_iana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limites_aprovacao: "l", politica_sem_dado: "p" };
    expect(validarArgsNod("criar_rotina", { ...rotina, so_com_pendencia: true })).toEqual({ ok: true, args: rotina });
    const id = "0f8f7c1e-9a51-4d0e-8f3a-5a8a0b1c2d3e";
    expect(validarArgsNod("atualizar_rotina", { rotina_id: id, instrucao: "nova", so_com_pendencia: false })).toEqual({ ok: true, args: { rotina_id: id, instrucao: "nova" } });
    // Só ele: outro campo fora do schema continua recusado.
    expect(validarArgsNod("criar_rotina", { ...rotina, extra: 1 })).toMatchObject({ ok: false });
  });

  it("required, additionalProperties false, enum, minLength, minItems, items, integer e tipos aninhados", () => {
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "x" })).toEqual({ ok: true, args: { tipo: "fato", texto: "x" } });
    expect(validarArgsNod("lembrar", { tipo: "fato" })).toMatchObject({ ok: false, erros: ["$.texto: obrigatório"] });
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "", extra: 1 })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [], nivel: "leitura", nao_pedido: [] })).toMatchObject({ ok: true });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [1], nivel: "raiz", nao_pedido: [] })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f", argumentos: { livre: true } } }] }).ok).toBe(true);
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f" } }] })).toMatchObject({ ok: false, erros: ["$.itens[0].destino.argumentos: obrigatório"] });
    expect(errosDoSchema({ type: "array", minItems: 1, items: { type: "string" } }, [])).toEqual(["$: mínimo 1 itens"]);
    // definido em 2026-09-24 (emenda da ADR-045): o teto que o subconjunto expõe (opcoes de pedir_a_pessoa) também valida.
    expect(errosDoSchema({ type: "array", maxItems: 2, items: { type: "string", maxLength: 3 } }, ["abc", "abcd", "x"])).toEqual(["$: máximo 2 itens", "$[1]: máximo 3 caracteres"]);
    expect(errosDoSchema({ type: "integer" }, 1.5)).toEqual(["$: esperado inteiro"]);
    expect(errosDoSchema({ type: "object" }, null)).toEqual(["$: esperado object, veio null"]);
    expect(errosDoSchema({ type: "object" }, [])).toEqual(["$: esperado object, veio array"]);
  });
});

describe("abrir_frentes: o título pede 2 a 5 palavras, mas o teto continua 200 (plano chat limpo, PR 5, decisão 15)", () => {
  const frente = (titulo: string) => ({ titulo, pedido: "Refaça os roteiros de animação do hero." });
  it("título longo (até 200) e titulo_do_lote passam: a chamada não falha por um título comprido", () => {
    const longo = "Refazer os roteiros de animação do hero com o tom novo que a pessoa pediu ontem à noite, ".repeat(3).slice(0, 200);
    expect(longo).toHaveLength(200);
    expect(validarArgsNod("abrir_frentes", { frentes: [frente(longo), frente("Roteiros de animação")], titulo_do_lote: "frentes de hero" })).toMatchObject({ ok: true });
    expect(validarArgsNod("abrir_frentes", { frentes: [frente("Roteiros")] })).toMatchObject({ ok: true });
    // Sem minLength no titulo_do_lote: vazio não derruba a chamada (vira "sem título" no caso de uso).
    expect(validarArgsNod("abrir_frentes", { frentes: [frente("Roteiros")], titulo_do_lote: "" })).toMatchObject({ ok: true });
  });
  it("acima de 200, no título ou no titulo_do_lote, é erro de schema (o CHECK trabalho_titulo da 0063 e o lote_titulo da 0092)", () => {
    expect(validarArgsNod("abrir_frentes", { frentes: [frente("x".repeat(201))] })).toMatchObject({ ok: false, erros: ["$.frentes[0].titulo: máximo 200 caracteres"] });
    expect(validarArgsNod("abrir_frentes", { frentes: [frente("Roteiros")], titulo_do_lote: "x".repeat(201) })).toMatchObject({ ok: false, erros: ["$.titulo_do_lote: máximo 200 caracteres"] });
    expect(validarArgsNod("abrir_frentes", { frentes: [frente("")] })).toMatchObject({ ok: false });
  });
  it("as descrições pedem o título como a pessoa diria e o lote em poucas palavras", () => {
    const schema = FERRAMENTAS_NOD.abrir_frentes;
    expect(schema.properties.frentes.items.properties?.titulo?.description).toContain("2 a 5 palavras");
    expect(schema.properties.titulo_do_lote.description).toContain("2 a 4 palavras");
    expect(schema.required).toEqual(["frentes"]);
  });
});
