import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { OrigemTurno } from "../../../src/contracts/turno.ts";
import { emOrdemDoChat, NENHUM_TURNO_VIVO, type TurnosDaPessoaVivos } from "../../../web/telas/linhas-do-chat.ts";

/**
 * NOD-402, critério 4: com a pessoa conversando, a mensagem de uma rotina que disparou no meio não entra entre as falas
 * do turno dela — vai para logo depois da última mensagem do turno; com o turno da pessoa ainda vivo, fica segurada.
 * O turno da conversa de cada mensagem leva a hora em que nasceu no servidor (`turnoDesde`): aqui, o instante da última
 * fala da pessoa (que o cria), salvo quando o teste diz outra coisa.
 */
let n = 0;
let ultimaDaPessoa = 0;
const msg = (m: Partial<Mensagem> & { autor: "pessoa" | "agente" }): Mensagem => {
  n += 1;
  const { autor, ...resto } = m;
  if (autor === "pessoa" && (m.kind ?? "texto") === "texto") ultimaDaPessoa = n;
  return {
    tenantId: "t", id: `m${n}`, conversaId: "c", turnoId: autor === "agente" ? "tp" : null, kind: "texto", texto: `fala ${n}`,
    autoria: { autor_tipo: autor, autor_id: autor === "pessoa" ? "p" : "a" }, payload: null, confianca: "confiavel", parcial: false, criadoEm: n,
    origemTurno: autor === "pessoa" ? null : ("mensagem" as OrigemTurno), trabalhoId: null, fimDoTurno: false,
    ...(autor === "agente" ? { turnoDesde: ultimaDaPessoa } : {}), ...resto,
  } as Mensagem;
};
const daRotina = (extra: Partial<Mensagem> = {}) => msg({ autor: "agente", turnoId: "tr", origemTurno: "rotina", fimDoTurno: true, ...extra });
const ids = (ms: readonly Mensagem[]) => ms.map((m) => m.id);
const vivo = (desde: number | null, ...turnos: string[]): TurnosDaPessoaVivos => ({ desde, turnos: new Set(turnos) });
const SEM = NENHUM_TURNO_VIVO;

describe("NOD-402: emOrdemDoChat", () => {
  it("rotina que grava no meio do turno da pessoa vai para depois da fala final", () => {
    const p = msg({ autor: "pessoa" });
    const meio = msg({ autor: "agente" });
    const r = daRotina();
    const fim = msg({ autor: "agente", fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, meio, r, fim], SEM))).toEqual(ids([p, meio, fim, r]));
  });

  it("rotina entre a fala da pessoa e a primeira resposta também vai para depois", () => {
    const p = msg({ autor: "pessoa" });
    const r = daRotina();
    const fim = msg({ autor: "agente", fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, r, fim], SEM))).toEqual(ids([p, fim, r]));
  });

  it("retomada de rotina (raiz rotina) e colega (delegacao) seguem a mesma regra", () => {
    const p = msg({ autor: "pessoa" });
    const r = msg({ autor: "agente", turnoId: "tx", origemTurno: "retomada" as OrigemTurno, raiz: { turnoId: "tr", origem: "rotina" }, fimDoTurno: true });
    const d = msg({ autor: "agente", turnoId: "td", origemTurno: "delegacao" as OrigemTurno, fimDoTurno: true });
    const fim = msg({ autor: "agente", fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, r, d, fim], SEM))).toEqual(ids([p, fim, r, d]));
  });

  it("com o turno da pessoa vivo e sem fala adiante, a rotina fica segurada", () => {
    const p = msg({ autor: "pessoa" });
    const meio = msg({ autor: "agente" });
    const r = daRotina();
    expect(ids(emOrdemDoChat([p, meio, r], vivo(0, "tp")))).toEqual(ids([p, meio]));
  });

  it("com o turno da pessoa vivo, a rotina segue segurada mesmo quando chega outra fala do meio (revisão 4, M1)", () => {
    const p = msg({ autor: "pessoa" });
    const a1 = msg({ autor: "agente" });
    const r = daRotina();
    const a2 = msg({ autor: "agente" });
    expect(ids(emOrdemDoChat([p, a1, r, a2], vivo(0, "tp")))).toEqual(ids([p, a1, a2]));
    const fim = msg({ autor: "agente", fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, a1, r, a2, fim], SEM))).toEqual(ids([p, a1, a2, fim, r]));
  });

  it("turno acabado sem fimDoTurno numa fala (parado, falhou com aviso): a âncora é a última mensagem do turno", () => {
    const p = msg({ autor: "pessoa" });
    const meio = msg({ autor: "agente" });
    const r = daRotina();
    const ultima = msg({ autor: "agente" });
    expect(ids(emOrdemDoChat([p, meio, r, ultima], SEM))).toEqual(ids([p, meio, ultima, r]));
  });

  it("rotina sem conversa em volta, ou depois do turno, não muda de lugar (mesma lista)", () => {
    const r1 = daRotina();
    const p = msg({ autor: "pessoa" });
    const fim = msg({ autor: "agente", fimDoTurno: true });
    const r2 = daRotina();
    const lista = [r1, p, fim, r2];
    expect(emOrdemDoChat(lista, SEM)).toBe(lista);
    expect(emOrdemDoChat(lista, vivo(r2.criadoEm + 1))).toBe(lista);
  });

  it("uma rotina antiga nunca pula para depois de um turno que começou depois dela (revisão 4, A1)", () => {
    const p1 = msg({ autor: "pessoa" });
    const parado = msg({ autor: "agente", kind: "sistema" as Mensagem["kind"], turnoId: "t1" });
    const r = daRotina();
    const p2 = msg({ autor: "pessoa" });
    const a2 = msg({ autor: "agente", turnoId: "t2", fimDoTurno: true });
    const lista = [p1, parado, r, p2, a2];
    expect(emOrdemDoChat(lista, SEM)).toBe(lista);
    // A mensagem cancelada na fila (sem resposta nenhuma) também não abre nada.
    const cancelada = msg({ autor: "pessoa" });
    const r3 = daRotina();
    const p4 = msg({ autor: "pessoa" });
    const a4 = msg({ autor: "agente", turnoId: "t4", fimDoTurno: true });
    const outra = [cancelada, r3, p4, a4];
    expect(emOrdemDoChat(outra, SEM)).toBe(outra);
  });

  it("fala de task (trabalhoId) não conta como turno da conversa nem como bastidores", () => {
    const p = msg({ autor: "pessoa" });
    const task = msg({ autor: "agente", turnoId: "tt", trabalhoId: "w1", origemTurno: "rotina", fimDoTurno: true });
    const fim = msg({ autor: "agente", fimDoTurno: true });
    const lista = [p, task, fim];
    expect(emOrdemDoChat(lista, SEM)).toBe(lista);
  });

  it("dois turnos da conversa em sequência: cada rotina vai para depois do SEU turno", () => {
    const p = msg({ autor: "pessoa" });
    const meio1 = msg({ autor: "agente" });
    const r1 = daRotina();
    const fim1 = msg({ autor: "agente", fimDoTurno: true });
    const meio2 = msg({ autor: "agente", turnoId: "tp2", turnoDesde: fim1.criadoEm });
    const r2 = daRotina({ turnoId: "tr2" });
    const fim2 = msg({ autor: "agente", turnoId: "tp2", turnoDesde: fim1.criadoEm, fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, meio1, r1, fim1, meio2, r2, fim2], SEM))).toEqual(ids([p, meio1, fim1, r1, meio2, fim2, r2]));
  });

  it("sem turno vivo da pessoa (desde nulo), nada é segurado; a fila também segura, ver pedido-na-troca", () => {
    const p = msg({ autor: "pessoa" });
    const r = daRotina();
    const lista = [p, r];
    expect(emOrdemDoChat(lista, SEM)).toBe(lista);
    expect(emOrdemDoChat(lista, vivo(null, "tp"))).toBe(lista);
    expect(ids(emOrdemDoChat(lista, vivo(0, "tp")))).toEqual(ids([p]));
  });

  it("a rotina gravada com o turno da pessoa ainda na fila não some quando ele passa a rodar", () => {
    const p = msg({ autor: "pessoa" });
    const r = daRotina();
    const lista = [p, r];
    expect(emOrdemDoChat(lista, vivo(r.criadoEm + 1, "tp"))).toBe(lista);
    expect(ids(emOrdemDoChat(lista, vivo(r.criadoEm, "tp")))).toEqual(ids([p]));
  });

  it("revisão 15: dois turnos da pessoa sobrepostos (o 1º acabou, o 2º vive): a rotina fica segurada; acabados, vai depois do último", () => {
    const a = msg({ autor: "pessoa" });
    const m1 = msg({ autor: "agente", turnoId: "t1" });
    const b = msg({ autor: "pessoa" });
    const r = daRotina();
    const f1 = msg({ autor: "agente", turnoId: "t1", fimDoTurno: true, turnoDesde: a.criadoEm });
    const f2 = msg({ autor: "agente", turnoId: "t2", fimDoTurno: true, turnoDesde: b.criadoEm });
    expect(ids(emOrdemDoChat([a, m1, b, r, f1], vivo(b.criadoEm, "t2")))).toEqual(ids([a, m1, b, f1]));
    expect(ids(emOrdemDoChat([a, m1, b, r, f1, f2], SEM))).toEqual(ids([a, m1, b, f1, f2, r]));
  });

  it("revisão 14: o turno da pessoa que ficou parado na fila fala pela 1ª vez e a rotina já à vista não some (turnoDesde = despacho)", () => {
    const p = msg({ autor: "pessoa" });
    const r = daRotina();
    const despacho = r.criadoEm + 1;
    const f1 = msg({ autor: "agente", turnoId: "tp", turnoDesde: despacho });
    expect(ids(emOrdemDoChat([p, r, f1], vivo(despacho, "tp")))).toEqual(ids([p, r, f1]));
    // Com a criação (esperou pouco), a âncora segura a rotina até o turno acabar.
    const f1cedo = { ...f1, turnoDesde: p.criadoEm };
    expect(ids(emOrdemDoChat([p, r, f1cedo], vivo(p.criadoEm, "tp")))).toEqual(ids([p, f1cedo]));
  });

  it("a marca do servidor vale para o turno sob procuração (origem conversa) e a linha rotina_execucao com autoria de pessoa", () => {
    const p = msg({ autor: "pessoa" });
    const sp = msg({ autor: "agente", turnoId: "ts", bastidores: true, fimDoTurno: true });
    const x = msg({ autor: "pessoa", kind: "rotina_execucao", turnoId: "tr" });
    const fim = msg({ autor: "agente", fimDoTurno: true });
    expect(ids(emOrdemDoChat([p, sp, x, fim], SEM))).toEqual(ids([p, fim, sp, x]));
  });

  it("a fala da pessoa absorvida pela sessão viva no meio do turno não divide o turno", () => {
    const p1 = msg({ autor: "pessoa" });
    const r = daRotina();
    const p2 = msg({ autor: "pessoa" });
    const fim = msg({ autor: "agente", fimDoTurno: true, turnoDesde: p1.criadoEm });
    expect(ids(emOrdemDoChat([p1, r, p2, fim], SEM))).toEqual(ids([p1, p2, fim, r]));
  });

  it("a âncora é a ÚLTIMA mensagem do turno da conversa, não a primeira", () => {
    const p1 = msg({ autor: "pessoa" });
    const r = daRotina();
    const meio = msg({ autor: "agente" });
    const p2 = msg({ autor: "pessoa" });
    const fim = msg({ autor: "agente", fimDoTurno: true, turnoDesde: p1.criadoEm });
    expect(ids(emOrdemDoChat([p1, r, meio, p2, fim], SEM))).toEqual(ids([p1, meio, p2, fim, r]));
  });

  it("depois da fala absorvida, com o turno da pessoa rodando, a rotina fica segurada", () => {
    const p1 = msg({ autor: "pessoa" });
    const meio = msg({ autor: "agente" });
    const p2 = msg({ autor: "pessoa" });
    const r = daRotina();
    expect(ids(emOrdemDoChat([p1, meio, r, p2], vivo(0, "tp")))).toEqual(ids([p1, meio, p2]));
    expect(ids(emOrdemDoChat([p1, meio, p2, r], vivo(0, "tp")))).toEqual(ids([p1, meio, p2]));
  });

  it("a retomada (outro turno, aberto pelo cartão, sem fala de texto da pessoa) também ancora (revisão 4, M3)", () => {
    const p1 = msg({ autor: "pessoa" });
    const pergunta = msg({ autor: "agente", fimDoTurno: true });
    const ret1 = msg({ autor: "agente", turnoId: "tret", origemTurno: "retomada" as OrigemTurno, turnoDesde: pergunta.criadoEm + 0.5 });
    const r = daRotina();
    const fimRet = msg({ autor: "agente", turnoId: "tret", origemTurno: "retomada" as OrigemTurno, turnoDesde: pergunta.criadoEm + 0.5, fimDoTurno: true });
    expect(ids(emOrdemDoChat([p1, pergunta, ret1, r, fimRet], SEM))).toEqual(ids([p1, pergunta, ret1, fimRet, r]));
    expect(ids(emOrdemDoChat([p1, pergunta, ret1, r], vivo(pergunta.criadoEm, "tret")))).toEqual(ids([p1, pergunta, ret1]));
  });

  it("frame ao vivo sem turnoDesde: vale o turno vivo agora", () => {
    const p = msg({ autor: "pessoa" });
    const r = daRotina();
    const a = msg({ autor: "agente", turnoDesde: undefined });
    expect(ids(emOrdemDoChat([p, r, a], vivo(0, "tp")))).toEqual(ids([p, a]));
    const lista = [p, r, a];
    expect(emOrdemDoChat(lista, SEM)).toBe(lista);
  });
});
