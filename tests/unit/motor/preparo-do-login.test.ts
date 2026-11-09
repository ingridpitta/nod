import { describe, expect, it } from "vitest";
import { compararVersoes } from "../../../src/adapters/executor/flag-floors.ts";
import type { AtualizacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import type { FimDoPasso } from "../../../desktop/atualizador-ias.ts";
import { criarPreparoNoMotor, ESPACO_DO_PREPARO_MB, livreEmMb, type DepsPreparoNoMotor } from "../../../motor/preparo-do-login.ts";

/** NOD-8 passo 10: o que o login na VM prepara (instalar/atualizar) e como a falha chega ao relato. */
function montar(o: { bin?: string | null; versao?: string | null; configurado?: boolean; livre?: number | null; atualizacao?: AtualizacaoDaIa | null; fim?: FimDoPasso } = {}) {
  const chamadas = { atualizar: 0, passo: [] as string[], sondar: 0 };
  const d: DepsPreparoNoMotor = {
    bin: async () => (o.bin === undefined ? "/home/nod/.local/bin/claude" : o.bin),
    configurado: () => o.configurado ?? false,
    lerVersao: async () => (o.versao === undefined ? "2.0.1" : o.versao),
    piso: () => "2.1.150",
    comparar: compararVersoes,
    pastaLocal: "/home/nod/.local",
    livreMb: async () => (o.livre === undefined ? 50_000 : o.livre),
    atualizador: { atualizar: async () => { chamadas.atualizar++; return o.atualizacao === undefined ? { fase: "sucesso", alvo: "2.1.150", antes: "2.0.1", depois: "2.1.200", caminho: "npm_local", em: 5 } : o.atualizacao; } },
    passo: () => ({ tipo: "npm_local", rodar: async (alvo) => { chamadas.passo.push(alvo); return o.fim ?? { resultado: "ok", antes: null, depois: "2.1.200", atende: true }; } }),
    sondar: async () => { chamadas.sondar++; },
    agora: () => 7,
    registrar: () => undefined,
  };
  return { p: criarPreparoNoMotor(d), chamadas };
}

describe("NOD-8 passo 10: criarPreparoNoMotor", () => {
  it("precisa: sem binário instala; abaixo do piso atualiza; em dia, ilegível ou de NOD_*_BIN não mexe", async () => {
    expect(await montar({ bin: null }).p.precisa("claude-cli")).toEqual({ acao: "instalar" });
    expect(await montar().p.precisa("claude-cli")).toEqual({ acao: "atualizar", antes: "2.0.1" });
    expect(await montar({ versao: "2.1.150" }).p.precisa("claude-cli")).toBeNull();
    expect(await montar({ versao: null }).p.precisa("claude-cli")).toBeNull();
    expect(await montar({ bin: null, configurado: true }).p.precisa("claude-cli")).toBeNull();
  });

  it("atualizar vai pelo orquestrador (clique, agora) e relê as IAs no sucesso", async () => {
    const m = montar();
    const fim = await m.p.rodar("claude-cli", { acao: "atualizar", antes: "2.0.1" });
    expect(fim).toMatchObject({ ok: true, depois: "2.1.200", atualizacao: { fase: "sucesso" } });
    expect(m.chamadas).toEqual({ atualizar: 1, passo: [], sondar: 1 });
  });

  it("instalar roda o npm_local direto até o piso (o orquestrador não instala) e monta o estado", async () => {
    const m = montar({ bin: null });
    const fim = await m.p.rodar("claude-cli", { acao: "instalar" });
    expect(m.chamadas).toEqual({ atualizar: 0, passo: ["2.1.150"], sondar: 1 });
    expect(fim).toEqual({ ok: true, depois: "2.1.200", atualizacao: { fase: "sucesso", alvo: "2.1.150", caminho: "npm_local", depois: "2.1.200", em: 7 } });
  });

  it("instalar sem internet: falhou com o motivo, sem reler", async () => {
    const m = montar({ bin: null, fim: { resultado: "sem_internet", antes: null, depois: null, atende: false } });
    const fim = await m.p.rodar("claude-cli", { acao: "instalar" });
    expect(fim).toEqual({ ok: false, atualizacao: { fase: "falhou", alvo: "2.1.150", caminho: "npm_local", motivo: "sem_internet", em: 7 } });
    expect(m.chamadas.sondar).toBe(0);
  });

  it("menos de 2 GB em ~/.local: sem_espaco com o livre e o preciso, sem rodar o npm", async () => {
    const m = montar({ livre: 1200 });
    const fim = await m.p.rodar("claude-cli", { acao: "atualizar", antes: "2.0.1" });
    expect(fim).toEqual({ ok: false, atualizacao: { fase: "falhou", alvo: "2.1.150", caminho: "npm_local", antes: "2.0.1", motivo: "sem_espaco", em: 7, espaco: { livreMb: 1200, precisaMb: ESPACO_DO_PREPARO_MB } } });
    expect(m.chamadas).toEqual({ atualizar: 0, passo: [], sondar: 0 });
  });

  it("sem leitura do disco: segue (o npm diz se faltar); orquestrador sem estado vira falhou", async () => {
    const m = montar({ livre: null, atualizacao: null });
    const fim = await m.p.rodar("claude-cli", { acao: "atualizar", antes: "2.0.1" });
    expect(fim).toMatchObject({ ok: false, atualizacao: { fase: "falhou", motivo: "falhou" } });
    expect(m.chamadas.atualizar).toBe(1);
  });

  it("QA #511: com uma atualização já rodando (o orquestrador volta 'atualizando' na hora), espera ela acabar em vez de falhar", async () => {
    const fases: AtualizacaoDaIa[] = [
      { fase: "atualizando", alvo: "2.1.150", antes: "2.0.1", caminho: "npm_local", em: 1 },
      { fase: "atualizando", alvo: "2.1.150", antes: "2.0.1", caminho: "npm_local", em: 1 },
      { fase: "sucesso", alvo: "2.1.150", antes: "2.0.1", depois: "2.1.200", caminho: "npm_local", em: 9 },
    ];
    const esperas: number[] = [];
    let n = 0;
    const p = criarPreparoNoMotor({
      bin: async () => "/home/nod/.local/bin/claude", configurado: () => false, lerVersao: async () => "2.0.1", piso: () => "2.1.150", comparar: compararVersoes,
      pastaLocal: "/home/nod/.local", livreMb: async () => 50_000,
      atualizador: { atualizar: async () => fases[Math.min(n++, fases.length - 1)]! },
      passo: () => ({ tipo: "npm_local", rodar: async () => ({ resultado: "ok", antes: null, depois: null, atende: true }) }),
      sondar: async () => undefined, agora: () => 7, registrar: () => undefined,
      esperar: async (ms) => { esperas.push(ms); },
    });
    const fim = await p.rodar("claude-cli", { acao: "atualizar", antes: "2.0.1" });
    expect(fim).toMatchObject({ ok: true, depois: "2.1.200", atualizacao: { fase: "sucesso" } });
    expect(n).toBe(3);
    expect(esperas.length).toBe(2);
  });

  it("QA #511: a espera pela atualização dos outros tem teto (não prende o login para sempre)", async () => {
    let n = 0;
    const p = criarPreparoNoMotor({
      bin: async () => "/x", configurado: () => false, lerVersao: async () => "2.0.1", piso: () => "2.1.150", comparar: compararVersoes,
      pastaLocal: "/home/nod/.local", livreMb: async () => 50_000,
      atualizador: { atualizar: async () => { n++; return { fase: "pedindo_aprovacao", alvo: "2.1.150", em: 1 }; } },
      passo: () => ({ tipo: "npm_local", rodar: async () => ({ resultado: "ok", antes: null, depois: null, atende: true }) }),
      sondar: async () => undefined, agora: () => 7, registrar: () => undefined, esperar: async () => undefined,
    });
    const fim = await p.rodar("claude-cli", { acao: "atualizar", antes: "2.0.1" });
    expect(fim.ok).toBe(false);
    expect(fim.atualizacao).toMatchObject({ fase: "falhou", motivo: "tempo_esgotado" });
    expect(n).toBeGreaterThan(2);
  });

  it("livreEmMb sobe até um pai que existe (o ~/.local nasce na instalação)", async () => {
    const mb = await livreEmMb("/tmp/nao-existe-nod-8/.local");
    expect(typeof mb).toBe("number");
  });
});
