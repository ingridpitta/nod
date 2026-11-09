import { describe, expect, it } from "vitest";
import {
  aposFalha,
  CRIAR_DESISTIR_APOS_MS,
  NOVA_TENTATIVA_MS,
  nomeDaInstanciaCriada,
  proximoPasso,
  scriptDeGuarda,
  scriptDeInicio,
  servidorPublicoValido,
  subredeDaZona,
  zonaDaRegiao,
  type SituacaoNuvem,
} from "../../../src/domain/maquina-nuvem.ts";

/** ADR-121 (NOD-92, PR 2): o domínio puro da criação. */
const criando = (o: Partial<SituacaoNuvem> = {}): SituacaoNuvem => ({
  estado: "criando",
  desejado: "acordada",
  estadoDesde: 0,
  ligouEm: null,
  reiniciouEm: null,
  proximaTentativaEm: null,
  contato: false,
  ...o,
});
const CONVITE = "a".repeat(32);

describe("criar a VM: passos do reconciliador", () => {
  it("sem ligar ainda → criar (mesmo com a instância inexistente, que é o normal antes de criar)", () => {
    expect(proximoPasso(criando(), null, 1_000)).toEqual({ passo: "criar" });
    expect(proximoPasso(criando(), "inexistente", 1_000)).toEqual({ passo: "criar" });
  });

  it("criada e com contato do motor → finalizar; sem contato espera até 15 min e então falha", () => {
    expect(proximoPasso(criando({ ligouEm: 1_000, contato: true }), null, 2_000)).toEqual({ passo: "finalizar" });
    expect(proximoPasso(criando({ ligouEm: 1_000 }), null, 1_000 + CRIAR_DESISTIR_APOS_MS - 1)).toEqual({ passo: "nada" });
    expect(proximoPasso(criando({ ligouEm: 1_000 }), null, 1_000 + CRIAR_DESISTIR_APOS_MS)).toEqual({ passo: "marcar", estado: "falhou_ao_acordar", motivo: "motor_sem_contato" });
  });

  it("sem capacidade ao criar: segue criando e espera a próxima tentativa", () => {
    expect(aposFalha("criando", "sem_capacidade", 1_000)).toEqual({ estado: "criando", motivo: "sem_capacidade", proximaTentativaEm: 1_000 + NOVA_TENTATIVA_MS });
    expect(aposFalha("criando", "credencial_nuvem", 1_000).estado).toBe("falhou_ao_acordar");
    // Item 10: criar sem capacidade também desiste aos 30 min desde o primeiro "Criando…".
    expect(aposFalha("criando", "sem_capacidade", 31 * 60_000, 0).estado).toBe("falhou_ao_acordar");
    expect(proximoPasso(criando({ proximaTentativaEm: 5_000 }), null, 4_999)).toEqual({ passo: "nada" });
    expect(proximoPasso(criando({ proximaTentativaEm: 5_000 }), null, 5_000)).toEqual({ passo: "criar" });
  });

  it("excluída fica quieta mesmo se a instância sumiu", () => {
    expect(proximoPasso(criando({ estado: "excluida" }), "inexistente", 1_000)).toEqual({ passo: "nada" });
  });

  it("revisão NOD-92 (rodada 2, item 3): excluída com exclusão pendente apaga de novo na hora marcada", () => {
    expect(proximoPasso(criando({ estado: "excluida", proximaTentativaEm: 5_000 }), null, 4_999)).toEqual({ passo: "nada" });
    expect(proximoPasso(criando({ estado: "excluida", proximaTentativaEm: 5_000 }), null, 5_000)).toEqual({ passo: "excluir" });
  });
});

describe("criar a VM: nome, região e sub-rede", () => {
  it("o nome leva o prefixo do nod e 6 hex minúsculos", () => {
    expect(nomeDaInstanciaCriada("A1B2C3D4")).toBe("nod-g-a1b2c3");
    expect(nomeDaInstanciaCriada("zz")).toBe("nod-g-000000");
  });

  it("só as três regiões do protótipo; us-east1 cai na zona b", () => {
    expect(zonaDaRegiao("southamerica-east1")).toBe("southamerica-east1-a");
    expect(zonaDaRegiao("us-east1")).toBe("us-east1-b");
    expect(zonaDaRegiao("europe-west1")).toBeNull();
    expect(subredeDaZona("proj", "us-east1-b")).toBe("projects/proj/regions/us-east1/subnetworks/nod-maquinas");
  });
});

describe("criar a VM: script de início", () => {
  it("instala com o convite até o prazo e sai cedo se o motor já está pareado", () => {
    const s = scriptDeInicio({ servidor: "https://nod.exemplo.com.br", convite: CONVITE, expiraEm: 1_800_000 });
    expect(s.startsWith("#!/bin/sh")).toBe(true);
    expect(s).toContain(`'https://nod.exemplo.com.br/motor?convite=${CONVITE}'`);
    expect(s).toContain("-lt 1800 ]");
    expect(s.indexOf("conexao.json ] && exit 0")).toBeLessThan(s.indexOf("curl"));
  });

  it("a guarda não carrega convite nem instala nada", () => {
    expect(scriptDeGuarda()).not.toMatch(/convite|curl/);
  });

  it("recusa servidor ou convite fora do formato (nada cru entra no shell)", () => {
    expect(() => scriptDeInicio({ servidor: "https://x.com/'; rm -rf /", convite: CONVITE, expiraEm: 1 })).toThrow("servidor_ou_convite_invalido");
    expect(() => scriptDeInicio({ servidor: "https://x.com", convite: "curto'", expiraEm: 1 })).toThrow("servidor_ou_convite_invalido");
  });
});

describe("domínio: NOD_URL_PUBLICA (revisão, item 9)", () => {
  it("aceita só esquema + host (+ porta); o resto desliga a criação ao subir", () => {
    expect(servidorPublicoValido("https://nod.exemplo.com.br")).toBe(true);
    expect(servidorPublicoValido("http://10.0.0.2:3000")).toBe(true);
    for (const ruim of ["", "nod.exemplo.com", "https://nod.exemplo.com/app", "https://NOD.com", "https://nod.com?x=1", "https://nod.com' ; rm -rf /"]) expect(servidorPublicoValido(ruim)).toBe(false);
  });
});
