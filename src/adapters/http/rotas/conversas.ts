import type { RespostaMutacao } from "../../../contracts/api.ts";
import { TAMANHO_MAX_ANEXO } from "../../../contracts/anexo.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { lerAnexo, lerBiblioteca, lerFaixaDoAnexo, localDaMidia, receberAnexo } from "../../../use-cases/anexos.ts";
import { lerCursor, limiteDaBiblioteca } from "../../../domain/biblioteca.ts";
import { enviarMensagem, lerConversa } from "../../../use-cases/enviar-mensagem.ts";
import { pedirDesfazerTurno } from "../../../use-cases/desfazer-turno.ts";
import { parar } from "../../../use-cases/parar.ts";
import { reagir } from "../../../use-cases/reagir.ts";
import { UUID, type Rota } from "../roteador.ts";
import { bytesVigiados, criarFilaDeLeitura, faixaInvalida, faixaPedida, lerBruto, RESPOSTA_PARADA_MS } from "../util.ts";

import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * NOD-323 (revisão do #507, A2/M3; revisões 3 e 4): as leituras inteiras de anexo (até 50 MiB cada) vão no máximo 4
 * por vez, 2 por pessoa; as faixas (até 2 MiB), 16 por vez, 6 por pessoa. A vaga volta quando a resposta saiu ou o
 * cliente foi embora; a resposta vai em pedaços e a que fica 120 s sem um drain (o cliente que não lê) é derrubada — o buffer não fica preso.
 */
const leituraInteira = criarFilaDeLeitura({ max: 4, porChave: 2 });
const leituraDeFaixa = criarFilaDeLeitura({ max: 16, porChave: 6 });

/**
 * Conversas (lane L6): GET mensagens (ConversaDto com turnosPendentes, EMENDA 13), POST mensagem
 * (mensagem + turno + outbox na mesma tx) e Parar — da conversa e global (E5.4/E8).
 */
export function criarRotasConversas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/mensagens$`),
      async handler(ctx) {
        // NOD-380/NOD-363: `?ate=<mensagem>` (a busca do celular e o Ir para a mensagem da Biblioteca) faz a janela chegar até ela; id fora de uuid é entrada inválida.
        const ate = new URL(ctx.req.url ?? "/", "http://x").searchParams.get("ate");
        if (ate !== null && !UUID.test(ate)) throw new ErroDeDominio("entrada_invalida", { cause: "conversa: ate" });
        ctx.json(200, await executar(ctx.escopo, lerConversa, { conversaId: ctx.params.id ?? "", ...(ate ? { ate } : {}) }));
      },
    },
    {
      metodo: "POST", acao: "conversas.enviar",
      padrao: new RegExp(`^/conversas/${ID}/mensagens$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, enviarMensagem, {
          conversaId: ctx.params.id ?? "",
          texto: texto(corpo.texto),
          anexos: idsDeAnexo(corpo.anexos),
          idEnvio: idDeEnvio(corpo.idEnvio),
          respondeA: respondeADoCorpo(corpo.respondeA),
          prazoMs: d.prazoDecisaoMs,
          executor: d.executor,
          harnessesDaPessoa: d.harnessesDaPessoa?.(ctx.escopo.pessoaId),
          ...(d.guardarSemIa ? { guardarSemIa: true } : {}),
        });
        const resposta: RespostaMutacao = { ok: true, ids: { mensagem: r.mensagem.id, turno: r.turno.id, ...(r.negacao ? { negacao: r.negacao.id } : {}) } };
        ctx.json(201, resposta);
      },
    },
    {
      // ADR-046: corpo BINÁRIO (o arquivo), tipo no content-type e nome em x-nod-nome. O cabeçalho próprio
      // força preflight num POST de outra origem — defesa a mais sobre o cookie SameSite=Strict.
      metodo: "POST", acao: "conversas.anexar",
      padrao: new RegExp(`^/conversas/${ID}/anexos$`),
      async handler(ctx) {
        const nome = ctx.req.headers["x-nod-nome"];
        if (typeof nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "anexo sem x-nod-nome" });
        let conteudo: Buffer;
        try {
          conteudo = await lerBruto(ctx.req, TAMANHO_MAX_ANEXO);
        } catch (e) {
          if (e instanceof RangeError) throw new ErroDeDominio("entrada_invalida", { cause: "anexo: tamanho" });
          throw e;
        }
        const meta = await executar(ctx.escopo, receberAnexo, {
          conversaId: ctx.params.id ?? "",
          nome: decodificar(nome),
          mime: ctx.req.headers["content-type"] ?? "",
          conteudo,
        });
        ctx.json(201, meta);
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/anexos/(?<aid>[^/]+)$`),
      async handler(ctx) {
        const alvo = { conversaId: ctx.params.id ?? "", anexoId: ctx.params.aid ?? "" };
        const baixar = new URL(ctx.req.url ?? "/", "http://x").searchParams.get("baixar") === "1";
        const range = ctx.req.headers.range;
        // NOD-323: vídeo e áudio pedem faixas (Range de faixa única); 206 só com a fatia, lida no banco por substring.
        const pessoa = `${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
        const desistiu = () => ctx.res.destroyed || ctx.req.destroyed;
        if (range) {
          const servida = await leituraDeFaixa(pessoa, desistiu, async () => {
            const f = await executar(ctx.escopo, lerFaixaDoAnexo, { ...alvo, faixa: (total: number) => faixaPedida(range, total) });
            if (f && "invalida" in f) { faixaInvalida(ctx.res, f.invalida); return true; }
            if (!f) return false;
            await bytesVigiados(ctx.res, f.meta.mime, f.meta.nome, f.bytes, { baixar, faixa: f.faixa, paradoMs: RESPOSTA_PARADA_MS });
            return true;
          });
          if (servida !== false) return;
        }
        await leituraInteira(pessoa, desistiu, async () => {
          const r = await executar(ctx.escopo, lerAnexo, alvo);
          await bytesVigiados(ctx.res, r.meta.mime, r.meta.nome, r.bytes, { baixar, aceitaFaixas: r.meta.mime.startsWith("video/") || r.meta.mime.startsWith("audio/"), paradoMs: RESPOSTA_PARADA_MS });
        });
      },
    },
    {
      // NOD-323 (J5): o caminho da mídia do bot na máquina, para o Mostrar no Finder do app do Mac (que confere de novo).
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/anexos/(?<aid>[^/]+)/local$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, localDaMidia, { conversaId: ctx.params.id ?? "", anexoId: ctx.params.aid ?? "" }));
      },
    },
    {
      // NOD-326: a Biblioteca da gaveta do bot (a mídia que o bot anexou nesta conversa), paginada por `?antes=<cursor>`.
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/biblioteca$`),
      async handler(ctx) {
        const q = new URL(ctx.req.url ?? "/", "http://x").searchParams;
        const textoAntes = q.get("antes");
        const antes = textoAntes === null || textoAntes === "" ? null : lerCursor(textoAntes);
        if (textoAntes && !antes) throw new ErroDeDominio("entrada_invalida", { cause: "biblioteca: cursor" });
        const limite = limiteDaBiblioteca(q.get("limite"));
        if (limite === null) throw new ErroDeDominio("entrada_invalida", { cause: "biblioteca: limite" });
        ctx.json(200, await executar(ctx.escopo, lerBiblioteca, { conversaId: ctx.params.id ?? "", antes, limite }));
      },
    },
    {
      // ADR-113 (Parte 5 do plano "pergunta com botões"): põe (`marcada: true`) ou tira a reação da pessoa numa fala.
      // Idempotente, por isso PUT: o mesmo corpo duas vezes deixa o mesmo estado. Responde as reações da fala.
      metodo: "PUT", acao: "conversas.reagir",
      padrao: new RegExp(`^/mensagens/${ID}/reacoes$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        if (typeof corpo.marcada !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "marcada" });
        ctx.json(200, await executar(ctx.escopo, reagir, { mensagemId: ctx.params.id ?? "", emoji: corpo.emoji, marcada: corpo.marcada }));
      },
    },
    {
      // NOD-54 (ADR-134): o "Desfazer N arquivos" da fala. `forcar` = "Voltar mesmo assim" nos conflitos do desfazer anterior.
      // A recusa (vencido, outro desfazendo do mesmo bot) volta 200 com `ok: false` e o motivo: é resposta, não erro — a
      // tela diz o que houve sem passar pelo aviso genérico de falha.
      metodo: "POST", acao: "conversas.desfazer_turno",
      padrao: new RegExp(`^/conversas/${ID}/turnos/(?<turno>[^/]+)/desfazer$`),
      async handler(ctx) {
        const conversaId = ctx.params.id ?? "";
        const turnoId = ctx.params.turno ?? "";
        if (!UUID.test(conversaId) || !UUID.test(turnoId)) throw new ErroDeDominio("nao_encontrado");
        const corpo = corpoObjeto(await ctx.corpo());
        if (corpo.forcar !== undefined && typeof corpo.forcar !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "forcar" });
        const r = await executar(ctx.escopo, pedirDesfazerTurno, { conversaId, turnoId, forcar: corpo.forcar === true });
        ctx.json(200, r);
      },
    },
    {
      metodo: "POST", acao: "conversas.parar",
      padrao: new RegExp(`^/conversas/${ID}/parar$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, parar, { conversaId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "conversas.parar_tudo",
      padrao: /^\/parar$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, parar, { conversaId: null }));
      },
    },
  ];
}

function idsDeAnexo(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !UUID.test(x))) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
  return v as string[];
}

/** NOD-156: a chave de idempotência é opcional (cliente antigo não manda), mas, quando vem, tem de ser UUID. */
function idDeEnvio(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroDeDominio("entrada_invalida", { cause: "idEnvio" });
  return v;
}

/**
 * ADR-113 (Parte 3b): `respondeA: { mensagemId }` diz a qual fala a mensagem responde. Só o id vale: o `trecho` que o
 * cliente mandar é ignorado (o servidor o recalcula da fala). Ausente = mensagem sem citação (cliente antigo).
 */
function respondeADoCorpo(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const id = corpoObjeto(v).mensagemId;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErroDeDominio("entrada_invalida", { cause: "respondeA" });
  return id;
}

function decodificar(nome: string): string {
  try {
    return decodeURIComponent(nome);
  } catch {
    return nome;
  }
}
