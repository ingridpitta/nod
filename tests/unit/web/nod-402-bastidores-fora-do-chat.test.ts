import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import { aplicarFrame, estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { turnosVivosDaConversa, turnosVivosDoChat } from "../../../web/lib/mascote.ts";
import { segundoPlano } from "../../../web/telas/detalhes.ts";
import { renderPerfilCelular } from "../../../web/telas/perfil-celular.ts";

/**
 * NOD-402: o turno de rotina (e de delegação/peer, os "bastidores" da ADR-130) roda em segundo plano. Nada dele aparece
 * no ao vivo do chat — nem o texto parcial, nem o "retrato" da fala que some aos 15 s (NOD-348). A presença (barra,
 * mascote) continua vendo o trabalho por `turnosVivosDaConversa`.
 */
const C = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const AGORA = 1_700_000_000_000;
const f = (tipo: TipoFrame, dados: Record<string, unknown>): FrameSse => ({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados });
const conversa = (turnosEmCurso: ConversaDto["turnosEmCurso"] = []): ConversaDto => ({ conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 }, mensagens: [], turnosPendentes: [], turnosEmCurso, turnosCancelados: [], fios: [], propostas: [] });
const hidratado = (turnos?: ConversaDto["turnosEmCurso"]) => reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: conversa(turnos), agora: AGORA });

describe("NOD-402: turno de bastidores fica fora do chat", () => {
  it("rotina sem_novidade: não entra no ao vivo do chat e não deixa retrato que pisca", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "rotina", bastidores: true }), AGORA);
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: T, texto: "Olhei aqui, nada novo.", bastidores: true }), AGORA + 10);
    expect(turnosVivosDoChat(e, C)).toEqual([]);
    expect(turnosVivosDaConversa(e, C).map((t) => t.turnoId)).toEqual([T]);
    e = aplicarFrame(e, f("turno.encerrado", { conversaId: C, turnoId: T }), AGORA + 20);
    expect(Object.values(e.falasSaindo?.[C] ?? {})).toHaveLength(0);
  });

  it("delta de bastidores que chega ANTES do turno.iniciado não vaza para o chat", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: T, texto: "parcial", bastidores: true }), AGORA);
    // O frame direto chega antes do turno vivo existir: só a marca dele segura o ao vivo (a origem não ajuda: é retomada).
    expect(e.atividades[C]?.[T]).toBeUndefined();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "retomada", bastidores: true }), AGORA + 5);
    expect(turnosVivosDoChat(e, C)).toEqual([]);
    e = aplicarFrame(e, f("turno.encerrado", { conversaId: C, turnoId: T }), AGORA + 20);
    expect(Object.values(e.falasSaindo?.[C] ?? {})).toHaveLength(0);
  });

  it("turno_criado da retomada de rotina (origem retomada, bastidores herdado) também fica fora", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_criado", origem: "retomada", bastidores: true }), AGORA);
    expect(turnosVivosDoChat(e, C)).toEqual([]);
  });

  it("recarregar a página com turno de bastidores em curso não o recria no chat", () => {
    const e = hidratado([{ id: T, agenteId: "a", estado: "despachando", desde: AGORA - 1000, mensagemId: null, origem: "rotina", bastidores: true }]);
    expect(turnosVivosDoChat(e, C)).toEqual([]);
    expect(turnosVivosDaConversa(e, C)).toHaveLength(1);
  });

  it("controle: o turno da pessoa continua no ao vivo e deixa o retrato da fala", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_despachado", origem: "mensagem" }), AGORA);
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: U, texto: "Oi!" }), AGORA + 10);
    expect(turnosVivosDoChat(e, C).map((t) => t.turnoId)).toEqual([U]);
    e = aplicarFrame(e, f("turno.encerrado", { conversaId: C, turnoId: U }), AGORA + 20);
    expect(Object.values(e.falasSaindo?.[C] ?? {})).toHaveLength(1);
  });

  it("a hidratação promove a bastidores o turno vivo que chegou sem a marca, e limpa o ao vivo dele", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "retomada" }), AGORA);
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: T, texto: "parcial" }), AGORA + 5);
    expect(turnosVivosDoChat(e, C).map((t) => t.turnoId)).toEqual([T]);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa([{ id: T, agenteId: "a", estado: "despachando", desde: AGORA, mensagemId: null, origem: "retomada", bastidores: true }]), agora: AGORA + 10 });
    expect(turnosVivosDoChat(e, C)).toEqual([]);
    expect(turnosVivosDaConversa(e, C).map((t) => t.turnoId)).toEqual([T]);
    expect(e.atividades[C]?.[T]).toBeUndefined();
  });

  it("frente aberta por rotina (trabalhoId) mantém o ao vivo, mesmo com a marca no frame", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "rotina", trabalhoId: "w1", bastidores: true }), AGORA);
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: T, texto: "Rodando os testes.", trabalhoId: "w1", bastidores: true }), AGORA + 5);
    expect(e.turnosVivos[T]?.bastidores).toBeUndefined();
    expect(e.atividades[C]?.[T]).toBeDefined();
  });

  it("o turno da pessoa guarda a hora do despacho do SERVIDOR; o que sai da fila para rodando conta daí (revisão 3, médio 5)", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_despachado", origem: "mensagem", despachadoEm: 42 }), AGORA);
    expect(e.turnosVivos[U]?.despachadoEm).toBe(42);
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_criado", origem: "mensagem" }), AGORA);
    expect(e.turnosVivos[T]?.estado).not.toBe("rodando");
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: T, texto: "x" }), AGORA + 500);
    expect(e.turnosVivos[T]).toMatchObject({ estado: "rodando", desde: AGORA + 500 });
    const h = hidratado([{ id: U, agenteId: "a", estado: "despachando", desde: AGORA - 9, despachadoEm: 77, mensagemId: null, origem: "mensagem" }]);
    expect(h.turnosVivos[U]?.despachadoEm).toBe(77);
  });

  it("revisão 7, M1: a releitura dá a hora do despacho ao turno que a web já via sem ela (o turno_despachado perdido)", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_criado", origem: "mensagem" }), AGORA);
    e = aplicarFrame(e, f("turno.delta", { conversaId: C, turnoId: U, texto: "x" }), AGORA + 5);
    expect(e.turnosVivos[U]?.despachadoEm).toBeUndefined();
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa([{ id: U, agenteId: "a", estado: "despachando", desde: AGORA - 9, despachadoEm: 77, mensagemId: null, origem: "mensagem" }]), agora: AGORA + 10 });
    expect(e.turnosVivos[U]?.despachadoEm).toBe(77);
  });

  it("revisão 9: a hora em que o turno nasceu no servidor vem do turno_criado, passa pelo despachado e a releitura a completa", () => {
    let e = hidratado();
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_criado", origem: "mensagem", criadoEm: 55 }), AGORA);
    expect(e.turnosVivos[U]?.criadoEm).toBe(55);
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_despachado", despachadoEm: 66 }), AGORA + 1);
    expect(e.turnosVivos[U]).toMatchObject({ criadoEm: 55, despachadoEm: 66 });
    let sem = aplicarFrame(hidratado(), f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_criado", origem: "mensagem" }), AGORA);
    expect(sem.turnosVivos[U]?.criadoEm).toBeUndefined();
    sem = reduzir(sem, { tipo: "hidratar-conversa", conversa: conversa([{ id: U, agenteId: "a", estado: "pendente", desde: 44, mensagemId: null, origem: "mensagem" }]), agora: AGORA + 10 });
    expect(sem.turnosVivos[U]?.criadoEm).toBe(44);
    expect(hidratado([{ id: T, agenteId: "a", estado: "pendente", desde: 33, mensagemId: null, origem: "mensagem" }]).turnosVivos[T]?.criadoEm).toBe(33);
  });

  it("revisão 7, A1: só a rotina rodando, o painel do bot mostra o Parar; com o turno da pessoa vivo, não (o do campo basta)", () => {
    const bot = { id: "a", nome: "Ze", conversaId: C, cor: "c-yellow", forma: "shape-square", ownerId: "p" } as never;
    let e = { ...hidratado(), tela: { tipo: "conversa", conversaId: C } } as never as ReturnType<typeof hidratado>;
    expect(segundoPlano(e, bot, true)).toBe("");
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "rotina", bastidores: true }), AGORA);
    expect(segundoPlano(e, bot, true)).toContain('data-act="parar-conversa"');
    expect(segundoPlano(e, bot, false)).toBe("");
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: U, kind: "turno_despachado", origem: "mensagem" }), AGORA);
    expect(segundoPlano(e, bot, true)).toBe("");
  });

  it("revisão 10: no celular, o perfil do bot também mostra o Parar da rotina que roda sozinha", () => {
    const bot = { id: "a", nome: "Ze", conversaId: C, cor: "c-yellow", forma: "shape-square", ownerId: "p" };
    let e = { ...hidratado(), sessao: { pessoaId: "p" }, frota: { agentes: [bot] }, tela: { tipo: "conversa", conversaId: C, agenteId: "a" } } as never as ReturnType<typeof hidratado>;
    expect(renderPerfilCelular(e)).not.toContain('data-act="parar-conversa"');
    e = aplicarFrame(e, f("turno.iniciado", { conversaId: C, turnoId: T, kind: "turno_despachado", origem: "rotina", bastidores: true }), AGORA);
    expect(renderPerfilCelular(e)).toContain('data-act="parar-conversa"');
  });
});
