import { describe, expect, it } from "vitest";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { criarPassosVivos, ROTULO_DO_TEXTO } from "../../../src/adapters/fundo/passos-vivos.ts";
import { frameDaFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";
import type { NovoPasso } from "../../../src/repositories/turno-passos.repo.ts";

const plano = { turnoId: "T1", tenantId: "ten", autoria: { conta_de_execucao: "p1" } } as unknown as PlanoTurno;

/** Um banco de mentira: guarda o que foi gravado e só responde depois que o teste abre o portão (`soltar`). */
function cenario(o: { falhar?: boolean } = {}) {
  const gravados: NovoPasso[][] = [];
  const falhas: string[] = [];
  const frames: { tipo: string; dados: Record<string, unknown> }[] = [];
  let abrir: () => void = () => undefined;
  const portao = new Promise<void>((r) => { abrir = r; });
  let seq = 100;
  const p = criarPassosVivos({
    gravar: async (_plano, passos) => {
      await portao;
      if (o.falhar) throw new Error("banco fora");
      gravados.push(passos);
      return passos.map((x) => ({ ...x, seq: ++seq, em: 0 }));
    },
    marcarFalha: async (_plano, id) => { falhas.push(id); },
    publicar: (_plano, tipo, dados) => void frames.push({ tipo, dados }),
  });
  const soltar = async () => {
    abrir();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { p, gravados, falhas, frames, soltar };
}

describe("passos-vivos (ADR-165): os frames ao vivo viram passos, na ordem", () => {
  it("os pedaços de texto juntam num bloco só, gravado quando a ferramenta chega; a atividade sai com o seq dela", async () => {
    const c = cenario();
    void c.p.registrar(plano, "turno.delta", { texto: "Vou olhar " });
    void c.p.registrar(plano, "turno.delta", { texto: "o repo." });
    // Sem gravação pendente, o delta sai na hora.
    expect(c.frames.map((f) => f.tipo)).toEqual(["turno.delta", "turno.delta"]);
    const feito = c.p.registrar(plano, "turno.atividade", frameDaFerramenta("Bash", "u1", "git status"));
    // Com a gravação em voo, o delta seguinte espera a atividade sair primeiro.
    void c.p.registrar(plano, "turno.delta", { texto: "Pronto." });
    expect(c.frames).toHaveLength(2);
    await c.soltar();
    await feito;
    expect(c.gravados).toEqual([[
      { tipo: "texto", classe: "texto", ferramenta: null, rotulo: ROTULO_DO_TEXTO, resumo: "Vou olhar o repo.", acaoId: null, falhou: false },
      { tipo: "ferramenta", classe: "comando", ferramenta: "Bash", rotulo: "Rodou um comando", resumo: "git status", acaoId: "u1", falhou: false },
    ]]);
    expect(c.frames.map((f) => f.tipo)).toEqual(["turno.delta", "turno.delta", "turno.atividade", "turno.delta"]);
    expect(c.frames[2]!.dados).toMatchObject({ seq: 102, resumo: "git status", classe: "comando", ferramenta: "Bash", id: "u1" });
    // O fim do turno grava o último bloco (redigido, até 160).
    const fim = c.p.encerrar("T1");
    await c.soltar();
    await fim;
    expect(c.gravados[1]).toMatchObject([{ tipo: "texto", resumo: "Pronto." }]);
  });

  it("o fim que falhou marca o passo antes do frame sair; o que deu certo só publica", async () => {
    const c = cenario();
    await c.p.registrar(plano, "turno.acao_fim", { id: "u1", falhou: true });
    await c.p.registrar(plano, "turno.acao_fim", { id: "u2", falhou: false });
    expect(c.falhas).toEqual(["u1"]);
    expect(c.frames.map((f) => f.dados.id)).toEqual(["u1", "u2"]);
  });

  it("o bloco de fala é redigido antes de gravar, e o bloco só de espaço não vira passo", async () => {
    const c = cenario();
    void c.p.registrar(plano, "turno.delta", { texto: "a senha: hunter22 e mais " + "x".repeat(400) });
    const f = c.p.encerrar("T1");
    await c.soltar();
    await f;
    expect(c.gravados[0]![0]!.resumo).not.toContain("hunter22");
    expect(Array.from(c.gravados[0]![0]!.resumo!)).toHaveLength(160);
    void c.p.registrar(plano, "turno.delta", { texto: "   \n " });
    await c.p.encerrar("T1");
    expect(c.gravados).toHaveLength(1);
  });

  it("a gravação que falha não segura a tela: o frame sai com seq null", async () => {
    const c = cenario({ falhar: true });
    const feito = c.p.registrar(plano, "turno.atividade", frameDaFerramenta("Read", "u1", "a.ts"));
    await c.soltar();
    await feito;
    expect(c.frames).toMatchObject([{ tipo: "turno.atividade", dados: { seq: null, resumo: "a.ts" } }]);
  });
});
