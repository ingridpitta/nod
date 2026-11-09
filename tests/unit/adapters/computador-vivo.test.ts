import { describe, expect, it } from "vitest";
import { criarSessoesVivo, VIVO_POR_TELA, FALHAS_RECONFERIR_MAX, type LadoVivo } from "../../../src/adapters/computador/vivo.ts";
import { FECHAMENTOS_VIVO } from "../../../src/contracts/computador-vivo.ts";

/** NOD-95 (ADR-138): as sessões da tela ao vivo pareiam o lado da web com o do motor e só repassam bytes. */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

function lado() {
  const recebidos: Uint8Array[] = [];
  let aoDados: ((b: Uint8Array) => void) | null = null;
  let aoFechar: (() => void) | null = null;
  const fechamentos: Array<[number, string | undefined]> = [];
  const l: LadoVivo = {
    enviar: (b) => recebidos.push(b),
    aoDados: (fn) => { aoDados = fn; },
    aoFechar: (fn) => { aoFechar = fn; },
    fechar: (c, m) => { fechamentos.push([c, m]); aoFechar?.(); },
  };
  return { l, recebidos, fechamentos, chegou: (b: Uint8Array) => aoDados?.(b), caiu: () => aoFechar?.() };
}

describe("sessões da tela ao vivo", () => {
  it("web abre, motor chega com o token: os bytes correm nos dois sentidos; um lado fecha, o outro fecha", () => {
    const s = criarSessoesVivo();
    const web = lado();
    const { sessao, token } = s.abrir({ escopo: ESCOPO, agenteId: "a1", web: web.l });
    expect(s.abertas()).toEqual([{ sessao, agenteId: "a1", pareada: false }]);
    const motor = lado();
    expect(s.anexarMotor(sessao, token, motor.l)).toBe(true);
    expect(s.abertas()[0]!.pareada).toBe(true);
    motor.chegou(new Uint8Array([1, 2]));
    web.chegou(new Uint8Array([3]));
    expect(web.recebidos).toEqual([new Uint8Array([1, 2])]);
    expect(motor.recebidos).toEqual([new Uint8Array([3])]);
    motor.caiu();
    expect(web.fechamentos).toEqual([[1000, undefined]]);
    expect(s.abertas()).toEqual([]);
  });

  it("token errado, sessão desconhecida ou já pareada: o motor não entra", () => {
    const s = criarSessoesVivo();
    const web = lado();
    const { sessao, token } = s.abrir({ escopo: ESCOPO, agenteId: "a1", web: web.l });
    expect(s.anexarMotor(sessao, `${token}x`, lado().l)).toBe(false);
    expect(s.anexarMotor("nao-existe", token, lado().l)).toBe(false);
    expect(s.anexarMotor(sessao, token, lado().l)).toBe(true);
    expect(s.anexarMotor(sessao, token, lado().l)).toBe(false);
  });

  it("o motor não chega no prazo: a web fecha com sem_maquina", async () => {
    const s = criarSessoesVivo({ prazoParMs: 20 });
    const web = lado();
    s.abrir({ escopo: ESCOPO, agenteId: "a1", web: web.l });
    await new Promise((r) => setTimeout(r, 40));
    expect(web.fechamentos).toEqual([[FECHAMENTOS_VIVO.sem_maquina, "a máquina não chegou"]]);
    expect(s.abertas()).toEqual([]);
  });

  it("recusar (o comando falhou) e fecharDaTela (o controle mudou) fecham com o motivo; outra pessoa/tela fica", () => {
    const s = criarSessoesVivo();
    const a = lado();
    const { sessao } = s.abrir({ escopo: ESCOPO, agenteId: "a1", web: a.l });
    s.recusar(sessao, "nao_permitido");
    expect(a.fechamentos).toEqual([[FECHAMENTOS_VIVO.recusado, "nao_permitido"]]);
    const b = lado();
    const c = lado();
    const outra = lado();
    s.abrir({ escopo: ESCOPO, agenteId: "a1", web: b.l });
    s.abrir({ escopo: ESCOPO, agenteId: "a2", web: c.l });
    s.abrir({ escopo: { ...ESCOPO, pessoaId: "00000000-0000-4000-8000-0000000000b2" }, agenteId: "a1", web: outra.l });
    s.fecharDaTela(ESCOPO, "a1");
    expect(b.fechamentos).toEqual([[FECHAMENTOS_VIVO.trocou, "o controle mudou"]]);
    expect(c.fechamentos).toEqual([]);
    expect(outra.fechamentos).toEqual([]);
    expect(s.abertas().map((x) => x.agenteId)).toEqual(["a2", "a1"]);
  });

  it("revisão do PR #599: mesma pessoa e tela passa de VIVO_POR_TELA, a mais antiga cai; outro tenant com o mesmo pessoaId conta à parte", () => {
    const s = criarSessoesVivo();
    const lados = Array.from({ length: VIVO_POR_TELA + 1 }, () => lado());
    const outroTenant = lado();
    s.abrir({ escopo: { ...ESCOPO, tenantId: "00000000-0000-4000-8000-0000000000a2" }, agenteId: "a1", web: outroTenant.l });
    for (const l of lados) s.abrir({ escopo: ESCOPO, agenteId: "a1", web: l.l });
    expect(lados[0]!.fechamentos).toEqual([[FECHAMENTOS_VIVO.trocou, "outra janela abriu a tela"]]);
    for (const l of lados.slice(1)) expect(l.fechamentos).toEqual([]);
    expect(outroTenant.fechamentos).toEqual([]);
    expect(s.abertas()).toHaveLength(VIVO_POR_TELA + 1);
    s.fecharDaTela(ESCOPO, "a1");
    expect(outroTenant.fechamentos).toEqual([]);
  });

  it("revisão do PR #599: no pareamento e a cada intervalo reconfere o controle; perdeu (ou o conferir lançou seguidas vezes), a sessão acaba", async () => {
    const s = criarSessoesVivo({ reconferirMs: 10 });
    const ja = lado();
    const a = s.abrir({ escopo: ESCOPO, agenteId: "a1", web: ja.l, conferir: async () => false });
    const motorJa = lado();
    expect(s.anexarMotor(a.sessao, a.token, motorJa.l)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(ja.fechamentos).toEqual([[FECHAMENTOS_VIVO.trocou, "o controle mudou"]]);
    expect(motorJa.fechamentos).toEqual([[FECHAMENTOS_VIVO.trocou, "o controle mudou"]]);

    // 2ª revisão: um erro solto do banco não derruba; FALHAS_RECONFERIR_MAX erros seguidos, sim.
    let modo: "ok" | "um_erro" | "erro" = "ok";
    const chamadas: string[] = [];
    const depois = lado();
    const b = s.abrir({ escopo: ESCOPO, agenteId: "a2", web: depois.l, conferir: async () => {
      chamadas.push(modo);
      if (modo === "ok") return true;
      if (modo === "um_erro") { modo = "ok"; throw new Error("banco soluçou"); }
      throw new Error("banco caiu");
    } });
    s.anexarMotor(b.sessao, b.token, lado().l);
    await new Promise((r) => setTimeout(r, 25));
    modo = "um_erro";
    await new Promise((r) => setTimeout(r, 40));
    expect(chamadas).toContain("um_erro");
    expect(depois.fechamentos).toEqual([]);
    modo = "erro";
    await new Promise((r) => setTimeout(r, 10 * (FALHAS_RECONFERIR_MAX + 3)));
    expect(chamadas.filter((c) => c === "erro").length).toBeGreaterThanOrEqual(FALHAS_RECONFERIR_MAX);
    expect(depois.fechamentos).toEqual([[FECHAMENTOS_VIVO.trocou, "o controle mudou"]]);
    expect(s.abertas()).toEqual([]);
  });
});
