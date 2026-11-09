import type { DefinicaoAcao, Onda } from "../../contracts/acoes.ts";
import { NOME_DA_ONDA, ONDAS } from "../../contracts/acoes.ts";

/**
 * A catraca de paridade tela × chat (definida em 2026-10-28, NOD-391, ADR-135 §5), pura: recebe as rotas do app composto
 * (só o que importa delas) e o registro, e devolve o que está errado. O teste de conformidade
 * (tests/conformidade/paridade.test.ts) a roda sobre o app real; o `npm run paridade` gera o docs/paridade.md com ela.
 */

/** O que a catraca enxerga de uma rota. `pessoa` = escopada em /api/t, sem `interno`, `maquina` ou `publica`. */
export type RotaNaCatraca = { metodo: string; padrao: string; pessoa: boolean; acao?: string };

export type PisoDeParidade = { vivo: number };

const chave = (r: RotaNaCatraca) => `${r.metodo} ${r.padrao}`;

/** As rotas de pessoa que mudam algo (tudo que não é GET). */
export function rotasQueMudam(rotas: readonly RotaNaCatraca[]): RotaNaCatraca[] {
  const vistas = new Map<string, RotaNaCatraca>();
  for (const r of rotas) if (r.pessoa && r.metodo !== "GET") vistas.set(chave(r), r);
  return [...vistas.values()].sort((a, b) => chave(a).localeCompare(chave(b)));
}

/** Quantas ações estão em cada estado no chat. */
export function contarEstados(registro: readonly DefinicaoAcao[]): Record<DefinicaoAcao["chat"]["estado"], number> {
  const n = { vivo: 0, parcial: 0, falta: 0, nunca: 0 };
  for (const a of registro) n[a.chat.estado]++;
  return n;
}

/**
 * Os problemas da paridade; vazio = a catraca passa.
 * A: toda rota de pessoa que muda algo declara um id, e o id está no registro.
 * B: toda ação é usada por ao menos uma rota de pessoa (salvo `semRotaDePessoa`); quem não tem caminho no chat diz a
 *    onda (`falta`) ou o motivo (`nunca`) — o tipo de `EstadoNoChat` já obriga; o validarRegistro confere o conteúdo.
 * C: o número de ações vivas nunca cai abaixo do piso (subir o piso é parte do PR que liga mais uma).
 */
export function verificarParidade(rotas: readonly RotaNaCatraca[], registro: readonly DefinicaoAcao[], piso: PisoDeParidade): string[] {
  const problemas: string[] = [];
  const ids = new Set(registro.map((a) => a.id));
  const usados = new Set<string>();
  // Cada rota, sem deduplicar: a mesma rota montada nos dois modos do app é conferida nas duas cópias (revisão do #563).
  const declarada = new Map<string, string | undefined>();
  for (const r of rotas) {
    if (!r.pessoa || r.metodo === "GET") continue;
    if (declarada.has(chave(r)) && declarada.get(chave(r)) !== r.acao) problemas.push(`A: ${chave(r)} declara ações diferentes nos modos do app (${declarada.get(chave(r)) ?? "nenhuma"} × ${r.acao ?? "nenhuma"})`);
    declarada.set(chave(r), r.acao);
    if (!r.acao) problemas.push(`A: ${chave(r)} não declara a ação (Rota.acao) — registre-a em src/domain/acoes/`);
    else if (!ids.has(r.acao)) problemas.push(`A: ${chave(r)} declara ${r.acao}, que não está no registro`);
    else usados.add(r.acao);
  }
  for (const a of registro) {
    if (!usados.has(a.id) && !a.semRotaDePessoa) problemas.push(`B: ${a.id} não é usada por nenhuma rota de pessoa (sem semRotaDePessoa)`);
  }
  const vivas = contarEstados(registro).vivo;
  if (vivas < piso.vivo) problemas.push(`C: ${vivas} ações vivas no chat, abaixo do piso de ${piso.vivo} (docs/paridade.piso.json)`);
  return [...new Set(problemas)];
}

/**
 * C, o outro lado: o piso só sobe. Compara o piso do PR com o da main (`null` = a main ainda não tem o arquivo). Sem
 * isso, baixar o piso e rebaixar uma viva no mesmo PR passaria verde (QA do #563).
 */
export function verificarPisoSobe(piso: PisoDeParidade, daMain: PisoDeParidade | null): string[] {
  if (daMain && piso.vivo < daMain.vivo) return [`C: o piso de vivas caiu de ${daMain.vivo} (main) para ${piso.vivo}; ele só sobe (docs/paridade.piso.json)`];
  return [];
}

/**
 * A base com que a catraca C compara o piso: a do PRÓPRIO commit, não a main de agora. Comparar com a origin/main fazia
 * o rerun de um commit antigo da main cair quando a main já tinha subido o piso (run 41540469246, @3162df76). No CI o
 * checkout é o merge do PR (pai 1 = a main que o PR recebe) ou o push da main (pai 1 = o commit de antes): `HEAD^1`.
 * Fora do CI, o merge-base com a origin/main (null sem ela).
 */
export function baseDoPiso(o: { ci: boolean; mergeBase: () => string | null }): string | null {
  return o.ci ? "HEAD^1" : o.mergeBase();
}

function rotulo(a: DefinicaoAcao): string {
  const c = a.chat;
  switch (c.estado) {
    case "vivo":
      return `vivo (\`${c.via.ferramenta}${c.via.tipoNoLote ? ` ${c.via.tipoNoLote}` : ""}\`)`;
    case "parcial":
      return `parcial (\`${c.via.ferramenta}${c.via.tipoNoLote ? ` ${c.via.tipoNoLote}` : ""}\`): ${c.falta}`;
    case "falta":
      return `falta (${c.onda})`;
    case "nunca":
      return `nunca: ${c.motivo}`;
  }
}

const celula = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** O docs/paridade.md, gerado (nunca editado à mão): o placar, cada domínio e o que cada onda leva. Determinístico. */
export function gerarParidadeMd(registro: readonly DefinicaoAcao[], rotas: readonly RotaNaCatraca[], piso: PisoDeParidade): string {
  const n = contarEstados(registro);
  const porAcao = new Map<string, string[]>();
  for (const r of rotasQueMudam(rotas)) if (r.acao) porAcao.set(r.acao, [...(porAcao.get(r.acao) ?? []), chave(r)]);
  const linhas: string[] = [
    "# Paridade tela × chat",
    "",
    "<!-- Gerado por `npm run paridade` a partir de src/domain/acoes/ (NOD-391, ADR-135). Não edite à mão: a catraca (tests/conformidade/paridade.test.ts) compara. -->",
    "",
    // NOD-398: o registro também tem ação só de leitura (tela.capturar, exceção da ADR-135); ela não conta como "muda algo".
    `Ações de pessoa que mudam algo: **${registro.filter((d) => d.risco !== "leitura").length}**${registro.some((d) => d.risco === "leitura") ? `, mais ${registro.filter((d) => d.risco === "leitura").length} só de leitura` : ""}. No chat: **${n.vivo} vivas**, ${n.parcial} parciais, ${n.falta} faltando e ${n.nunca} que nunca vão para o chat. Piso de vivas: ${piso.vivo}.`,
    "",
    "Estados: **vivo** = o chat faz pelo mesmo executor da tela, com teste de contrato; **parcial** = o chat faz, mas diverge ou falta parâmetro; **falta** = a onda dona ainda vai ligar; **nunca** = exceção escrita.",
    "",
  ];
  const dominios = [...new Set(registro.map((a) => a.id.split(".")[0] ?? ""))];
  for (const d of dominios) {
    linhas.push(`## ${d}`, "", "| Ação | O que faz | Risco | No chat | Rotas |", "| --- | --- | --- | --- | --- |");
    for (const a of registro.filter((x) => x.id.split(".")[0] === d)) {
      const rs = porAcao.get(a.id) ?? [];
      const onde = rs.length ? rs.map((r) => `\`${r}\``).join("<br>") : (a.semRotaDePessoa ?? "—");
      linhas.push(`| \`${a.id}\` | ${celula(a.titulo)} | ${a.risco} | ${celula(rotulo(a))} | ${celula(onde)} |`);
    }
    linhas.push("");
  }
  linhas.push("## O que cada onda leva", "");
  for (const onda of ONDAS as readonly Onda[]) {
    const ids = registro.filter((a) => a.chat.estado === "falta" && a.chat.onda === onda).map((a) => `\`${a.id}\``);
    linhas.push(`- **${onda}** (${NOME_DA_ONDA[onda]}): ${ids.length ? ids.join(", ") : "nada"}`);
  }
  linhas.push("");
  return linhas.join("\n");
}
