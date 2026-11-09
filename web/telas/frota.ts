import type { IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { desatualizado, ehIa, fraseDesatualizado, versaoLegivel } from "./ia-fora.ts";

/** Inventário ESCRITO (ADR-019/029): estado, versão, motivo e relógio — nunca só um ícone. */
export function textoInventario(inv: Inventario | null, agora: number): string {
  if (!inv) return "inventário ainda não sondado";
  if (inv.estado === "pronto") return `${inv.versao === "catcher" ? "catcher (sem custo)" : `harness ${inv.versao}`} pronto desde ${hora(inv.em)}`;
  if (inv.estado === "nao_autenticado") return `harness${inv.versao ? ` ${inv.versao}` : ""} não autenticado (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
  if (inv.causa === "sonda_lenta") return `harness lento (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
  const antigo = desatualizado(inv);
  if (antigo) return `harness ${antigo.versao} desatualizado (o nod precisa da ${versaoLegivel(antigo.minima)} ou mais nova) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
  return `harness ausente (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
}

export function rotuloExecutor(id: IdExecutor): string {
  return id === "catcher" ? "Simulação (sem custo)" : id === "codex-cli" ? "Codex" : "Claude Code";
}

/** Uma linha por opção do interruptor: o que a sonda disse, escrito (ADR-029) — "pronto" ou o motivo de não estar. */
function estadoDaOpcao(inv: Inventario): string {
  if (inv.estado === "pronto") return `pronto${inv.versao === "catcher" ? "" : ` (${inv.versao})`}`;
  return `${inv.causa === "sonda_lenta" ? "demorou para responder" : inv.estado === "nao_autenticado" ? "não autenticado" : inv.causa === "cli_antigo" ? "desatualizado" : inv.causa === "atualizando" ? "atualizando" : "ausente"} — ${inv.motivo}`;
}

/**
 * A faixa curta do motor fora (rodapé, menu da conta, Conexão). NOD-178: o CLI que só demorou não é "não foi encontrada"
 * nem "não está conectada" — a causa vem antes do estado. NOD-171: o CLI abaixo do piso diz a versão e a mínima
 * ("Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova."); sem saber qual IA, "Sua IA está
 * desatualizada".
 */
export function situacaoMotorFora(inv: Exclude<Inventario, { estado: "pronto" }>, ia?: IdExecutor | null): string {
  if (inv.causa === "sonda_lenta") return "Sua IA está demorando para responder";
  const antigo = desatualizado(inv);
  if (antigo) return ehIa(ia) ? fraseDesatualizado(ia, antigo) : "Sua IA está desatualizada";
  return inv.estado === "nao_autenticado" ? "Sua IA não está conectada" : "Sua IA não foi encontrada";
}

/**
 * Interruptor de executor (definido em 2026-09-16): a máquina roda OU o catcher (sem CLI, sem custo) OU o
 * Claude real (assinatura da pessoa). Um botão por opção que não está em uso; a troca para o Claude sonda o
 * CLI na hora e só acontece se a sonda disser 'pronto' — a recusa vem escrita, nunca um botão que "não faz nada".
 * NOD-160: a opção em uso que não está pronta (ex.: NOD_EXECUTOR desconhecido) também tem botão — escolhê-la de novo a liga.
 * revisto em 2026-10-10 (teste do Breno): no servidor compartilhado não há interruptor (`trocavel: false`) — o botão
 * "usar Codex" chamava uma rota que lá não existe. Sem botões: a IA de cada bot é escolhida na Inteligência dele.
 */
export function renderExecutor(estado: Estado): string {
  const ex = estado.executor;
  if (!ex) return `<div class="ex-linha"><b>Executor:</b> ainda não consultado</div>`;
  const botoes = ex.trocavel === false ? "" : ex.opcoes
    .filter((o) => o.id !== ex.atual || o.inventario.estado !== "pronto")
    .map((o) => botao("trocar-executor", `${o.id === ex.atual ? "ligar" : "usar"} ${esc(rotuloExecutor(o.id))}`, { classe: "sm", dados: { id: o.id }, desabilitado: estado.ocupado, titulo: o.custo === "real" ? "Verifica a conexão com sua conta" : "sem custo" }))
    .join(" ");
  const linhas = ex.opcoes.map((o) => `<span>${esc(rotuloExecutor(o.id))}: ${esc(estadoDaOpcao(o.inventario))}</span>`).join(" · ");
  return `<details class="conexao-avancada"><summary>Configurar conexão</summary><div class="ex-linha"><b>Harness padrão:</b> ${esc(rotuloExecutor(ex.atual))} ${botoes}</div>
    <div class="ex-mudo">${linhas}</div>
    ${ex.recusa ? `<div class="ex-recusa">não troquei: ${esc(ex.recusa)}</div>` : ""}</details>`;
}

/** NOD-171: a IA em uso está abaixo do piso? O botão da faixa diz "Atualizar", não "Conectar". */
export function motorDesatualizado(estado: Estado): boolean {
  return desatualizado(inventarioEmUso(estado)) !== null;
}

/** A sonda do executor EM USO: o inventário da frota prefere o claude-cli mesmo com o catcher ligado, e mentiria na tela. */
export function inventarioEmUso(estado: Estado): Inventario | null {
  return estado.executor?.opcoes.find((o) => o.id === estado.executor?.atual)?.inventario ?? estado.inventario;
}

export function renderInventario(estado: Estado): string {
  const inv = inventarioEmUso(estado);
  const classe = inv?.estado === "pronto" ? "ok" : "falha";
  return `<div class="inventario inv-${classe}" role="status">
    <div class="inv-linha">${esc(textoInventario(inv, estado.agora))} ${botao("sondar-inventario", "sondar de novo", { classe: "sm", titulo: "Verifica a conexão com sua conta" })}</div>
    ${renderExecutor(estado)}
  </div>`;
}

