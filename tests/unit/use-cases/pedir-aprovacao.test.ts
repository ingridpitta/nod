import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { pedirAprovacao } from "../../../src/use-cases/pedir-aprovacao.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsFalsos } from "./deps-l5.ts";
import type { ModoTurno, PlanoTurno } from "../../../src/contracts/plano-turno.ts";

async function cenario(deps: Deps) {
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  // NOD-316: o bot nasce em Automático; estes casos partem do Manual, explícito.
  await deps.repos.agentes.definirModoAprovacao(agente?.id ?? "", "manual");
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const email = await deps.repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [
    { nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
    // O conector DECLARA o que é só-leitura na sonda; é este valor que o ADR-042 lê.
    { nome: "buscar", descricao: "busca", schema: { type: "object" }, readOnlyHint: true },
  ], agora: 1 });
  // Revisão da ADR-047: pedir_aprovacao exige concessão do AGENTE, não só a ferramenta no catálogo.
  for (const capacidade of ["enviar", "buscar"]) await deps.repos.concessoes.conceder({ agenteId: agente?.id ?? "", conectorId: email?.id ?? "", capacidade, mensagemId: "m" });
  const crm = await deps.repos.conectores.criar({ nome: "CRM", slug: "crm", transporte: "stdio", comando: "node", declaracao: "toca" });
  const semDeclaracao = await deps.repos.conectores.criar({ nome: "Planilha", slug: "planilha", transporte: "stdio", comando: "node", declaracao: "nao-declarou" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: 9e12, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  return { agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", turnoId: turno?.id ?? "", crmId: crm?.id ?? "", planilhaId: semDeclaracao?.id ?? "" };
}

const destino = { conector: "email", ferramenta: "enviar", argumentos: { para: "x" } };
const leitura = { conector: "email", ferramenta: "buscar", argumentos: {} };

/**
 * Plano mínimo para a regra do ADR-042: só o que decidirAprovacao lê.
 * revisto em 2026-10-01 (ADR-066): `politicaExecucao` não tem mais o gate da rotina; o que distingue a rotina é o
 * `modoTurno` (o arriscado só para fora da conversa com a pessoa).
 */
function planoCom(nomes: string[], o: { readOnly?: string[]; semprePermitir?: string[]; confianca?: "confiavel" | "nao_confiavel"; modoTurno?: ModoTurno } = {}): PlanoTurno {
  return {
    catalogo: {
      ferramentas: nomes.map((nome) => ({ nome, nomeMcp: `mcp__nod__${nome}` as const, origem: "conector" as const, conectorId: "c", readOnlyHint: (o.readOnly ?? []).includes(nome), tocaDadoPessoal: false, schema: { type: "object" as const } })),
      servidores: [],
    },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 1 },
    confiancaEntrada: o.confianca ?? "confiavel",
    ...(o.modoTurno ? { modoTurno: o.modoTurno } : {}),
    semprePermitir: o.semprePermitir ?? [],
  } as unknown as PlanoTurno;
}

describe("pedirAprovacao (E4.1/E4.2/E4.4)", () => {
  it("quatro itens viram quatro linhas tipadas, todas marcadas: a classificação por origem está desligada (ADR-002, refinamento 2026-09-21)", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId,
      agenteId: c.agenteId,
      conversaId: c.conversaId,
      resumo: "enviar 4 emails",
      itens: [
        { texto: "email para a Ana", destino },
        { texto: "email para a Bia (nome vindo do CRM)", destino, origem_conector: "crm" },
        { texto: "email para o Caio", destino },
        { texto: "email da planilha sem declaração", destino, origem_conector: "planilha" },
      ],
    });
    expect(r.data.estado).toBe("pendente");
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    expect(r.data.instrucao).toBe("encerre o turno; a decisão retoma depois");
    const decisaoId = r.data.decisao_id;
    const decisao = banco.decisoes.find((d) => d.id === decisaoId);
    expect(decisao).toMatchObject({ tipo: "aprovacao", estado: "pendente", frase: "enviar 4 emails", turnoId: c.turnoId, decisorId: deps.escopo.pessoaId });
    const itens = await deps.repos.itensAprovacao.listar(decisaoId);
    // Com CLASSIFICAR_ORIGEM_SENSIVEL = false, origem_conector não marca mais nada: os 4 nascem iguais.
    expect(itens.map((i) => [i.idx, i.selecionado, i.origemSensivel, i.justificativa])).toEqual([
      [0, true, false, null],
      [1, true, false, null],
      [2, true, false, null],
      [3, true, false, null],
    ]);
    expect(itens[0]?.destino).toEqual(destino);
    expect(itens[0]?.textoFinal).toBe("email para a Ana");
    expect(r.events?.map((e) => e.kind)).toEqual(["decisao_criada"]);
    expect(r.events?.[0]?.dados).toMatchObject({ itens: 4, sensiveis: 0 });
  });

  it("destino fora do catálogo ou conector não registrado é recusado antes de virar decisão (E6.2: nunca inventa escopo)", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    const base = { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x" };
    await expect(pedirAprovacao(deps, { ...base, itens: [{ texto: "a", destino: { ...destino, ferramenta: "apagar_tudo" } }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedirAprovacao(deps, { ...base, itens: [{ texto: "a", destino: { ...destino, conector: "inexistente" } }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedirAprovacao(deps, { ...base, itens: [] })).rejects.toBeInstanceOf(ErroDeDominio);
    expect(banco.decisoes).toHaveLength(0);
    expect(banco.itens).toHaveLength(0);
  });

  it("origem_conector desconhecida não marca mais o item: o fail-closed do ADR-002 está desligado, não removido", async () => {
    const { deps } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x", itens: [{ texto: "a", destino, origem_conector: "nao-existe" }] });
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    const [item] = await deps.repos.itensAprovacao.listar(r.data.decisao_id);
    expect(item).toMatchObject({ selecionado: true, origemSensivel: false });
  });

  it("leitura declarada pelo conector não vira card: decisão nasce FECHADA e o turno segue", async () => {
    const { deps, banco, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "consultar",
      itens: [{ texto: "buscar contato", destino: leitura }],
      plano: planoCom(["email__buscar"], { readOnly: ["email__buscar"] }),
    });
    // O modelo recebe o resultado inline: não há {aguardar}, então o turno não morre no long-poll.
    expect(r.data.estado).toBe("decidida");
    if (r.data.estado !== "decidida") throw new Error("esperava decidida");
    expect(r.data.itens).toEqual([{ idx: 0, desfecho: "executado" }]);
    expect(chamadas).toHaveLength(1);
    // A decisão existe (nada é suprimido, ADR-007) — ela só nunca ficou pendente.
    expect(banco.decisoes[0]).toMatchObject({ estado: "decidida" });
    expect(banco.decisoes[0]?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: "regra:consulta_sem_decisao" });
    // "precisa ficar no chat": a fala do que saiu sem perguntar.
    const msg = banco.mensagens.find((m) => m.kind === "resultado_aprovacao");
    expect(msg?.texto).toContain("Fiz sem perguntar");
    // ADR-023: quem agiu continua sendo o AGENTE; a regra vai em decidido_por.
    expect(msg?.autoria).toMatchObject({ autor_tipo: "agente", decidido_por: "regra:consulta_sem_decisao", regra_versao: 1 });
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada"]);
  });

  it("escrita na regra da pessoa também dispensa o card, e a autoria nomeia a regra dela", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    // ADR-062: a regra vale pela LINHA ativa agora, não pela lista congelada no plano.
    const email = await deps.repos.conectores.buscarPorSlug("email");
    await deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: email?.id ?? "", capacidade: "enviar", itemOrigemId: "i", mensagemId: "m", regraVersao: 1 });
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "enviar",
      itens: [{ texto: "email para a Ana", destino }],
      plano: planoCom(["email__enviar"], { semprePermitir: ["email__enviar"] }),
    });
    expect(r.data.estado).toBe("decidida");
    expect(banco.mensagens.find((m) => m.kind === "resultado_aprovacao")?.autoria).toMatchObject({ decidido_por: "regra:aprovacao_permanente" });
  });

  it("sem plano nunca é automático, mesmo sendo leitura (fail-closed)", async () => {
    const { deps, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x", itens: [{ texto: "buscar", destino: leitura }] });
    expect(r.data.estado).toBe("pendente");
    expect(chamadas).toHaveLength(0);
  });

  it("lote misto pergunta TUDO e nada é executado antes; cada item guarda por que parou", async () => {
    const { deps, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "os dois",
      itens: [{ texto: "buscar contato", destino: leitura }, { texto: "email para a Ana", destino }],
      plano: planoCom(["email__buscar", "email__enviar"], { readOnly: ["email__buscar"] }),
    });
    expect(r.data.estado).toBe("pendente");
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    // O mundo não foi mexido pela metade: o que teria passado também esperou.
    expect(chamadas).toHaveLength(0);
    const itens = await deps.repos.itensAprovacao.listar(r.data.decisao_id);
    expect(itens.map((i) => i.motivoManual)).toEqual([null, "sem_regra_permanente"]);
  });

  it("turno não confiável suspende a regra da pessoa e escreve o motivo no item (ADR-029)", async () => {
    const { deps, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x",
      itens: [{ texto: "email para a Ana", destino }],
      plano: planoCom(["email__enviar"], { semprePermitir: ["email__enviar"], confianca: "nao_confiavel" }),
    });
    expect(r.data.estado).toBe("pendente");
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    expect(chamadas).toHaveLength(0);
    const [item] = await deps.repos.itensAprovacao.listar(r.data.decisao_id);
    expect(item?.motivoManual).toBe("regra_suspensa_conteudo_nao_confiavel");
  });

  it("ADR-066: não há mais gate de rotina — num turno de rotina a leitura declarada sai sem card, e a escrita no manual pergunta pelo motivo de sempre", async () => {
    const { deps, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const base = { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x" };
    const ler = await pedirAprovacao(deps, { ...base, itens: [{ texto: "buscar", destino: leitura }], plano: planoCom(["email__buscar"], { readOnly: ["email__buscar"], modoTurno: "rotina" }) });
    expect(ler.data).toEqual({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado" }] });
    expect(chamadas).toHaveLength(1);
    const escrever = await pedirAprovacao(deps, { ...base, itens: [{ texto: "email para a Ana", destino }], plano: planoCom(["email__enviar"], { modoTurno: "rotina" }) });
    if (escrever.data.estado !== "pendente") throw new Error("esperava pendente");
    expect((await deps.repos.itensAprovacao.listar(escrever.data.decisao_id))[0]?.motivoManual).toBe("sem_regra_permanente");
    expect(chamadas).toHaveLength(1);
  });

  it("item com origem declarada 'toca' passa a ser elegível à regra: é o conjunto que cresceu e fez a versão subir para 2", async () => {
    const { deps, banco, chamadas } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x",
      itens: [{ texto: "buscar do CRM", destino: leitura, origem_conector: "crm" }],
      plano: planoCom(["email__buscar"], { readOnly: ["email__buscar"], semprePermitir: ["email__buscar"] }),
    });
    // Antes do refinamento de 2026-09-21 este item nascia sensível e SEGURAVA o lote inteiro.
    // Com a classificação desligada ele é um item comum: leitura declarada pelo conector resolve.
    expect(r.data.estado).toBe("decidida");
    expect(chamadas).toHaveLength(1);
    const [item] = await deps.repos.itensAprovacao.listar(banco.decisoes[0]?.id ?? "");
    expect(item).toMatchObject({ selecionado: true, origemSensivel: false, motivoManual: null });
  });

  it("nenhum conector marca mais o item, nem o declarado 'toca' nem o sem declaração", async () => {
    // A neutralização é UMA constante no caso de uso; coluna, CHECK e a precedência do domínio
    // permanecem de pé. Voltar atrás é trocar CLASSIFICAR_ORIGEM_SENSIVEL para true.
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    await pedirAprovacao(deps, {
      turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x",
      itens: [
        { texto: "do CRM (declarado toca)", destino, origem_conector: "crm" },
        { texto: "da planilha (não declarou)", destino, origem_conector: "planilha" },
      ],
    });
    const itens = await deps.repos.itensAprovacao.listar(banco.decisoes[0]?.id ?? "");
    expect(itens.map((i) => i.origemSensivel)).toEqual([false, false]);
    expect(itens.every((i) => i.selecionado)).toBe(true);
  });
});

describe("pedirAprovacao com o modo do bot (ADR-059)", () => {
  const pedir = (deps: Deps, c: Awaited<ReturnType<typeof cenario>>, plano: PlanoTurno, d: { conector: string; ferramenta: string; argumentos: Record<string, unknown> } = destino) =>
    pedirAprovacao(deps, { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "enviar", itens: [{ texto: "email para a Ana", destino: d }], plano });

  it("automático: a escrita sai sem card, pela regra do modo, e a fala diz que foi a aprovação automática", async () => {
    const { deps, banco, chamadas } = depsFalsos();
    const c = await cenario(deps);
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    const r = await pedir(deps, c, planoCom(["email__enviar"]));
    expect(r.data).toEqual({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado" }] });
    expect(chamadas).toHaveLength(1);
    // ADR-066: a versão subiu para 2 — o conjunto que o automático deixa passar cresceu (conteúdo de fora, merge).
    expect(banco.decisoes[0]?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: "regra:modo_automatico", regraVersao: 2 });
    const msg = banco.mensagens.find((m) => m.kind === "resultado_aprovacao");
    expect(msg?.texto).toContain("Fiz sem perguntar (1 ação) · aprovação automática:");
    expect(msg?.autoria).toMatchObject({ autor_tipo: "agente", decidido_por: "regra:modo_automatico" });
  });

  it("ADR-066: automático libera a rotina e também o turno que leu a web — conteúdo de fora só pesa no manual, onde a regra 'Sempre permitir' cai", async () => {
    const { deps, chamadas } = depsFalsos();
    const c = await cenario(deps);
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await pedir(deps, c, planoCom(["email__enviar"], { modoTurno: "rotina" }))).data.estado).toBe("decidida");
    await deps.repos.turnos.contaminar(c.turnoId, Date.now());
    const lida = await pedir(deps, c, planoCom(["email__enviar"]));
    expect(lida.data.estado).toBe("decidida");
    expect(await pedir(deps, c, planoCom(["email__enviar"], { confianca: "nao_confiavel", modoTurno: "rotina" }))).toMatchObject({ data: { estado: "decidida" } });
    expect(chamadas).toHaveLength(3);
    // No manual, o mesmo turno contaminado suspende a regra da pessoa e escreve o motivo.
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "manual");
    const manual = await pedir(deps, c, planoCom(["email__enviar"], { semprePermitir: ["email__enviar"] }));
    if (manual.data.estado !== "pendente") throw new Error("esperava pendente");
    expect((await deps.repos.itensAprovacao.listar(manual.data.decisao_id))[0]?.motivoManual).toBe("regra_suspensa_conteudo_nao_confiavel");
    expect(chamadas).toHaveLength(3);
  });

  it("automático para no arriscado: apagar no app vira card com o motivo", async () => {
    const { deps } = depsFalsos();
    const c = await cenario(deps);
    const email = await deps.repos.conectores.buscarPorSlug("email");
    await deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [...(email?.catalogo ?? []), { nome: "excluir_mensagem", descricao: "apaga", schema: { type: "object" }, readOnlyHint: false }], agora: 2 });
    await deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: email?.id ?? "", capacidade: "excluir_mensagem", mensagemId: "m" });
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    const r = await pedir(deps, c, planoCom(["email__excluir_mensagem"]), { conector: "email", ferramenta: "excluir_mensagem", argumentos: {} });
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    expect((await deps.repos.itensAprovacao.listar(r.data.decisao_id))[0]?.motivoManual).toBe("acao_arriscada");
  });

  it("ADR-066: sem aprovações sai num turno não confiável (o catálogo não encolhe mais, a escrita está nele); fora do catálogo pergunta até no total", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "total");
    const r = await pedir(deps, c, planoCom(["email__enviar"], { confianca: "nao_confiavel" }));
    expect(r.data.estado).toBe("decidida");
    expect(banco.mensagens.find((m) => m.kind === "resultado_aprovacao")?.texto).toContain("· sem aprovações:");
    // Fora do catálogo é concessão desligada no plano: nenhum modo passa (antes o total passava no turno não confiável).
    const fora = await pedir(deps, c, planoCom([], { confianca: "nao_confiavel" }));
    if (fora.data.estado !== "pendente") throw new Error("esperava pendente");
    expect((await deps.repos.itensAprovacao.listar(fora.data.decisao_id))[0]?.motivoManual).toBe("fora_do_catalogo");
  });

  it("o modo é o ATUAL do agente: voltar para o manual vale no pedido seguinte do mesmo turno", async () => {
    const { deps } = depsFalsos();
    const c = await cenario(deps);
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await pedir(deps, c, planoCom(["email__enviar"]))).data.estado).toBe("decidida");
    await deps.repos.agentes.definirModoAprovacao(c.agenteId, "manual");
    expect((await pedir(deps, c, planoCom(["email__enviar"]))).data.estado).toBe("pendente");
  });
});
