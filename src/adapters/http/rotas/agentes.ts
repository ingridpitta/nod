import type { PreferenciaHarness } from "../../../contracts/harness.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import { gerirAgente } from "../../../use-cases/gerir-agente.ts";
import type { DonoAgente, FormaAgente, CorAgente } from "../../../contracts/agente.ts";
import type { TipoMemoria } from "../../../contracts/memoria.ts";
import { apagarMemoria, desfazerEntradaDiario, editarMemoria, listarDiarioMemoria, listarMemorias, revisarDiarioMemoria } from "../../../use-cases/editar-memorias.ts";
import { EXECUTORES_BOTS } from "../../../use-cases/acoes/bots.ts";
import { fixarAgente, ocultarAgente } from "../../../use-cases/fixar-ocultar-agente.ts";
import { registrarMemoria } from "../../../use-cases/lembrar.ts";
import { definirInteligenciaDoBot, lerInteligenciaDoBot } from "../../../use-cases/inteligencia.ts";
import { decidirTrocaDeIa } from "../../../use-cases/trocas-de-ia.ts";
import { listarVersoesDoPerfil, verVersaoDoPerfil } from "../../../use-cases/versoes-perfil.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { TABELA_ERROS } from "../erros.ts";
import { corpoObjeto, criarExecutor, texto, textoOpcional, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Rotas de agentes (tabela ROTAS, lane L6): criação {dono, nome?} (EMENDA 17), PATCH de perfil
 * (dono no corpo → 403 dono_imutavel), Pin/Hide/Duplicate e memória. Cada handler: valida a forma,
 * chama o caso de uso, responde. Mutação devolve o que criou/alterou; o estado vivo chega por SSE.
 */
export function criarRotasAgentes(d: DepsRotas, prontosPorMaquina?: (escopo: Escopo) => Readonly<Record<string, readonly IdHarness[]>>): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "PATCH", acao: "bots.mover", padrao: new RegExp(`^/agentes/${ID}/organizacao$`), async handler(ctx) {
      const corpo = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_BOTS["bots.mover"], { agenteId: ctx.params.id ?? "",
        secao: corpo.secao as string | undefined, naoLido: corpo.naoLido as boolean | undefined,
        fixado: corpo.fixado as boolean | undefined, ordem: corpo.ordem as string[] | undefined }));
    } },
    { metodo: "DELETE", acao: "bots.excluir", padrao: new RegExp(`^/agentes/${ID}$`), async handler(ctx) {
      // NOD-391: o desligamento do computador é efeito pós-commit do executor único (o mesmo do lote do Nod).
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_BOTS["bots.excluir"], { agenteId: ctx.params.id ?? "" }));
    } },
    { metodo: "POST", acao: "bots.restaurar", padrao: new RegExp(`^/agentes/${ID}/restaurar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, gerirAgente, { agenteId: ctx.params.id ?? "", acao: "restaurar" }));
    } },
    {
      metodo: "POST", acao: "bots.criar",
      padrao: /^\/agentes$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, EXECUTORES_BOTS["bots.criar"], { dono: corpo.dono as DonoAgente, interativo: corpo.interativo === true, nome: textoOpcional(corpo.nome), titulo: textoOpcional(corpo.titulo), descricao: textoOpcional(corpo.descricao), modelo: textoOpcional(corpo.modelo), harness: corpo.harness as PreferenciaHarness | undefined });
        ctx.json(201, r);
      },
    },
    {
      metodo: "PATCH", acao: "bots.editar",
      padrao: new RegExp(`^/agentes/${ID}$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, EXECUTORES_BOTS["bots.editar"], {
          agenteId: ctx.params.id ?? "",
          nome: textoOpcional(corpo.nome),
          titulo: textoOpcional(corpo.titulo),
          descricao: textoOpcional(corpo.descricao),
          modelo: textoOpcional(corpo.modelo),
          harness: corpo.harness as PreferenciaHarness | undefined,
          esforco: corpo.esforco === null ? null : textoOpcional(corpo.esforco),
          forma: corpo.forma as FormaAgente | undefined,
          cor: corpo.cor as CorAgente | undefined,
          dono: corpo.dono,
          // NOD-20: a voz vai no mesmo Salvar da tela (uma versão só, não duas).
          ...(corpo.voz !== undefined ? { voz: corpo.voz } : {}),
          ...(corpo.vozVelocidade !== undefined ? { vozVelocidade: corpo.vozVelocidade } : {}),
        });
        ctx.json(200, r);
      },
    },
    {
      // definido em 2026-10-30 (NOD-20): o histórico de versões do perfil. `antes` = a última versão já mostrada (página).
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/perfil/versoes$`),
      async handler(ctx) {
        const antes = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("antes");
        ctx.json(200, await executar(ctx.escopo, listarVersoesDoPerfil, { agenteId: ctx.params.id ?? "", antes: antes === null ? null : Number(antes) }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/perfil/versoes/(?<versao>[0-9]+)$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, verVersaoDoPerfil, { agenteId: ctx.params.id ?? "", versao: Number(ctx.params.versao) }));
      },
    },
    {
      metodo: "POST", acao: "bots.restaurar_versao",
      padrao: new RegExp(`^/agentes/${ID}/perfil/versoes/(?<versao>[0-9]+)/restaurar$`),
      async handler(ctx) {
        // `esperada` = a versão vigente que a tela mostrou (409 perfil_mudou se outra escrita entrou depois);
        // `aceitarRedacao` = a pessoa confirmou o aviso de que partes com segredo voltam redigidas.
        const corpo = corpoObjeto(await ctx.corpo());
        try {
          ctx.json(200, await executar(ctx.escopo, EXECUTORES_BOTS["bots.restaurar_versao"], {
            agenteId: ctx.params.id ?? "",
            versao: Number(ctx.params.versao),
            // Ausente = sem guarda; presente tem de ser um número de versão (null, texto ou 0 → 400, não desliga a guarda).
            esperada: corpo.esperada === undefined ? null : ((corpo.esperada ?? Number.NaN) as number),
            aceitarRedacao: corpo.aceitarRedacao === true,
          }));
        } catch (erro) {
          // Só estas duas causas saem no corpo (`motivo`, como em /eu): a tela precisa distinguir; o resto fica no log.
          const causa = erro instanceof ErroDeDominio && typeof erro.cause === "string" ? erro.cause : null;
          if (!(erro instanceof ErroDeDominio) || (causa !== "perfil_mudou" && causa !== "versao_redigida")) throw erro;
          const { status, mensagem } = TABELA_ERROS[erro.codigo];
          ctx.json(status, { codigo: erro.codigo, mensagem, motivo: causa });
        }
      },
    },
    {
      // definido em 2026-10-10 (0068, emenda da ADR-036): a inteligência do bot — modo, IA fixa, ordem própria e o modelo e
      // o raciocínio de cada IA (contrato em src/contracts/inteligencia.ts). Campo ausente não muda; `ordem: null` volta à
      // ordem da pessoa. O PATCH acima continua aceitando o par antigo {harness, modelo, esforco}.
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/inteligencia$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerInteligenciaDoBot, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "PUT", acao: "bots.definir_inteligencia",
      padrao: new RegExp(`^/agentes/${ID}/inteligencia$`),
      async handler(ctx) {
        // ADR-108 (revisão do PR 2, C6): as IAs prontas por máquina, para "levar as tasks" ao Automático.
        ctx.json(200, await executar(ctx.escopo, definirInteligenciaDoBot, { agenteId: ctx.params.id ?? "", pedido: await ctx.corpo(), prontosPorMaquina: prontosPorMaquina?.(ctx.escopo) ?? {} }));
      },
    },
    {
      // ADR-108 (R4/R6): a escolha no aviso de troca de IA do bot — esperar, levar as tasks, ou (bot fixo) seguir noutra IA
      // até a volta. Só a dona; quem chega primeiro vence (o segundo clique recebe `aplicada: false`).
      metodo: "POST", acao: "bots.decidir_troca_de_ia",
      padrao: new RegExp(`^/agentes/${ID}/troca-de-ia$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, decidirTrocaDeIa, { agenteId: ctx.params.id ?? "", decisao: corpo.decisao, ...(corpo.trocaId !== undefined ? { trocaId: corpo.trocaId } : {}) }));
      },
    },
    {
      // ADR-059: o botão de aprovações do campo. Só a dona; a troca vira linha na conversa do bot. O total exige
      // `confirmado: true` (o segundo clique do menu; emenda de 2026-10-18).
      metodo: "POST", acao: "bots.mudar_modo",
      padrao: new RegExp(`^/agentes/${ID}/modo-aprovacao$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, EXECUTORES_BOTS["bots.mudar_modo"], { agenteId: ctx.params.id ?? "", modo: corpo.modo, confirmado: corpo.confirmado }));
      },
    },
    {
      metodo: "POST", acao: "bots.fixar",
      padrao: new RegExp(`^/agentes/${ID}/fixar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, fixarAgente, { agenteId: ctx.params.id ?? "", fixado: typeof corpo.fixado === "boolean" ? corpo.fixado : undefined }));
      },
    },
    {
      metodo: "POST", acao: "bots.ocultar",
      padrao: new RegExp(`^/agentes/${ID}/ocultar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, ocultarAgente, { agenteId: ctx.params.id ?? "", oculto: typeof corpo.oculto === "boolean" ? corpo.oculto : undefined }));
      },
    },
    {
      metodo: "POST", acao: "bots.duplicar",
      padrao: new RegExp(`^/agentes/${ID}/duplicar$`),
      async handler(ctx) {
        ctx.json(201, await executar(ctx.escopo, EXECUTORES_BOTS["bots.duplicar"], { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/memoria$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarMemorias, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST", acao: "memoria.criar",
      padrao: new RegExp(`^/agentes/${ID}/memoria$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, registrarMemoria, {
          agenteId: ctx.params.id ?? "",
          conversaId: textoOpcional(corpo.conversaId) ?? null,
          turnoId: null,
          tipo: texto(corpo.tipo) as TipoMemoria,
          texto: texto(corpo.texto),
          origem: "pessoa",
        });
        ctx.json(201, r);
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/memoria/diario$`),
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        ctx.json(200, await executar(ctx.escopo, listarDiarioMemoria, { agenteId: ctx.params.id ?? "", antes: url.searchParams.get("antes") }));
      },
    },
    {
      metodo: "POST", acao: "memoria.revisar_diario",
      padrao: new RegExp(`^/agentes/${ID}/memoria/diario/revisar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, revisarDiarioMemoria, { agenteId: ctx.params.id ?? "", entradaId: textoOpcional(corpo.entradaId) ?? null }));
      },
    },
    {
      metodo: "POST", acao: "memoria.desfazer_diario",
      padrao: new RegExp(`^/agentes/${ID}/memoria/diario/(?<eid>[^/]+)/desfazer$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, desfazerEntradaDiario, { agenteId: ctx.params.id ?? "", entradaId: ctx.params.eid ?? "" }));
      },
    },
    {
      metodo: "PATCH", acao: "memoria.editar",
      padrao: new RegExp(`^/agentes/${ID}/memoria/(?<mid>[^/]+)$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, editarMemoria, { memoriaId: ctx.params.mid ?? "", texto: textoOpcional(corpo.texto), tipo: textoOpcional(corpo.tipo) as TipoMemoria | undefined }));
      },
    },
    {
      metodo: "DELETE", acao: "memoria.apagar",
      padrao: new RegExp(`^/agentes/${ID}/memoria/(?<mid>[^/]+)$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, apagarMemoria, { memoriaId: ctx.params.mid ?? "" });
        ctx.json(200, { ok: true, ids: { memoria: ctx.params.mid ?? "", agente: r.agenteId } });
      },
    },
  ];
}
