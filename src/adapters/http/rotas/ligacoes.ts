import type { ServerResponse } from "node:http";
import type { Escopo } from "../../../shared/types.ts";
import type { IaDaLigacao } from "../../../contracts/voz.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { ehIaDaLigacao } from "../../../domain/ligacao-sem-ia.ts";
import { cancelarTurno } from "../../../use-cases/cancelar-turno.ts";
import {
  apagarTranscricao,
  avaliarLigacao,
  consentirVoz,
  definirVozDoAgente,
  disponibilidadeLigacao,
  encerrarLigacao,
  falasDaLigacao,
  ligacaoViva,
  ligar,
  reabrirCerebroDaLigacao,
  type ContextoLigacao,
} from "../../../use-cases/ligacoes.ts";
import { disponibilidadeDitado, type ContextoDitado } from "../../../use-cases/ditado.ts";
import { prepararLeitura, type ContextoLeitura, type LeituraPreparada } from "../../../use-cases/ouvir-mensagem.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O que a rota precisa da composição além das Deps: o estado vivo da voz e das máquinas. */
export type DepsRotasLigacoes = DepsRotas & {
  contexto(escopo: Escopo, agenteId: string): Promise<ContextoLigacao>;
  /** Depois do commit do POST: registra a ligação no orquestrador de voz (memória). */
  registrar(escopo: Escopo, l: { ligacaoId: string; agenteId: string; conversaId: string; turnoId: string; voz: string; velocidade: number; nomeBot: string; genero: "feminina" | "masculina" }): void;
  encerrarViva(ligacaoId: string): Promise<void>;
  /** Rede de segurança (2026-10-05): a ligação desta pessoa espera a escolha depois de a IA cair? (memória do orquestrador) */
  aguardandoEscolha(escopo: Escopo, ligacaoId: string): boolean;
  /** As IAs prontas no Mac da pessoa agora; null = simulação (catcher), em que qualquer uma serve. */
  iasProntas(escopo: Escopo): readonly IaDaLigacao[] | null;
  /** Depois do commit: o orquestrador passa a aceitar o turno-cérebro novo. false = a ligação já não esperava. */
  reabrirCerebro(escopo: Escopo, p: { ligacaoId: string; turnoId: string; ia: IaDaLigacao }): boolean;
  /** A prévia de uma voz (WAV) para escolher a voz do bot; null = voz desconhecida ou fora do ar. */
  amostra(voz: string, velocidade: number): Promise<Buffer | null>;
  /** NOD-180: o que só o servidor sabe para ouvir uma resposta (a chave, a permissão da voz e o provedor no ar). */
  contextoLeitura(escopo: Escopo): Promise<ContextoLeitura>;
  /** NOD-180: toca a leitura no `res` (leitura-voz.ts). Lança antes do 1º byte; depois, nunca. */
  ouvir(escopo: Escopo, p: { mensagemId: string; leitura: LeituraPreparada; res: ServerResponse }): Promise<void>;
  /** ADR-095: NOD_DITADO e a voz no ar, para o microfone do campo de mensagem. */
  contextoDitado(escopo: Escopo): Promise<ContextoDitado>;
  maxS: number;
};

/**
 * Rotas da ligação por voz (definido em 2026-10-04, ADR-072/075). O áudio não passa por aqui: vai pelo WebSocket de
 * mídia (src/adapters/voz/ws.ts). Aqui ficam disponibilidade, ligar, desligar, continuar com outra IA (a rede de
 * segurança de 2026-10-05), a transcrição, a avaliação, o consentimento, a voz do bot e a disponibilidade do ditado.
 */
export function criarRotasLigacoes(d: DepsRotasLigacoes): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/ligacoes\/disponibilidade$/,
      async handler(ctx) {
        const agenteId = new URL(ctx.req.url ?? "/", "http://x").searchParams.get("agenteId") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "agenteId" });
        const contexto = await d.contexto(ctx.escopo, agenteId);
        ctx.json(200, await executar(ctx.escopo, disponibilidadeLigacao, { agenteId, contexto }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/ligacoes\/viva$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, ligacaoViva, {}));
      },
    },
    {
      metodo: "POST", acao: "voz.ligar",
      padrao: /^\/ligacoes$/,
      async handler(ctx) {
        const agenteId = texto(corpoObjeto(await ctx.corpo()).agenteId);
        if (!/^[0-9a-f-]{36}$/i.test(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "agenteId" });
        const contexto = await d.contexto(ctx.escopo, agenteId);
        const r = await executar(ctx.escopo, ligar, { agenteId, contexto, executor: d.executor });
        d.registrar(ctx.escopo, { ligacaoId: r.ligacao.id, agenteId, conversaId: r.ligacao.conversaId, turnoId: r.turno.id, voz: r.voz, velocidade: r.velocidade, nomeBot: r.nomeBot, genero: r.genero });
        ctx.json(201, { ligacao: r.ligacao, maxS: d.maxS });
      },
    },
    {
      metodo: "POST", acao: "voz.encerrar",
      padrao: new RegExp(`^/ligacoes/${ID}/encerrar$`),
      async handler(ctx) {
        const id = ctx.params.id ?? "";
        // O orquestrador fecha a mídia e manda o `fim` ao cérebro; se ele não tiver a ligação (reinício), o banco fecha.
        await d.encerrarViva(id);
        const l = await executar(ctx.escopo, encerrarLigacao, { ligacaoId: id, motivo: "pessoa_desligou" });
        if (!l) throw new ErroDeDominio("nao_encontrado");
        ctx.json(200, { ligacao: l });
      },
    },
    {
      // Rede de segurança (definido em 2026-10-05): a IA do Mac caiu e a pessoa escolheu com qual continuar. Abre um
      // turno-cérebro novo para a MESMA ligação. Só vale com a ligação esperando a escolha: fora disso (409) ninguém
      // abre um segundo cérebro numa ligação que tem um.
      metodo: "POST", acao: "voz.continuar",
      padrao: new RegExp(`^/ligacoes/${ID}/continuar$`),
      async handler(ctx) {
        const id = ctx.params.id ?? "";
        const ia = corpoObjeto(await ctx.corpo()).ia;
        if (!ehIaDaLigacao(ia)) throw new ErroDeDominio("entrada_invalida", { cause: "ia" });
        if (!d.aguardandoEscolha(ctx.escopo, id)) throw new ErroDeDominio("estado_invalido", { cause: "a ligação não espera escolha" });
        const r = await executar(ctx.escopo, reabrirCerebroDaLigacao, { ligacaoId: id, ia, iasProntas: d.iasProntas(ctx.escopo), executor: d.executor });
        if (!d.reabrirCerebro(ctx.escopo, { ligacaoId: id, turnoId: r.turno.id, ia })) {
          // A ligação acabou entre a conferência e o commit: o turno recém-criado sai da fila em vez de ficar órfão.
          await executar(ctx.escopo, cancelarTurno, { turnoId: r.turno.id }).catch(() => undefined);
          throw new ErroDeDominio("estado_invalido", { cause: "a ligação não espera escolha" });
        }
        ctx.json(200, { ligacao: r.ligacao });
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/ligacoes/${ID}/falas$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, falasDaLigacao, { ligacaoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "DELETE", acao: "voz.apagar_falas",
      padrao: new RegExp(`^/ligacoes/${ID}/falas$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, apagarTranscricao, { ligacaoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "voz.avaliar",
      padrao: new RegExp(`^/ligacoes/${ID}/avaliacao$`),
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, avaliarLigacao, { ligacaoId: ctx.params.id ?? "", nota: b.nota, motivo: b.motivo }));
      },
    },
    {
      metodo: "POST", acao: "voz.consentir",
      padrao: /^\/voz\/consentimento$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, consentirVoz, { versao: corpoObjeto(await ctx.corpo()).versao }));
      },
    },
    {
      // Ditado no campo (definido em 2026-10-11, ADR-095): o microfone aparece? O áudio vai pelo canal voz/v1/ditado.
      metodo: "GET",
      padrao: /^\/voz\/ditado\/disponibilidade$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, disponibilidadeDitado, { contexto: await d.contextoDitado(ctx.escopo) }));
      },
    },
    {
      // A prévia da voz (definido em 2026-10-04): o mesmo provedor das ligações, uma frase curta, em cache.
      metodo: "GET",
      padrao: /^\/voz\/amostra$/,
      async handler(ctx) {
        const q = new URL(ctx.req.url ?? "/", "http://x").searchParams;
        const velocidade = Number(q.get("velocidade") ?? "1");
        const wav = await d.amostra(q.get("voz") ?? "", Number.isFinite(velocidade) ? velocidade : 1);
        if (!wav) throw new ErroDeDominio("nao_encontrado", { cause: "voz" });
        ctx.res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": "private, max-age=3600" });
        ctx.res.end(wav);
      },
    },
    {
      // Ouvir uma resposta (definido em 2026-10-06, NOD-180): o áudio sai em streaming (audio/L16 big-endian, 24 kHz)
      // enquanto é sintetizado. Com NOD_VOZ_LEITURA desligada, 403 antes de tocar no banco.
      metodo: "GET",
      padrao: new RegExp(`^/mensagens/${ID}/ouvir$`),
      async handler(ctx) {
        const mensagemId = ctx.params.id ?? "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mensagemId)) throw new ErroDeDominio("nao_encontrado");
        const contexto = await d.contextoLeitura(ctx.escopo);
        if (!contexto.habilitada) throw new ErroDeDominio("nao_permitido", { cause: "leitura desligada" });
        const leitura = await executar(ctx.escopo, prepararLeitura, { mensagemId, contexto });
        await d.ouvir(ctx.escopo, { mensagemId, leitura, res: ctx.res });
      },
    },
    {
      // A voz do bot e a velocidade (Ajustes da ligação, detalhes do bot). Vale na próxima frase da ligação.
      metodo: "PATCH", acao: "bots.mudar_voz",
      padrao: new RegExp(`^/agentes/${ID}/voz$`),
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, definirVozDoAgente, { agenteId: ctx.params.id ?? "", voz: b.voz, vozVelocidade: b.vozVelocidade }));
      },
    },
  ];
}
