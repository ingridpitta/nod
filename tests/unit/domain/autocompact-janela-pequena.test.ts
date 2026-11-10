import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { parteFixa, SAIDA_BASH_PADRAO_CHARS, tokensDeChars } from "../../../src/domain/orcamento-contexto.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { simularAutocompact } from "../../helpers/simulador-autocompact.ts";

/**
 * NOD-480 (emenda da ADR-040) — regressão: o turno de um bot com todos os apps (como o Atlas da Helena, 09/11) num modelo
 * de 200k caía em `autocompact_thrashing`: depois de cada resumo voltavam ~122k (#718), o limiar fica em ~144k e uma ou
 * duas saídas de ferramenta enchiam o resto. O plano de antes não dependia da janela (é o mesmo que sai hoje num modelo de
 * 1M); o de agora leva o catálogo enxuto e o teto de saída proporcional. O simulador reproduz o disjuntor do 2.1.309.
 */
const agora = 1_000_000;
// O "O que você faz" e o diretório de colegas de um bot de verdade (o prompt do nod do Atlas tinha ~15,9 mil tokens).
const descricao = Array.from({ length: 520 }, (_, i) => `Regra ${i + 1}: confira a fonte, registre o que fez, peça aprovação antes de mexer em algo de fora e responda curto em português do Brasil.`).join(" ");
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Atlas", titulo: "Assistente", descricao, dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "haiku", duplicadoDe: null, criadoEm: 0 };
const colegas = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, nome: `Colega ${i}`, titulo: "Especialista", descricao: "Cuida de uma frente do time: levanta o que precisa, prepara, revisa e devolve com uma recomendação clara e curta." }));
const turno: Turno = { executor: "local", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "resuma o canal", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "haiku", criadoEm: agora, mensagemOrigemId: "m0" };
// 866 capacidades em 10 apps, como no Raio-X do Atlas; nenhuma concedida (vão todas em `outras_do_app`).
const apps = ["slack", "gmail", "googlecalendar", "clickup", "supabase", "googledrive", "notion", "linear", "github", "sentry"];
const conectores: Conector[] = apps.map((slug, a) => ({ tenantId: "t", id: `k${a}`, ownerId: "p", visibility: "privado", nome: slug, slug, transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true,
  catalogo: Array.from({ length: a < 6 ? 87 : 86 }, (_, i) => ({ nome: `${slug.toUpperCase()}_CAPACIDADE_DO_APP_${i}`, descricao: "x", schema: { type: "object" }, readOnlyHint: true })), sondadoEm: agora, ultimaFalha: null, criadoEm: 0 }));
const atlas: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores, colegas, modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.309", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Helena", harness: "claude-cli", agora };

const medida = (p: Pick<PlanoTurno, "promptSistema" | "promptSistemaPartes" | "catalogo">) => ({ promptChars: (p.promptSistemaPartes?.estavel ?? p.promptSistema).length, ferramentas: p.catalogo.ferramentas.length });
/** Um turno longo: 40 voltas, cada uma com uma saída grande (histórico do Slack, diff de PR) cortada pelo teto do turno. */
const SAIDA_BRUTA_CHARS = 90_000;
const saidas = (tetoChars: number) => Array.from({ length: 40 }, () => tokensDeChars(Math.min(SAIDA_BRUTA_CHARS, tetoChars)));
const tetoDe = (p: ReturnType<typeof montarPlano>) => Math.min(p.politicaExecucao.orcamentoResultadoChars, p.orcamento?.saidaBashChars ?? SAIDA_BASH_PADRAO_CHARS * 10);

describe("NOD-480: autocompact em janela pequena", () => {
  // O plano de antes da NOD-480 não variava com a janela: é o que sai hoje para o mesmo bot num modelo de 1M.
  const antes = montarPlano({ ...atlas, janelaObservada: 1_000_000 });
  const depois = montarPlano(atlas);

  it("a parte fixa do bot com todos os apps fica perto do medido no #718 (~122k)", () => {
    expect(parteFixa(medida(antes))).toBeGreaterThan(115_000);
    expect(parteFixa(medida(antes))).toBeLessThan(135_000);
  });

  it("sem as defesas, numa janela de 200k o turno longo dispara o disjuntor (autocompact_thrashing)", () => {
    const s = simularAutocompact({ janela: 200_000, parteFixa: parteFixa(medida(antes)), saidas: saidas(tetoDe(antes)) });
    expect(s.thrashing).toBe(true);
    expect(s.compactacoes).toBe(3);
  });

  it("com o catálogo enxuto e o teto proporcional, o mesmo turno compacta sem laço até o fim", () => {
    expect(depois.orcamento?.enxuto).toBe(true);
    expect(parteFixa(medida(depois))).toBeLessThan(parteFixa(medida(antes)));
    const s = simularAutocompact({ janela: 200_000, parteFixa: parteFixa(medida(depois)), saidas: saidas(tetoDe(depois)) });
    expect(s.thrashing).toBe(false);
    expect(s.voltas).toBe(40);
  });

  it("qualquer janela pequena ou média (250k, 400k): com as defesas não há laço", () => {
    for (const janela of [250_000, 400_000]) {
      const p = montarPlano({ ...atlas, janelaObservada: janela });
      expect(simularAutocompact({ janela, parteFixa: parteFixa(medida(p)), saidas: saidas(tetoDe(p)) }).thrashing, String(janela)).toBe(false);
    }
  });

  it("1M: o plano é o de antes e não há laço", () => {
    const opus = montarPlano({ ...atlas, turno: { ...turno, modelo: "opus" } });
    expect(opus.promptSistema).toBe(antes.promptSistema);
    expect(opus.politicaExecucao).toEqual(antes.politicaExecucao);
    expect(simularAutocompact({ janela: 1_000_000, parteFixa: parteFixa(medida(opus)), saidas: saidas(tetoDe(opus)) }).thrashing).toBe(false);
  });
});
