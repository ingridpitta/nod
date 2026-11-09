import type { Ligacao, MotivoRecusaLigacao } from "../../../contracts/ligacao.ts";
import { VERSAO_CONSENTIMENTO_VOZ } from "../../../contracts/ligacao.ts";
import type { IaNoMac } from "../../../contracts/onboarding.ts";
import type { MotivoFimLigacao } from "../../../contracts/voz.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import { disponibilidadeLigacao, encerrarLigacao, ligacaoViva, ligar, type ContextoLigacao, type SaidaLigar } from "../../../use-cases/ligacoes.ts";
import { anotarRespostasDeTexto, concluirOnboarding, criarBotDoOnboarding, criarRotinaDoOnboarding, definirEtapaOnboarding, estadoOnboarding, garantirNod } from "../../../use-cases/onboarding.ts";
import type { CasoDeUso } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

/** O que a rota precisa da composição além das Deps: a IA do Mac, a voz em memória e o fuso padrão. */
export type DepsRotasOnboarding = DepsRotas & {
  /** A IA dos bots neste Mac (o desktop detecta e anuncia; no modo local, o inventário deste processo). */
  executorDoMac(escopo: Escopo): { pronto: boolean; ias: IaNoMac[] };
  contexto(escopo: Escopo, agenteId: string): Promise<ContextoLigacao>;
  /** Depois do commit do POST: registra a ligação de onboarding no orquestrador (tocando, à espera do Atender). */
  registrar(escopo: Escopo, l: SaidaLigar): void;
  /** O consentimento foi gravado: a mídia da ligação pode abrir. */
  liberar(ligacaoId: string): void;
  encerrarViva(ligacaoId: string, motivo: MotivoFimLigacao): Promise<void>;
  fusoPadrao: string;
  /** NOD_ONBOARDING_TEXTO=1 (ADA-242): 'configurando' aceita `respostas` {apelido, objetivo} da conversa por texto. */
  onboardingTexto?: boolean;
};

const consentimento: CasoDeUso<Record<string, never>, number> = async (deps) => ({ data: (await deps.repos.ligacoes.consentimento()).versao ?? 0 });

/**
 * Rotas do onboarding por ligação (definido em 2026-10-04, ADR-077). A etapa é do servidor: entrar em 'chamando'
 * garante a guia (o Nod, ADR-081) e começa a ligação (iniciada pelo produto, tocando); 'entrevista' é o Atender (exige o consentimento
 * já gravado e libera a mídia); 'configurando' com `semVoz` encerra a ligação como recusada; 'ola' recomeça.
 */
export function criarRotasOnboarding(d: DepsRotasOnboarding): Rota[] {
  const executar = criarExecutor(d);
  const estado = (escopo: Escopo, recusa: { motivo: MotivoRecusaLigacao; texto: string } | null = null) =>
    executar(escopo, estadoOnboarding, { executor: d.executorDoMac(escopo), recusa });
  // ADR-081: a web pede o onboarding ao entrar — é ali que toda pessoa ganha o seu Nod (uma vez; depois é só leitura).
  const garantir = (escopo: Escopo) => executar(escopo, garantirNod, {});
  const vivaDaGuia = async (escopo: Escopo, guiaId: string): Promise<Ligacao | null> => {
    const { ligacao } = await executar(escopo, ligacaoViva, {});
    return ligacao && ligacao.agenteId === guiaId ? ligacao : null;
  };

  return [
    {
      metodo: "GET",
      padrao: /^\/onboarding$/,
      async handler(ctx) {
        await garantir(ctx.escopo);
        ctx.json(200, await estado(ctx.escopo));
      },
    },
    {
      metodo: "POST", acao: "onboarding.etapa",
      padrao: /^\/onboarding\/etapa$/,
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        const escopo = ctx.escopo;
        if (b.etapa === "chamando") {
          const { nod: guia } = await garantir(escopo);
          await executar(escopo, definirEtapaOnboarding, { etapa: "chamando" });
          if (await vivaDaGuia(escopo, guia.id)) {
            ctx.json(200, await estado(escopo));
            return;
          }
          const contexto = await d.contexto(escopo, guia.id);
          const disp = await executar(escopo, disponibilidadeLigacao, { agenteId: guia.id, contexto });
          if (!disp.disponivel) {
            ctx.json(200, await estado(escopo, { motivo: disp.motivo, texto: disp.texto }));
            return;
          }
          const r = await executar(escopo, ligar, { agenteId: guia.id, contexto, executor: d.executor, iniciadaPor: "produto" });
          d.registrar(escopo, r);
          ctx.json(200, await estado(escopo));
          return;
        }
        if (b.etapa === "entrevista") {
          // O Atender: a web grava o consentimento (POST voz/consentimento) e só então pede a entrevista.
          if ((await executar(escopo, consentimento, {})) < VERSAO_CONSENTIMENTO_VOZ) throw new ErroDeDominio("estado_invalido", { cause: "sem_consentimento" });
          const linha = await executar(escopo, definirEtapaOnboarding, { etapa: "entrevista" });
          const viva = linha.guiaId ? await vivaDaGuia(escopo, linha.guiaId) : null;
          if (viva) d.liberar(viva.id);
          ctx.json(200, await estado(escopo));
          return;
        }
        const linha = await executar(escopo, definirEtapaOnboarding, { etapa: b.etapa });
        // ADA-242: as duas respostas da conversa por texto vêm junto da etapa (mesma ação, sem id novo no chat).
        if (d.onboardingTexto && b.etapa === "configurando" && b.respostas && typeof b.respostas === "object") {
          const r = b.respostas as { apelido?: unknown; objetivo?: unknown };
          await executar(escopo, anotarRespostasDeTexto, { apelido: r.apelido, objetivo: r.objetivo });
        }
        if (b.etapa === "configurando" && b.semVoz === true && linha.guiaId) {
          const viva = await vivaDaGuia(escopo, linha.guiaId);
          if (viva) {
            await d.encerrarViva(viva.id, "recusada");
            await executar(escopo, encerrarLigacao, { ligacaoId: viva.id, motivo: "recusada" });
          }
        }
        ctx.json(200, await estado(escopo));
      },
    },
    {
      metodo: "POST", acao: "onboarding.concluir",
      padrao: /^\/onboarding\/concluir$/,
      async handler(ctx) {
        await executar(ctx.escopo, concluirOnboarding, {});
        ctx.json(200, await estado(ctx.escopo));
      },
    },
    {
      // O card "Novo bot" sem proposta da Nina (caminho sem voz): a pessoa cria o bot direto.
      metodo: "POST", acao: "onboarding.bot",
      padrao: /^\/onboarding\/bot$/,
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        await executar(ctx.escopo, criarBotDoOnboarding, { nome: b.nome, descricao: b.descricao, forma: b.forma, cor: b.cor, voz: b.voz });
        ctx.json(201, await estado(ctx.escopo));
      },
    },
    {
      // "Rotina do {bot}": uma das três opções do modelo, pelo clique (a pessoa é a confirmação).
      metodo: "POST", acao: "onboarding.rotina",
      padrao: /^\/onboarding\/rotina$/,
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        await executar(ctx.escopo, criarRotinaDoOnboarding, { indice: b.indice, fusoIana: d.fusoPadrao });
        ctx.json(201, await estado(ctx.escopo));
      },
    },
  ];
}
