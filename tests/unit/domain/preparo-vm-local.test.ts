import { describe, expect, it } from "vitest";
import {
  DESLIGAR_LEVA_MS,
  DORMIR_APOS_MS,
  esperaDoBackoff,
  memoriaDaVm,
  preparoInicial,
  REMEDIR_MEMORIA_MS,
  transicao,
  type Efeito,
  type Evento,
  type Preparo,
  type TipoFase,
} from "../../../src/domain/preparo-vm-local.ts";

/** NOD-93 (PR 3): a máquina de estados do preparo da VM local. Tempo por parâmetro; nada de relógio. */
const GIB = 1024 ** 3;
const T0 = 1_000_000;

/** Roda uma sequência [evento, agora] e devolve as fases e os efeitos de cada passo. */
function rodar(passos: Array<[Evento, number]>, inicio: Preparo = preparoInicial()) {
  let p = inicio;
  const trilha: Array<{ fase: TipoFase; efeitos: Efeito[] }> = [];
  for (const [e, agora] of passos) {
    const r = transicao(p, e, agora);
    p = r.preparo;
    trilha.push({ fase: p.fase.tipo, efeitos: r.efeitos });
  }
  return { p, trilha, fases: trilha.map((t) => t.fase) };
}

const iniciar = (o: Partial<Extract<Evento, { tipo: "iniciar" }>> = {}): Evento => ({ tipo: "iniciar", macosSuportado: true, discoNoCache: false, memoriaGiB: 3, modo: "equilibrado", ...o });
const memoria = (gib: number): Evento => ({ tipo: "memoria", livreBytes: gib * GIB });

describe("preparo da VM local (NOD-93)", () => {
  it("caminho feliz: baixa, prepara, mede a memória, liga e fica pronta", () => {
    const { trilha, fases } = rodar([[iniciar(), T0], [{ tipo: "progresso", recebidos: 10, total: 100 }, T0], [{ tipo: "baixou" }, T0], [{ tipo: "preparado" }, T0], [memoria(8), T0], [{ tipo: "ligou" }, T0]]);
    expect(fases).toEqual(["baixando", "baixando", "preparando", "ligando", "ligando", "pronto"]);
    expect(trilha.map((t) => t.efeitos.map((e) => e.tipo))).toEqual([["baixar"], [], ["preparar"], ["medir_memoria"], ["ligar"], ["agendar"]]);
    expect(trilha[4]!.efeitos).toEqual([{ tipo: "ligar", memoriaGiB: 3 }]);
  });

  it("disco já no cache: começa em preparando, sem download", () => {
    const { trilha } = rodar([[iniciar({ discoNoCache: true }), T0]]);
    expect(trilha[0]).toEqual({ fase: "preparando", efeitos: [{ tipo: "preparar" }] });
  });

  it("macOS 12: macos_antigo desde o início, e nada tira dali", () => {
    const { fases, trilha } = rodar([[iniciar({ macosSuportado: false }), T0], [{ tipo: "tentar_agora" }, T0], [{ tipo: "tick" }, T0 + 1e9], [{ tipo: "tela_abriu" }, T0], [{ tipo: "falha", motivo: "x" }, T0]]);
    expect(fases).toEqual(["macos_antigo", "macos_antigo", "macos_antigo", "macos_antigo", "macos_antigo"]);
    expect(trilha.flatMap((t) => t.efeitos)).toEqual([]);
  });

  describe("sem internet", () => {
    it("offline → pausado → retoma no tick do backoff, que dobra de 2 s até 60 s e não desiste", () => {
      let p = rodar([[iniciar(), T0]]).p;
      let agora = T0;
      const esperas: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = transicao(p, { tipo: "sem_internet" }, agora);
        expect(r.preparo.fase.tipo).toBe("pausado_sem_internet");
        const em = (r.efeitos[0] as Extract<Efeito, { tipo: "agendar" }>).em;
        esperas.push(em - agora);
        // Antes da hora, o tick não faz nada; na hora, volta a baixar.
        expect(transicao(r.preparo, { tipo: "tick" }, em - 1).preparo.fase.tipo).toBe("pausado_sem_internet");
        const volta = transicao(r.preparo, { tipo: "tick" }, em);
        expect(volta).toMatchObject({ preparo: { fase: { tipo: "baixando" } }, efeitos: [{ tipo: "baixar" }] });
        p = volta.preparo;
        agora = em;
      }
      expect(esperas).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    });

    it("progresso zera o backoff: a próxima queda espera 2 s de novo", () => {
      const { trilha } = rodar([[iniciar(), T0], [{ tipo: "sem_internet" }, T0], [{ tipo: "tick" }, T0 + 2_000], [{ tipo: "sem_internet" }, T0 + 2_000], [{ tipo: "tick" }, T0 + 6_000], [{ tipo: "progresso", recebidos: 1, total: 2 }, T0 + 7_000], [{ tipo: "sem_internet" }, T0 + 8_000]]);
      expect(trilha[6]!.efeitos).toEqual([{ tipo: "agendar", em: T0 + 10_000 }]);
    });

    it("Tentar agora: volta a baixar na hora e zera o backoff", () => {
      const { p, trilha } = rodar([[iniciar(), T0], [{ tipo: "sem_internet" }, T0], [{ tipo: "tick" }, T0 + 2_000], [{ tipo: "sem_internet" }, T0 + 2_000], [{ tipo: "tentar_agora" }, T0 + 2_100]]);
      expect(trilha[4]).toEqual({ fase: "baixando", efeitos: [{ tipo: "baixar" }] });
      expect(p.quedas).toBe(0);
      expect(transicao(p, { tipo: "sem_internet" }, T0 + 3_000).efeitos).toEqual([{ tipo: "agendar", em: T0 + 5_000 }]);
    });

    it("pausado congela a % e volta a baixar dali, no tick ou em Tentar agora", () => {
      const { trilha } = rodar([[iniciar(), T0], [{ tipo: "progresso", recebidos: 62, total: 100 }, T0], [{ tipo: "sem_internet" }, T0], [{ tipo: "tick" }, T0 + 2_000], [{ tipo: "sem_internet" }, T0 + 2_000], [{ tipo: "tentar_agora" }, T0 + 2_100]]);
      const fases = trilha.map((t) => t.fase);
      expect(fases).toEqual(["baixando", "baixando", "pausado_sem_internet", "baixando", "pausado_sem_internet", "baixando"]);
      const { p: pausado } = rodar([[iniciar(), T0], [{ tipo: "progresso", recebidos: 62, total: 100 }, T0], [{ tipo: "sem_internet" }, T0]]);
      expect(pausado.fase).toEqual({ tipo: "pausado_sem_internet", recebidos: 62, total: 100, retomaEm: T0 + 2_000 });
      expect(transicao(pausado, { tipo: "tick" }, T0 + 2_000).preparo.fase).toEqual({ tipo: "baixando", recebidos: 62, total: 100 });
      expect(transicao(pausado, { tipo: "tentar_agora" }, T0 + 1).preparo.fase).toEqual({ tipo: "baixando", recebidos: 62, total: 100 });
    });

    it("backoff isolado", () => {
      expect([0, 1, 2, 3, 6, 100].map(esperaDoBackoff)).toEqual([2_000, 2_000, 4_000, 8_000, 60_000, 60_000]);
    });
  });

  describe("sha256 ruim", () => {
    it("1ª vez: apaga a parte e baixa de novo", () => {
      const { trilha } = rodar([[iniciar(), T0], [{ tipo: "sha_ruim" }, T0]]);
      expect(trilha[1]).toEqual({ fase: "baixando", efeitos: [{ tipo: "apagar_parte" }, { tipo: "baixar" }] });
    });

    it("2ª vez seguida: falhou, com motivo; Tentar agora recomeça com a contagem zerada", () => {
      const { p, trilha } = rodar([[iniciar(), T0], [{ tipo: "sha_ruim" }, T0], [{ tipo: "sha_ruim" }, T0]]);
      expect(trilha[2]!.efeitos).toEqual([{ tipo: "apagar_parte" }]);
      expect(p.fase).toEqual({ tipo: "falhou", motivo: "o disco baixado não confere com o sha256 (2 vezes seguidas)" });
      const de_novo = rodar([[{ tipo: "tentar_agora" }, T0], [{ tipo: "sha_ruim" }, T0]], p);
      expect(de_novo.fases).toEqual(["baixando", "baixando"]);
    });
  });

  describe("memória", () => {
    it("pouca memória livre: espera, mede de novo a cada 30 s e liga quando sobra", () => {
      const { trilha, p } = rodar([[iniciar(), T0], [{ tipo: "baixou" }, T0], [{ tipo: "preparado" }, T0], [memoria(1.5), T0], [{ tipo: "tick" }, T0 + REMEDIR_MEMORIA_MS - 1], [{ tipo: "tick" }, T0 + REMEDIR_MEMORIA_MS], [memoria(3), T0 + REMEDIR_MEMORIA_MS]]);
      expect(trilha.slice(3).map((t) => t.fase)).toEqual(["esperando_memoria", "esperando_memoria", "ligando", "ligando"]);
      expect(trilha[3]!.efeitos).toEqual([{ tipo: "agendar", em: T0 + REMEDIR_MEMORIA_MS }]);
      expect(trilha[5]!.efeitos).toEqual([{ tipo: "medir_memoria" }]);
      expect(trilha[6]!.efeitos).toEqual([{ tipo: "ligar", memoriaGiB: 3 }]);
      expect(p.fase).toEqual({ tipo: "ligando", pediuLigar: true });
    });

    it.each(["pouco", "equilibrado"] as const)("%s com memória curta espera; Livre liga mesmo apertada", (modo) => {
      const passos: Array<[Evento, number]> = [[iniciar({ discoNoCache: true, memoriaGiB: 2, modo }), T0], [{ tipo: "preparado" }, T0], [memoria(1), T0]];
      expect(rodar(passos).p.fase.tipo).toBe("esperando_memoria");
      const livre = rodar([[iniciar({ discoNoCache: true, memoriaGiB: 2, modo: "livre" }), T0], [{ tipo: "preparado" }, T0], [memoria(1), T0]]);
      expect(livre.trilha[2]!.efeitos).toEqual([{ tipo: "ligar", memoriaGiB: 2 }]);
    });

    it("o uso muda para Livre esperando memória: mede de novo e liga com a memória do Livre", () => {
      const { trilha, p } = rodar([[iniciar({ discoNoCache: true }), T0], [{ tipo: "preparado" }, T0], [memoria(1), T0], [{ tipo: "uso", modo: "livre", memoriaGiB: 4 }, T0 + 1], [memoria(1), T0 + 1]]);
      expect(trilha[3]).toEqual({ fase: "ligando", efeitos: [{ tipo: "medir_memoria" }] });
      expect(trilha[4]!.efeitos).toEqual([{ tipo: "ligar", memoriaGiB: 4 }]);
      expect(p.modo).toBe("livre");
    });

    it("esperando memória, Tentar agora mede de novo na hora", () => {
      const { trilha } = rodar([[iniciar({ discoNoCache: true }), T0], [{ tipo: "preparado" }, T0], [memoria(1), T0], [{ tipo: "tentar_agora" }, T0 + 1]]);
      expect(trilha[3]).toEqual({ fase: "ligando", efeitos: [{ tipo: "medir_memoria" }] });
    });

    it("medida repetida depois de pedir para ligar não liga duas vezes", () => {
      const { trilha } = rodar([[iniciar({ discoNoCache: true }), T0], [{ tipo: "preparado" }, T0], [memoria(8), T0], [memoria(8), T0]]);
      expect(trilha[3]!.efeitos).toEqual([]);
    });

    it("Pouco 2, Equilibrado 3, Livre 4 GiB, com teto de 25% da RAM e piso no Pouco", () => {
      expect(memoriaDaVm("pouco", 16 * GIB)).toBe(2);
      expect(memoriaDaVm("equilibrado", 16 * GIB)).toBe(3);
      expect(memoriaDaVm("livre", 16 * GIB)).toBe(4);
      expect(memoriaDaVm("livre", 8 * GIB)).toBe(2);
      expect(memoriaDaVm("equilibrado", 8 * GIB)).toBe(2);
      expect(memoriaDaVm("livre", 12 * GIB)).toBe(3);
      // QA (Teodora): o teto arredonda para baixo; 25% de 10 GiB = 2,5 → 2, nunca 3.
      expect(memoriaDaVm("equilibrado", 10 * GIB)).toBe(2);
      expect(memoriaDaVm("livre", 64 * GIB)).toBe(4);
      expect([memoriaDaVm("pouco", 32 * GIB), memoriaDaVm("equilibrado", 32 * GIB), memoriaDaVm("livre", 32 * GIB)]).toEqual([2, 3, 4]);
    });
  });

  describe("sono", () => {
    const pronta = () => rodar([[iniciar({ discoNoCache: true }), T0], [{ tipo: "preparado" }, T0], [memoria(8), T0], [{ tipo: "ligou" }, T0]]).p;

    it("pronto → dormindo 15 min depois da última tela, desligando a VM", () => {
      const { fases, trilha } = rodar([[{ tipo: "tela_abriu" }, T0 + 1_000], [{ tipo: "tela_fechou" }, T0 + 5_000], [{ tipo: "tick" }, T0 + 5_000 + DORMIR_APOS_MS - 1], [{ tipo: "tick" }, T0 + 5_000 + DORMIR_APOS_MS]], pronta());
      expect(fases).toEqual(["pronto", "pronto", "pronto", "dormindo"]);
      expect(trilha[1]!.efeitos).toEqual([{ tipo: "agendar", em: T0 + 5_000 + DORMIR_APOS_MS }]);
      expect(trilha[3]!.efeitos).toEqual([{ tipo: "desligar" }]);
    });

    it("com tela aberta não dorme, por mais tempo que passe", () => {
      const { fases } = rodar([[{ tipo: "tela_abriu" }, T0], [{ tipo: "tick" }, T0 + 10 * DORMIR_APOS_MS]], pronta());
      expect(fases).toEqual(["pronto", "pronto"]);
    });

    it("tela que abre na VM pronta para o relógio do sono, sem agendar nada (QA)", () => {
      expect(transicao(pronta(), { tipo: "tela_abriu" }, T0 + 1)).toMatchObject({ preparo: { fase: { tipo: "pronto", semTelaDesde: null }, telas: 1 }, efeitos: [] });
    });

    it("tela_fechou repetido não deixa a contagem negativa: a próxima tela aberta segura o sono (QA)", () => {
      const { p, fases } = rodar([[{ tipo: "tela_fechou" }, T0], [{ tipo: "tela_fechou" }, T0], [{ tipo: "tela_abriu" }, T0 + 1], [{ tipo: "tick" }, T0 + 10 * DORMIR_APOS_MS]], pronta());
      expect(p.telas).toBe(1);
      expect(fases).toEqual(["pronto", "pronto", "pronto", "pronto"]);
    });

    it("falha que chega com a VM dormindo não vira falhou (QA)", () => {
      const dormindo = transicao(pronta(), { tipo: "tick" }, T0 + DORMIR_APOS_MS).preparo;
      expect(transicao(dormindo, { tipo: "falha", motivo: "limactl stop saiu 1" }, T0 + DORMIR_APOS_MS + 1)).toEqual({ preparo: dormindo, efeitos: [] });
    });

    it("duas telas: só conta a partir da última que fechou", () => {
      const { fases } = rodar([[{ tipo: "tela_abriu" }, T0], [{ tipo: "tela_abriu" }, T0], [{ tipo: "tela_fechou" }, T0 + 1], [{ tipo: "tick" }, T0 + 1 + DORMIR_APOS_MS], [{ tipo: "tela_fechou" }, T0 + 2 + DORMIR_APOS_MS], [{ tipo: "tick" }, T0 + 2 + 2 * DORMIR_APOS_MS]], pronta());
      expect(fases).toEqual(["pronto", "pronto", "pronto", "pronto", "pronto", "dormindo"]);
    });

    it("sem nenhuma tela desde que ligou, dorme 15 min depois de ligar", () => {
      expect(transicao(pronta(), { tipo: "tick" }, T0 + DORMIR_APOS_MS).preparo.fase.tipo).toBe("dormindo");
    });

    it("dormindo, a tela que abre acorda: mede a memória e liga de novo", () => {
      const dormindo = transicao(pronta(), { tipo: "tick" }, T0 + DORMIR_APOS_MS).preparo;
      const r = transicao(dormindo, { tipo: "tela_abriu" }, T0 + 2 * DORMIR_APOS_MS);
      expect(r).toMatchObject({ preparo: { fase: { tipo: "ligando" }, telas: 1 }, efeitos: [{ tipo: "medir_memoria" }] });
      const ligou = rodar([[memoria(8), T0], [{ tipo: "ligou" }, T0], [{ tipo: "tick" }, T0 + 99 * DORMIR_APOS_MS]], r.preparo);
      // Ligou com a tela aberta: não dorme.
      expect(ligou.fases).toEqual(["ligando", "pronto", "pronto"]);
    });

    it("a VM já respondeu (o fio religou sozinho): dormindo/ligando/esperando_memoria vão a pronto sem medir a memória (revisão 4 do PR #600)", () => {
      const dormindo = transicao(pronta(), { tipo: "tick" }, T0 + DORMIR_APOS_MS).preparo;
      const t = T0 + 2 * DORMIR_APOS_MS;
      // Revisão 9: o batimento em voo logo depois do desligar não a traz de volta a pronto.
      expect(transicao(dormindo, { tipo: "vm_respondeu" }, T0 + DORMIR_APOS_MS + DESLIGAR_LEVA_MS - 1)).toEqual({ preparo: dormindo, efeitos: [] });
      expect(transicao(dormindo, { tipo: "vm_respondeu" }, t)).toEqual({ preparo: { ...dormindo, fase: { tipo: "pronto", semTelaDesde: t } }, efeitos: [{ tipo: "agendar", em: t + DORMIR_APOS_MS }] });
      // Com a tela que chega no mesmo relato: pronto e sem sono.
      const comTela = rodar([[{ tipo: "vm_respondeu" }, t], [{ tipo: "tela_abriu" }, t], [{ tipo: "tick" }, t + 99 * DORMIR_APOS_MS]], dormindo);
      expect(comTela.fases).toEqual(["pronto", "pronto", "pronto"]);
      expect(comTela.trilha.flatMap((x) => x.efeitos.map((e) => e.tipo))).not.toContain("medir_memoria");
      // Presa em esperando_memoria pela RAM que a própria VM ocupa: o relato a destrava.
      const esperando = rodar([[{ tipo: "tela_abriu" }, t], [memoria(1), t]], dormindo);
      expect(esperando.fases).toEqual(["ligando", "esperando_memoria"]);
      expect(transicao(esperando.p, { tipo: "vm_respondeu" }, t).preparo.fase).toEqual({ tipo: "pronto", semTelaDesde: null });
      // Pronta já, nada muda (não reagenda o sono a cada relato).
      expect(transicao(pronta(), { tipo: "vm_respondeu" }, t)).toEqual({ preparo: pronta(), efeitos: [] });
      // Revisão 7: um comando com a VM pronta e sem tela recomeça o sono; o fio a religou e o tick não a derruba no boot.
      const semTela = rodar([[{ tipo: "tela_abriu" }, T0], [{ tipo: "tela_fechou" }, T0]], pronta()).p;
      const t2 = T0 + DORMIR_APOS_MS - 1_000;
      // Revisão 9: com o sono já marcado, o comando só empurra o relógio (sem timer novo); o tick que vence antes remarca.
      expect(transicao(semTela, { tipo: "atividade" }, t2)).toEqual({ preparo: { ...semTela, fase: { tipo: "pronto", semTelaDesde: t2 } }, efeitos: [] });
      const empurrado = rodar([[{ tipo: "atividade" }, t2], [{ tipo: "tick" }, T0 + DORMIR_APOS_MS]], semTela);
      expect(empurrado.fases).toEqual(["pronto", "pronto"]);
      expect(empurrado.trilha.at(-1)?.efeitos).toEqual([{ tipo: "agendar", em: t2 + DORMIR_APOS_MS }]);
      expect(transicao(empurrado.p, { tipo: "tick" }, t2 + DORMIR_APOS_MS).preparo.fase.tipo).toBe("dormindo");
      // Com tela aberta ou fora de pronto, nada.
      const comTela1 = rodar([[{ tipo: "tela_abriu" }, T0]], pronta()).p;
      expect(transicao(comTela1, { tipo: "atividade" }, t2)).toEqual({ preparo: comTela1, efeitos: [] });
      expect(transicao(dormindo, { tipo: "atividade" }, t2)).toEqual({ preparo: dormindo, efeitos: [] });
      // Antes do disco (baixando/preparando/falhou), o relato não pula etapas.
      const baixando = transicao(preparoInicial(), iniciar(), T0).preparo;
      expect(transicao(baixando, { tipo: "vm_respondeu" }, t).preparo.fase.tipo).toBe("baixando");
    });
  });

  it("falha em qualquer etapa vai para falhou com o motivo; Tentar agora recomeça pelo download se o disco não chegou", () => {
    const { p } = rodar([[iniciar(), T0], [{ tipo: "falha", motivo: "disco cheio" }, T0]]);
    expect(p.fase).toEqual({ tipo: "falhou", motivo: "disco cheio" });
    expect(transicao(p, { tipo: "tentar_agora" }, T0).efeitos).toEqual([{ tipo: "baixar" }]);
  });

  it.each([
    ["no cache desde o início", [[iniciar({ discoNoCache: true }), T0]]],
    ["baixado agora", [[iniciar(), T0], [{ tipo: "baixou" }, T0]]],
  ] as Array<[string, Array<[Evento, number]>]>)("disco %s: falha ao ligar e Tentar agora prepara de novo, sem baixar", (_nome, antes) => {
    const { p } = rodar([...antes, [{ tipo: "falha", motivo: "limactl: vz não suportado" }, T0]]);
    expect(p.fase).toEqual({ tipo: "falhou", motivo: "limactl: vz não suportado" });
    expect(transicao(p, { tipo: "tentar_agora" }, T0)).toMatchObject({ preparo: { fase: { tipo: "preparando" } }, efeitos: [{ tipo: "preparar" }] });
  });

  it("sha ruim duas vezes: o disco não está no cache, Tentar agora baixa", () => {
    const { p } = rodar([[iniciar(), T0], [{ tipo: "sha_ruim" }, T0], [{ tipo: "sha_ruim" }, T0]]);
    expect(transicao(p, { tipo: "tentar_agora" }, T0).efeitos).toEqual([{ tipo: "baixar" }]);
  });

  it("evento fora de hora não muda nada (o tick pode chegar a qualquer momento)", () => {
    const p = rodar([[iniciar(), T0]]).p;
    for (const e of [{ tipo: "ligou" }, { tipo: "preparado" }, memoria(1), { tipo: "tick" }] as Evento[]) {
      expect(transicao(p, e, T0 + 1e9)).toEqual({ preparo: p, efeitos: [] });
    }
  });
});
