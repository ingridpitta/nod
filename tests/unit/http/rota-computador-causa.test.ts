import { MOTIVOS_FALHA_COMPUTADOR } from "../../../src/contracts/motivos.ts";
import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { MOTIVOS_DO_COMPUTADOR, rotasComputadores } from "../../../src/adapters/http/rotas/computadores.ts";
import type { Computadores } from "../../../src/adapters/fundo/computadores.ts";
import type { Ctx } from "../../../src/adapters/http/roteador.ts";

/** NOD-407: o 409 das rotas do computador diz a causa real (lista branca) em vez do "Atualize a página" genérico. */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

function chamar(rotaPadrao: string, metodo: "GET" | "POST", corpo: unknown, falha: unknown, params: Record<string, string> = {}) {
  const computadores = {
    operarDaPessoa: async () => { throw falha; },
    configurar: async () => { throw falha; },
    humano: async () => { throw falha; },
  } as unknown as Computadores;
  const rota = rotasComputadores(computadores).find((r) => r.metodo === metodo && r.padrao.source === rotaPadrao)!;
  const resposta: { status?: number; corpo?: unknown } = {};
  const ctx = { escopo: ESCOPO, params, corpo: async () => corpo, json: (status: number, c: unknown) => { resposta.status = status; resposta.corpo = c; } } as unknown as Ctx;
  return rota.handler(ctx).then(() => resposta);
}

describe("rotas do computador: a causa real no 409 (NOD-407)", () => {
  it("todo motivo de falha do computador sai com `motivo` e frase própria, nunca o 'Atualize a página' genérico", async () => {
    for (const m of MOTIVOS_FALHA_COMPUTADOR) {
      const { corpo } = await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: m }));
      const c = corpo as { motivo?: string; mensagem?: string };
      expect(c.motivo, m).toBeTypeOf("string");
      expect(c.mensagem, m).not.toMatch(/Atualize a página/);
      expect(c.motivo, m).toBe(Object.hasOwn(MOTIVOS_DO_COMPUTADOR, m) ? m : "indisponivel");
    }
    const r = await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "constructor" }));
    expect((r.corpo as { motivo: string }).motivo).toBe("indisponivel");
  });

  it("acordar com a máquina sem contato: 409 com a frase da tabela e o motivo", async () => {
    const r = await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "maquina_sem_contato" }));
    expect(r).toEqual({ status: 409, corpo: { codigo: "estado_invalido", mensagem: MOTIVOS_DO_COMPUTADOR.maquina_sem_contato, motivo: "maquina_sem_contato" } });
  });

  it("'computador fora do ar' vira fora_do_ar; a reserva viva é ocupado; sem causa é indisponivel (não repete); causa fora da lista é indisponivel; outros códigos seguem o caminho comum", async () => {
    expect((await chamar("^\\/agentes\\/(?<id>[^/]+)\\/computador$", "POST", { operacao: "assumir" }, new ErroDeDominio("estado_invalido", { cause: "computador fora do ar" }), { id: "a" })).corpo).toMatchObject({ motivo: "fora_do_ar" });
    expect((await chamar("^\\/agentes\\/(?<id>[^/]+)\\/computador\\/acoes$", "POST", { tipo: "observar" }, new ErroDeDominio("estado_invalido", { cause: "ocupado" }), { id: "a" })).corpo).toMatchObject({ motivo: "ocupado", mensagem: MOTIVOS_DO_COMPUTADOR.ocupado });
    expect((await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido"))).corpo).toMatchObject({ motivo: "indisponivel", mensagem: MOTIVOS_DO_COMPUTADOR.indisponivel });
    // NOD-407: o app abaixo do piso do computador chega com código próprio.
    expect(await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "app_desatualizado" }))).toEqual({ status: 409, corpo: { codigo: "estado_invalido", mensagem: MOTIVOS_DO_COMPUTADOR.app_desatualizado, motivo: "app_desatualizado" } });
    // Causa fora da lista vira `indisponivel`: o texto da causa nunca sai no corpo.
    expect((await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "segredo da pessoa" }))).corpo).toEqual({ codigo: "estado_invalido", mensagem: MOTIVOS_DO_COMPUTADOR.indisponivel, motivo: "indisponivel" });
    await expect(chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("nao_permitido"))).rejects.toMatchObject({ codigo: "nao_permitido" });
  });
});
