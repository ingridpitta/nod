import { describe, expect, it } from "vitest";
import { INTERVALO_MIN_MS, TETO_POSTS_SEM_HUMANO } from "../../../src/domain/canal-orcamento.ts";
import { criarSala } from "../../../src/use-cases/criar-sala.ts";
import { encaminhar } from "../../../src/use-cases/encaminhar.ts";
import { pararSala } from "../../../src/use-cases/parar-sala.ts";
import { passar } from "../../../src/use-cases/passar.ts";
import { postarNaSala } from "../../../src/use-cases/postar-na-sala.ts";
import { autoriaAgente } from "../../../src/use-cases/apoio-l7.ts";
import { contexto, depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_MARLON } from "../../helpers/ids.ts";

let relogio = 1_700_000_000_000;
const avancar = (ms: number) => (relogio += ms);

async function tresBots(d: ReturnType<typeof depsMemoria>) {
  const ids: string[] = [];
  for (const nome of ["Vera", "Tuca", "Bia"]) {
    const a = await d.deps.repos.agentes.criar({ nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: a?.id ?? "" });
    ids.push(a?.id ?? "");
  }
  return ids;
}

async function salaDeTres(d: ReturnType<typeof depsMemoria>) {
  const ids = await tresBots(d);
  const s = await criarSala(d.deps, { nome: "revisão", agenteIds: ids });
  return { ids, sala: s.data.sala, conversaId: s.data.conversa.id, vera: ids[0] ?? "", tuca: ids[1] ?? "", bia: ids[2] ?? "" };
}

describe("criarSala", () => {
  it("2 a 6 bots; 1 e 7 → sala_tamanho; política lead = primeiro; grant ao dono de cada bot na mesma operação", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const ids = await tresBots(d);
    await expect(criarSala(d.deps, { nome: "x", agenteIds: [ids[0] ?? ""] })).rejects.toMatchObject({ codigo: "sala_tamanho" });
    await expect(criarSala(d.deps, { nome: "x", agenteIds: Array.from({ length: 7 }, (_, i) => `a${i}`) })).rejects.toMatchObject({ codigo: "sala_tamanho" });
    const s = await criarSala(d.deps, { nome: "revisão", agenteIds: ids });
    expect(s.data.sala).toMatchObject({ nome: "revisão", politica: "lead", leadAgenteId: ids[0], visibility: "privado", ownerId: PESSOA_MARLON });
    expect(s.data.conversa).toMatchObject({ tipo: "sala", salaId: s.data.sala.id });
    expect(s.data.membros.map((m) => m.pessoaLeitoraId)).toEqual([PESSOA_MARLON, PESSOA_MARLON, PESSOA_MARLON]);
    expect(d.banco.mensagens[0]?.kind).toBe("sistema");
  });
});

describe("postarNaSala: quem responde", () => {
  it("@Vera → só Vera; sem menção → lead; 'todos' → todos (menos o autor, quando é bot)", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, vera, tuca, bia } = await salaDeTres(d);
    const soVera = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera o que acha do PR 42?" });
    expect(soVera.data.turnos.map((t) => t.agenteId)).toEqual([vera]);
    expect(soVera.data.turnos[0]).toMatchObject({ origem: "sala", profundidade: 0, entradaTexto: "@Vera o que acha do PR 42?" });
    avancar(INTERVALO_MIN_MS + 1);
    const lead = await postarNaSala(d.deps, { salaId: sala.id, texto: "e aí?" });
    expect(lead.data.turnos.map((t) => t.agenteId)).toEqual([vera]);
    await d.deps.repos.salas.atualizarPolitica(sala.id, { politica: "todos" });
    avancar(INTERVALO_MIN_MS + 1);
    const todos = await postarNaSala(d.deps, { salaId: sala.id, texto: "todo mundo" });
    expect(todos.data.turnos.map((t) => t.agenteId).sort()).toEqual([vera, tuca, bia].sort());
    // fala de bot sem menção não dispara ninguém (evita ricochete)
    avancar(INTERVALO_MIN_MS + 1);
    const deBot = await postarNaSala(d.deps, { salaId: sala.id, texto: "concordo", autoria: autoriaAgente(vera, PESSOA_MARLON) });
    expect(deBot.data.turnos).toEqual([]);
    expect(deBot.data.mensagem.confianca).toBe("nao_confiavel");
    expect(await d.deps.repos.salas.buscar(sala.id).then((s) => s?.orcamento.postsSemHumano)).toBe(1);
  });

  it("texto vazio → texto_vazio; sala inexistente → nao_encontrado; quem não é a dona → nao_permitido", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala } = await salaDeTres(d);
    await expect(postarNaSala(d.deps, { salaId: sala.id, texto: "  " })).rejects.toMatchObject({ codigo: "texto_vazio" });
    await expect(postarNaSala(d.deps, { salaId: "nada", texto: "x" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    const ana = d.comEscopo({ tenantId: sala.tenantId, pessoaId: "ana" });
    await expect(postarNaSala(ana, { salaId: sala.id, texto: "x" })).rejects.toMatchObject({ codigo: "nao_permitido" });
  });

  it("bot offline → passe ausente_offline escrito, nunca silêncio; só ausentes → a rodada assenta", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, vera } = await salaDeTres(d);
    const r = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera oi", estaOnline: () => false });
    expect(r.data.turnos).toEqual([]);
    expect(r.data.passes.map((p) => [p.kind, p.payload, p.autoria.autor_id])).toEqual([["passe", { kind: "passe", motivo: "ausente_offline" }, vera]]);
    expect(r.data.passes[0]?.texto).toBe("Vera passou a vez (ausente_offline).");
    expect(d.banco.mensagens.at(-1)?.texto).toContain("A rodada assentou");
  });
});

describe("postarNaSala: orçamento do canal (persistido na sala)", () => {
  it("anel A→B→C (três remetentes distintos em sequência): o terceiro candidato é recusado com mensagem que encerra a tentativa; rotina é isenta", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, vera, tuca, bia } = await salaDeTres(d);
    await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera começa" });
    avancar(INTERVALO_MIN_MS + 1);
    const segundo = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Tuca sua vez", autoria: autoriaAgente(vera, PESSOA_MARLON) });
    expect(segundo.data.turnos.map((t) => t.agenteId)).toEqual([tuca]);
    avancar(INTERVALO_MIN_MS + 1);
    const fecha = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Bia sua vez", autoria: autoriaAgente(tuca, PESSOA_MARLON) });
    expect(fecha.data.turnos).toEqual([]);
    expect(fecha.data.negacoes.map((n) => [n.agenteId, n.decisao])).toEqual([[bia, "recusar"]]);
    expect(fecha.data.negacoes[0]?.mensagem.payload).toEqual({ kind: "negacao", classe: "ferramenta_negada", nome: "resposta de Bia", motivo: "teto_canal", terminal: true });
    expect(fecha.data.negacoes[0]?.mensagem.texto).toContain("Nada mais será tentado até uma pessoa falar.");
    expect(fecha.events?.some((e) => e.kind === "negacao")).toBe(true);
    // a mesma situação vinda de rotina passa
    avancar(INTERVALO_MIN_MS + 1);
    const rotina = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Bia relatório", autoria: autoriaAgente(tuca, PESSOA_MARLON), eRotina: true });
    expect(rotina.data.turnos.map((t) => t.agenteId)).toEqual([bia]);
  });

  it("bot que posta < 8 s depois de outro bot resfria (ricochete); resposta rápida à pessoa não; 6 posts de bot sem humano → decisão 'pergunta' em Sua vez (uma só); fala humana reabre", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, vera, tuca } = await salaDeTres(d);
    await postarNaSala(d.deps, { salaId: sala.id, texto: "@Tuca oi" });
    avancar(1_000);
    // Tuca responde 1 s depois da PESSOA: é resposta, sai normalmente
    const resposta = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera oi", autoria: autoriaAgente(tuca, PESSOA_MARLON) });
    expect(resposta.data.turnos.map((t) => t.agenteId)).toEqual([vera]);
    avancar(1_000);
    // Vera posta 1 s depois de um BOT: ricochete → resfriar, sem decisão (o teto não estourou)
    const rapido = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Tuca oi", autoria: autoriaAgente(vera, PESSOA_MARLON) });
    expect(rapido.data.negacoes.map((n) => n.decisao)).toEqual(["resfriar"]);
    expect(rapido.data.decisaoTeto).toBeNull();
    // a pessoa zera: recomeça a contagem
    avancar(INTERVALO_MIN_MS + 1);
    await postarNaSala(d.deps, { salaId: sala.id, texto: "sigam" });

    // seis posts de bots alternando Vera/Tuca (sem anel: só dois remetentes)
    let ultimo: Awaited<ReturnType<typeof postarNaSala>> | null = null;
    for (let i = 0; i < TETO_POSTS_SEM_HUMANO; i++) {
      avancar(INTERVALO_MIN_MS + 1);
      const autor = i % 2 === 0 ? vera : tuca;
      const alvo = i % 2 === 0 ? "@Tuca" : "@Vera";
      ultimo = await postarNaSala(d.deps, { salaId: sala.id, texto: `${alvo} ping ${i}`, autoria: autoriaAgente(autor, PESSOA_MARLON) });
    }
    expect(ultimo?.data.negacoes.map((n) => n.decisao)).toEqual(["resfriar"]);
    expect(ultimo?.data.decisaoTeto).toBeTruthy();
    expect(d.banco.decisoes.filter((x) => x.tipo === "pergunta")).toHaveLength(1);
    expect(d.banco.decisoes[0]?.frase).toContain("esfriou");
    avancar(INTERVALO_MIN_MS + 1);
    const outra = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Tuca ping 7", autoria: autoriaAgente(vera, PESSOA_MARLON) });
    expect(outra.data.decisaoTeto).toBeNull(); // não duplica a decisão
    expect(d.banco.decisoes.filter((x) => x.tipo === "pergunta")).toHaveLength(1);

    // pessoa fala: orçamento zera e a resposta volta a sair
    avancar(INTERVALO_MIN_MS + 1);
    const humano = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera e agora?" });
    expect(humano.data.turnos.map((t) => t.agenteId)).toEqual([vera]);
    expect(humano.data.orcamento).toMatchObject({ postsSemHumano: 0, handoffsNaRodada: 0 });
  });
});

describe("encaminhar e passar: handoff visível, teto de 3 por rodada, assentamento por contagem", () => {
  it("encaminhar grava handoff {de, para, motivo} + turno do destinatário; o 4º da rodada vira passe com causa teto_canal e a rodada fecha por 'teto'", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, conversaId, vera, tuca } = await salaDeTres(d);
    const post = await postarNaSala(d.deps, { salaId: sala.id, texto: "@Vera olha o PR" });
    const turnoVera = post.data.turnos[0]?.id ?? "";
    const h1 = await encaminhar(d.deps, { ...contexto(vera, conversaId, turnoVera), para_agente: "Tuca", motivo: "ela conhece o PR" });
    expect(h1.data).toEqual({ ok: true });
    const handoff = d.banco.mensagens.find((m) => m.kind === "handoff");
    expect(handoff?.payload).toEqual({ kind: "handoff", de: vera, para: tuca, motivo: "ela conhece o PR" });
    expect(handoff?.texto).toBe("Vera passou para Tuca: ela conhece o PR.");
    expect(d.banco.turnos.filter((t) => t.origem === "sala").map((t) => t.agenteId)).toEqual([vera, tuca]);
    expect(h1.events?.map((e) => e.kind)).toEqual(["sala_handoff", "turno_criado"]);
    expect((await d.deps.repos.salas.buscar(sala.id))?.orcamento.handoffsNaRodada).toBe(1);

    await encaminhar(d.deps, { ...contexto(tuca, conversaId), para_agente: "@Bia", motivo: "2" });
    await encaminhar(d.deps, { ...contexto(vera, conversaId), para_agente: "Tuca", motivo: "3" });
    const quarto = await encaminhar(d.deps, { ...contexto(tuca, conversaId, "t4"), para_agente: "Vera", motivo: "4" });
    expect(quarto.data).toEqual({ ok: true });
    expect(d.banco.mensagens.filter((m) => m.kind === "handoff")).toHaveLength(3);
    const passe = d.banco.mensagens.filter((m) => m.kind === "passe").at(-1);
    expect(passe?.payload).toEqual({ kind: "passe", motivo: "negado_fail_closed" });
    const negacao = d.banco.mensagens.find((m) => m.kind === "negacao" && m.turnoId === "t4");
    expect(negacao?.payload).toMatchObject({ kind: "negacao", nome: "encaminhar", motivo: "teto_canal", terminal: false });
    expect(quarto.events?.map((e) => e.kind)).toEqual(["negacao"]);

    // destinatário fora da sala / a si mesmo / fora de sala
    await expect(encaminhar(d.deps, { ...contexto(vera, conversaId), para_agente: "Ninguém", motivo: "x" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(encaminhar(d.deps, { ...contexto(vera, conversaId), para_agente: "Vera", motivo: "x" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    const propria = await d.deps.repos.conversas.buscarPropriaDoAgente(vera);
    await expect(encaminhar(d.deps, { ...contexto(vera, propria?.id ?? ""), para_agente: "Tuca", motivo: "x" })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });

  it("passar grava passe tipado; quando todos os presentes passaram a rodada assenta (uma mensagem de sistema só)", async () => {
    const d = depsMemoria({ agora: () => relogio });
    const { sala, conversaId, vera, tuca, bia } = await salaDeTres(d);
    await d.deps.repos.salas.atualizarPolitica(sala.id, { politica: "todos" });
    const post = await postarNaSala(d.deps, { salaId: sala.id, texto: "alguém tem algo?" });
    expect(post.data.turnos).toHaveLength(3);
    for (const [agenteId, motivo] of [[vera, "passei_sem_nada_a_dizer"], [tuca, "cota_esgotada"]] as const) {
      const r = await passar(d.deps, { ...contexto(agenteId, conversaId), motivo });
      expect(r.data).toEqual({ ok: true });
    }
    expect(d.banco.mensagens.filter((m) => m.kind === "passe").map((m) => m.payload)).toEqual([
      { kind: "passe", motivo: "passei_sem_nada_a_dizer" },
      { kind: "passe", motivo: "cota_esgotada" },
    ]);
    expect(d.banco.mensagens.some((m) => m.kind === "sistema" && m.texto.includes("assentou"))).toBe(false);
    await passar(d.deps, { ...contexto(bia, conversaId), motivo: "passei_sem_nada_a_dizer" });
    expect(d.banco.mensagens.filter((m) => m.kind === "sistema" && m.texto.includes("A rodada assentou"))).toHaveLength(1);
    // passar de novo não repete o desfecho
    await passar(d.deps, { ...contexto(bia, conversaId), motivo: "passei_sem_nada_a_dizer" });
    expect(d.banco.mensagens.filter((m) => m.kind === "sistema" && m.texto.includes("A rodada assentou"))).toHaveLength(1);
  });

  it("pararSala: pendentes viram interrompidos parado_pela_pessoa, despachando passam pelo interruptor, faixa vira mensagem 'parada'; sem nada rodando → nadaRodando", async () => {
    const d = depsMemoria({ agora: () => relogio, interromper: async (id) => id !== "nunca" });
    const { sala, conversaId } = await salaDeTres(d);
    await d.deps.repos.salas.atualizarPolitica(sala.id, { politica: "todos" });
    const post = await postarNaSala(d.deps, { salaId: sala.id, texto: "vai" });
    const emCurso = await d.deps.repos.turnos.reivindicar({ machineId: "m", agora: relogio });
    const r = await pararSala(d.deps, { salaId: sala.id });
    expect(r.data.faixa).toEqual({ interrompidas: 3, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(d.chamadas.interrompidos).toEqual([emCurso?.id]);
    expect((await d.deps.repos.turnos.vivosDaConversa(conversaId)).filter((t) => t.estado === "pendente")).toEqual([]);
    expect(d.banco.mensagens.at(-1)).toMatchObject({ kind: "parada", payload: { kind: "parada", interrompidas: 3, nadaRodando: false } });
    expect(post.data.turnos).toHaveLength(3);
    await d.deps.repos.turnos.assentar(emCurso?.id ?? "", { estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    const vazio = await pararSala(d.deps, { salaId: sala.id });
    expect(vazio.data.faixa.nadaRodando).toBe(true);
    expect(d.banco.mensagens.at(-1)?.texto).toBe("Nada estava rodando. Nenhum turno foi interrompido.");
  });
});
