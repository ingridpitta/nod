import type { Computadores } from "../../fundo/computadores.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { ehFalhaComputador } from "../../../domain/computador.ts";
import { OPERACOES_DA_PESSOA, type OperacaoDaPessoa } from "../../../contracts/computador-motor.ts";
import { ORIGENS_CONTROLE, type OrigemControle } from "../../../contracts/computador.ts";

/** NOD-365: a recusa da troca com a origem sem contato; a tela troca "A máquina de agora" pelo nome que vem em `maquina`. */
export const MENSAGEM_ORIGEM_SEM_CONTATO = "A máquina de agora está sem contato. Ligue-a para levar os logins.";

/**
 * NOD-407 (definido em 2026-10-29, 1º ensaio no Mac): o 409 das rotas do computador diz a causa real, em vez do
 * "Atualize a página" genérico, que mandava a pessoa fazer o que não resolvia nada. Só estas causas saem no corpo,
 * como `motivo` (lista branca, como a da Minha conta); qualquer outra fica só no log. Frases fixas, sem dado da pessoa.
 */
export const MOTIVOS_DO_COMPUTADOR: Readonly<Record<string, string>> = {
  esperando_tela: "O computador ainda está ligando. Tente de novo em instantes.",
  ligando: "O computador ainda está ligando. Tente de novo em instantes.",
  maquina_sem_contato: "A máquina onde o computador mora não está respondendo.",
  nao_ficou_pronto: "O computador não ficou pronto a tempo. Tente de novo.",
  nao_iniciou: "O computador não conseguiu ligar.",
  acao_falhou: "A máquina do computador recusou o pedido. Tente de novo.",
  sem_resposta: "A máquina do computador não respondeu. Tente de novo.",
  atualizando: "O computador está sendo atualizado. Espere terminar.",
  fora_do_ar: "O computador está fora do ar. Tente de novo para religar.",
  ocupado: "Uma ação anterior ainda está terminando. Tente de novo em instantes.",
  app_desatualizado: "Atualize o app do nod para usar o computador.",
  // NOD-407: recusa sem causa conhecida (ex.: computador desligado pela pessoa). Não é transitória: a web não repete.
  indisponivel: "O computador não pode fazer isso agora.",
};

/** O 409 `estado_invalido` do computador com a causa: a frase da tabela e o `motivo`; sem causa, `indisponivel` (não repete). */
function responderCausa(ctx: { json(status: number, corpo: unknown): void }, e: unknown): boolean {
  if (!(e instanceof ErroDeDominio) || e.codigo !== "estado_invalido") return false;
  const bruta = typeof e.cause === "string" ? e.cause : "indisponivel";
  const motivo = bruta === "computador fora do ar" ? "fora_do_ar" : bruta;
  // Causa fora da lista (sem_suporte, faltam_pacotes…): vira `indisponivel`, nunca o "Atualize a página" genérico.
  const conhecido = Object.hasOwn(MOTIVOS_DO_COMPUTADOR, motivo);
  const final = conhecido ? motivo : "indisponivel";
  ctx.json(409, { codigo: "estado_invalido", mensagem: MOTIVOS_DO_COMPUTADOR[final], motivo: final });
  return true;
}

export function rotasComputadores(computadores: Computadores): Rota[] {
  return [
    // NOD-96 PR 5: o computador da pessoa (NOD_COMPUTADORES=motor); com a flag desligada, 404.
    { metodo: "GET", padrao: /^\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultarDaPessoa(ctx.escopo)); } },
    { metodo: "POST", acao: "computador.operar", padrao: /^\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string" || !(OPERACOES_DA_PESSOA as readonly string[]).includes(corpo.operacao)) throw new ErroDeDominio("entrada_invalida");
      // Atualizar, Redefinir e Sair de todos seguem em segundo plano; o progresso vem pelo GET.
      try {
        await computadores.operarDaPessoa(ctx.escopo, corpo.operacao as OperacaoDaPessoa);
      } catch (e) {
        if (responderCausa(ctx, e)) return;
        throw e;
      }
      ctx.json(200, { ok: true });
    } },
    // NOD-365: onde o computador mora. `semLogins` troca sem levar os logins (a origem sem contato); a troca segue em
    // segundo plano e o progresso vem pelo GET /computador.
    { metodo: "POST", acao: "computador.trocar_lugar", padrao: /^\/computador\/lugar$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { maquinaId?: unknown; semLogins?: unknown } | null;
      if (!corpo || typeof corpo.maquinaId !== "string" || !/^[0-9a-f-]{36}$/i.test(corpo.maquinaId) || (corpo.semLogins !== undefined && typeof corpo.semLogins !== "boolean")) throw new ErroDeDominio("entrada_invalida");
      try {
        await computadores.trocarLugarDaPessoa(ctx.escopo, { maquinaId: corpo.maquinaId, semLogins: corpo.semLogins === true });
      } catch (e) {
        if (!ehFalhaComputador(e) || e.motivo !== "maquina_sem_contato") throw e;
        // AGENTS.md: a frase sai de uma tabela fixa; o nome da máquina (dado da pessoa) vai num campo à parte.
        ctx.json(409, { codigo: "origem_sem_contato", mensagem: MENSAGEM_ORIGEM_SEM_CONTATO, maquina: e.maquina ?? null });
        return;
      }
      ctx.json(200, { ok: true });
    } },
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultar(ctx.escopo, ctx.params.id!)); } },
    { metodo: "POST", acao: "computador.operar_do_bot", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown; origem?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string") throw new ErroDeDominio("entrada_invalida");
      // NOD-97: `origem` é opcional (sem ela, "botao"); fora do enum é entrada inválida.
      if (corpo.origem !== undefined && !ORIGENS_CONTROLE.includes(corpo.origem as OrigemControle)) throw new ErroDeDominio("entrada_invalida");
      try {
        await computadores.configurar(ctx.escopo, ctx.params.id!, corpo.operacao, corpo.origem as OrigemControle | undefined);
      } catch (e) {
        if (responderCausa(ctx, e)) return;
        throw e;
      }
      ctx.json(200, { ok: true });
    } },
    { metodo: "POST", acao: "computador.usar_tela", padrao: /^\/agentes\/(?<id>[^/]+)\/computador\/acoes$/, async handler(ctx) {
      try {
        ctx.json(200, await computadores.humano(ctx.escopo, ctx.params.id!, await ctx.corpo()));
      } catch (e) {
        if (responderCausa(ctx, e)) return;
        throw e;
      }
    } },
  ];
}
