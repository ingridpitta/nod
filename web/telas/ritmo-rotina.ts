import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { OpcaoRitmo, PayloadRotinaRitmo } from "../../src/contracts/rotina-ritmo.ts";
import { esc } from "../lib/render.ts";

/**
 * definido em 2026-10-23 (NOD-313): o card que sugere espaçar ou pausar a rotina que rodou 20 vezes seguidas sem
 * novidade. Discreto, com cara de mensagem: borda fina, sem fundo colorido, as opções em pílulas vazadas. Depois do clique
 * ele vira UMA linha ("✓ … · desfazer"). Nada muda sem o clique — o card só sugere.
 */
export function cartaoRitmoRotina(m: Mensagem): string | null {
  const p = m.payload;
  if (p?.kind !== "rotina_ritmo") return null;
  if (p.invalida) return linha(esc(m.texto));
  if (p.decisao) {
    const desfazer = p.decisao.desfazivel ? ` · <button type="button" class="linha-link" data-act="ritmo-rotina" data-opcao="desfazer"${dados(m, p)}>desfazer</button>` : "";
    return linha(`${esc(fraseResolvida(p, p.decisao.opcao))}${desfazer}`);
  }
  const opcoes: string[] = [];
  if (p.espacar) opcoes.push(pilula(m, p, "espacar", `Espaçar para ${p.espacar.rotulo.replace(/^a cada /, "cada ")}`));
  if (p.uteis) opcoes.push(pilula(m, p, "uteis", "Só dias úteis 8h–19h"));
  opcoes.push(pilula(m, p, "pausar", "Pausar"), pilula(m, p, "deixar", "Deixar como está"));
  return `<div class="ritmo-card" role="group" aria-label="Sugestão para a rotina ${esc(p.nome)}"><p class="ritmo-tit">A rotina <b>${esc(p.nome)}</b> rodou ${p.seguidas} vezes seguidas sem novidade</p><p class="ritmo-sub">Hoje: ${esc(p.hoje)}. Quer ajustar?</p><div class="ritmo-opcoes">${opcoes.join("")}</div></div>`;
}

/** A linha curta do card resolvido (o texto completo, com "sugerido pelo nod", fica no histórico da mensagem). */
export function fraseResolvida(p: PayloadRotinaRitmo, opcao: OpcaoRitmo): string {
  const nome = `“${p.nome}”`;
  if (opcao === "espacar") return `✓ ${nome} espaçada para ${p.espacar?.rotulo.replace(/^a cada /, "cada ") ?? "um intervalo maior"}`;
  if (opcao === "uteis") return `✓ ${nome} agora roda só em dias úteis, 8h–19h`;
  if (opcao === "pausar") return `✓ ${nome} pausada`;
  return `✓ ${nome} segue como está · não pergunto de novo por 30 dias`;
}

const dados = (m: Mensagem, p: PayloadRotinaRitmo) => ` data-rotina="${esc(p.rotinaId)}" data-mensagem="${esc(m.id)}" data-conversa="${esc(m.conversaId)}"`;

const pilula = (m: Mensagem, p: PayloadRotinaRitmo, opcao: OpcaoRitmo, rotulo: string) =>
  `<button type="button" class="ritmo-pilula" data-act="ritmo-rotina" data-opcao="${opcao}"${dados(m, p)}>${esc(rotulo)}</button>`;

const linha = (html: string) => `<div class="linha-centro-wrap ritmo-feito"><span class="linha-centro estatica"><span>${html}</span></span></div>`;
