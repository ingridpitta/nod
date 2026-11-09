import { ESFORCOS_AGENTE, type EsforcoAgente } from "../contracts/agente.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { LigacaoVozPlano } from "../contracts/plano-turno.ts";
import { MODELOS_LIGACAO_PADRAO, type ConfigModeloLigacaoClaude, type ModelosLigacao } from "../contracts/modelos.ts";

/**
 * NOD-164 (emenda à ADR-072): o modelo da ligação vem da configuração do SERVIDOR, uma linha por harness:
 *
 *   NOD_MODELO_LIGACAO_CLAUDE="<modelo> [esforco=<nível>] [pensamento=adaptativo|desligado]"
 *   NOD_MODELO_LIGACAO_CODEX="<modelo>"
 *
 * Ausente, vazia ou só espaços vale o padrão (o `deploy.sh` grava `${VAR:-}`). As opções vão separadas por espaço,
 * não por `:`/`@` (que os ids do Bedrock e do Vertex usam); esses ids, porém, não passam no `FORMATO_MODELO` e não
 * são aceitos hoje. A validação é só de formato; um id bem formado e inexistente falha na
 * primeira ligação. Valor inválido lança Error em pt-BR com o nome da variável — o boot não sobe.
 */
export const VAR_MODELO_LIGACAO_CLAUDE = "NOD_MODELO_LIGACAO_CLAUDE";
export const VAR_MODELO_LIGACAO_CODEX = "NOD_MODELO_LIGACAO_CODEX";

const FORMATO_MODELO = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const PENSAMENTO = { adaptativo: true, desligado: false } as const;

function erro(variavel: string, motivo: string): Error {
  return new Error(`${variavel} inválida: ${motivo}`);
}

function tokens(variavel: string, valor: string | undefined): string[] | null {
  const limpo = (valor ?? "").trim();
  if (limpo === "") return null;
  const partes = limpo.split(/\s+/);
  const modelo = partes[0]!;
  if (!FORMATO_MODELO.test(modelo)) throw erro(variavel, `"${modelo}" não é um id de modelo (use minúsculas, dígitos, "." e "-", até 80 caracteres)`);
  return partes;
}

function lerClaude(valor: string | undefined): ConfigModeloLigacaoClaude {
  const v = VAR_MODELO_LIGACAO_CLAUDE;
  const partes = tokens(v, valor);
  if (!partes) return MODELOS_LIGACAO_PADRAO["claude-cli"];
  const [modelo, ...opcoes] = partes as [string, ...string[]];
  let esforco: EsforcoAgente | undefined;
  let pensamento: boolean | undefined;
  const vistas = new Set<string>();
  for (const op of opcoes) {
    const i = op.indexOf("=");
    const chave = i > 0 ? op.slice(0, i) : op;
    const val = i > 0 ? op.slice(i + 1) : "";
    if (vistas.has(chave)) throw erro(v, `a opção "${chave}" aparece mais de uma vez`);
    vistas.add(chave);
    if (chave === "esforco") {
      const e = ESFORCOS_AGENTE.find((x) => x === val);
      if (!e) throw erro(v, `esforco="${val}" não existe (use ${ESFORCOS_AGENTE.join(", ")})`);
      esforco = e;
    } else if (chave === "pensamento") {
      if (val !== "adaptativo" && val !== "desligado") throw erro(v, `pensamento="${val}" não existe (use adaptativo ou desligado)`);
      pensamento = PENSAMENTO[val];
    } else {
      throw erro(v, `opção desconhecida "${op}" (aceitas: esforco=<nível>, pensamento=adaptativo|desligado)`);
    }
  }
  return { modelo, ...(esforco ? { esforco } : {}), pensamentoAdaptativo: pensamento ?? false };
}

function lerCodex(valor: string | undefined): { modelo: string } {
  const v = VAR_MODELO_LIGACAO_CODEX;
  const partes = tokens(v, valor);
  if (!partes) return MODELOS_LIGACAO_PADRAO["codex-cli"];
  // O esforço do Codex na ligação já é fixo (low, ADR-076): opção aqui é erro, não algo ignorado em silêncio.
  if (partes.length > 1) throw erro(v, `o Codex aceita só o modelo, sem opções (veio "${partes.slice(1).join(" ")}")`);
  return { modelo: partes[0]! };
}

/** Puro: lê e valida as duas variáveis. Lança Error em pt-BR no primeiro valor inválido. */
export function lerModelosLigacao(env: Readonly<Record<string, string | undefined>>): ModelosLigacao {
  return { "claude-cli": lerClaude(env[VAR_MODELO_LIGACAO_CLAUDE]), "codex-cli": lerCodex(env[VAR_MODELO_LIGACAO_CODEX]) };
}

/**
 * O modelo de voz do plano da ligação, pelo harness e pela configuração. Decisão do Marlon (2026-10-05, NOD-164): vale
 * para TODA ligação, inclusive a da guia do onboarding no "auto" — ela fala no mesmo modelo de voz das outras, não mais
 * no mais potente (`fable`/`gpt-6-astra`), que segue só no chat dela. O Codex leva só o modelo.
 */
export function modeloDeVoz(harness: IdHarness, modelos: ModelosLigacao): Pick<LigacaoVozPlano, "modelo" | "esforco" | "pensamentoAdaptativo"> {
  if (harness === "codex-cli") return { modelo: modelos["codex-cli"].modelo };
  const cfg = modelos["claude-cli"];
  return { modelo: cfg.modelo, pensamentoAdaptativo: cfg.pensamentoAdaptativo, ...(cfg.esforco ? { esforco: cfg.esforco } : {}) };
}
