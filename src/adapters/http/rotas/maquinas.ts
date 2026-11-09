import { ErroDeDominio } from "../../../domain/erro.ts";
import type { PareamentoMaquina } from "../../../services/pareamento-maquina.ts";
import { lerPlataforma, type PareamentoDispositivo } from "../../../services/pareamento-dispositivo.ts";
import type { MaquinaDto } from "../../../contracts/maquina.ts";
import type { MaquinaNuvemDto } from "../../../contracts/provedor-nuvem.ts";
import { estadoParaTela } from "../../../domain/maquina-nuvem.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import type { Escopo } from "../../../shared/types.ts";
import { log } from "../../../obs/log.ts";
import type { MaquinaConectada } from "./ponte.ts";
import { emitirChaveMaquina, revogarChaveMaquina } from "../../../use-cases/chaves-maquina.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";
import { assertUuid } from "../../../use-cases/apoio-l7.ts";
import { rodarDestaVezComConta, rodarTrabalhoDestaVez } from "../../../use-cases/contas-ia.ts";
import { EXECUTORES_MAQUINAS, exigirChaveViva } from "../../../use-cases/acoes/maquinas.ts";

/**
 * "Minhas chaves" (E1.3, ADR-031): a pessoa da sessão emite, lista e revoga as chaves dos próprios
 * computadores. Rota de PESSOA (cookie), nunca interna: agente não emite chave. A chave crua aparece
 * só na resposta do POST; a listagem nunca a traz (nem o hash).
 *
 * Pareamento pelo navegador (ADR-069): a pessoa, com sessão, abre um pedido para o Mac que pediu
 * (`pareamentos`); o app troca o código de uso único pela chave em `pareamento/trocar`, rota pública
 * que recusa navegador (Origin → 403) como as de máquina. A chave nasce na troca, dentro do escopo
 * da pessoa que confirmou.
 */
/** ADR-090: o nome que a máquina manda no pareamento (o hostname, editável depois como o de qualquer chave). */
function nomeDaMaquina(v: unknown): string {
  const nome = typeof v === "string" ? v.trim() : "";
  if (nome.length === 0 || nome.length > 60) throw new ErroDeDominio("entrada_invalida", { cause: "nome da máquina" });
  return nome;
}

/**
 * ADR-090: a chave existe, é da pessoa do escopo e não foi revogada — só assim um bot pode ser preso a ela. NOD-94: a
 * máquina só-computador nunca pega turno, então não é escolha de onde o bot trabalha (404, como a inexistente).
 */
export function rotasMaquinas(deps: { dentro: DentroDeTx; pareamento: PareamentoMaquina; dispositivo: PareamentoDispositivo; maquinasVivas?: (escopo: Escopo) => MaquinaConectada[]; servidorNoMac?: { api: string }; nuvem?: boolean;
  /** NOD-94: a máquina do convite `convite` pareou — a instalação por SSH que o criou fica `pronta` com ela. */
  pareadaPorConvite?: (e: { escopo: Escopo; convite: string; maquinaId: string }) => Promise<void> | void }): Rota[] {
  /** ADR-121: só com NOD_MAQUINA_NUVEM=gcp (compor.ts). Sem a flag, o DTO sai igual ao de antes. */
  const nuvemDa = async (d: Deps): Promise<Map<string, MaquinaNuvemDto>> =>
    new Map(
      (deps.nuvem ? await d.repos.maquinasNuvem.listarDaPessoa() : []).flatMap((m) =>
        m.maquinaId === null ? [] : [[m.maquinaId, { provedor: m.provedor, estado: estadoParaTela(m.estado), motivo: m.motivo, criadaPeloNod: m.criadaPeloNod, zona: m.ref.zona, dormirAposMin: m.dormirAposMin, estadoDesde: m.estadoDesde }] as const],
      ),
    );
  return [
    {
      metodo: "POST", acao: "maquinas.criar_chave",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown };
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, emitirChaveMaquina, { nome: corpo.nome }));
        ctx.json(201, r);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        ctx.json(200, { chaves: await deps.dentro(ctx.escopo, (d) => d.repos.maquinaTokens.listar()) });
      },
    },
    {
      metodo: "DELETE", acao: "maquinas.revogar_chave",
      padrao: /^\/maquinas\/chaves\/(?<id>[^/]+)$/,
      async handler(ctx) {
        ctx.json(200, await deps.dentro(ctx.escopo, async (d) => {
          // ADR-121: a VM ligada à nuvem não perde a chave por aqui (o Excluir da nuvem é outro caminho, PR 2).
          if (deps.nuvem && (await d.repos.maquinasNuvem.buscarPorMaquina(ctx.params.id ?? ""))) throw new ErroDeDominio("estado_invalido", { cause: "máquina na nuvem" });
          return executar(d, revogarChaveMaquina, { id: ctx.params.id ?? "" });
        }));
      },
    },
    {
      metodo: "POST", acao: "maquinas.parear",
      padrao: /^\/maquinas\/pareamentos$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown; desafio?: unknown };
        const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
        if (nome.length === 0 || nome.length > 60 || typeof corpo.desafio !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "pareamento" });
        let codigo: string;
        try { codigo = deps.pareamento.abrir({ escopo: ctx.escopo, nome, desafio: corpo.desafio }); }
        catch { throw new ErroDeDominio("entrada_invalida", { cause: "desafio do pareamento" }); }
        ctx.json(201, { codigo });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/pareamento\/trocar$/,
      publica: true,
      async handler(ctx) {
        // Quem troca é o app, nunca uma página: sem isto, um site qualquer poderia tentar a troca no navegador da pessoa.
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { codigo?: unknown; verificador?: unknown };
        const pedido = typeof corpo.codigo === "string" && typeof corpo.verificador === "string" ? deps.pareamento.trocar({ codigo: corpo.codigo, verificador: corpo.verificador }) : null;
        if (!pedido) { ctx.json(400, { codigo: "pareamento_invalido" }); return; }
        const r = await deps.dentro(pedido.escopo, (d) => executar(d, emitirChaveMaquina, { nome: pedido.nome }));
        ctx.json(201, { chave: r.chave });
      },
    },
    // ── ADR-090: pareamento por código (máquina sem navegador) ──────────────────────────────────────────────────────
    {
      metodo: "POST",
      padrao: /^\/pareamento\/dispositivo$/,
      publica: true,
      async handler(ctx) {
        // Quem pede é o motor, nunca uma página (como pareamento/trocar).
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { nome?: unknown; plataforma?: unknown; convite?: unknown };
        const plataforma = lerPlataforma(corpo.plataforma);
        if (!plataforma) throw new ErroDeDominio("entrada_invalida", { cause: "plataforma" });
        // ADR-102: o convite do comando de instalação (opcional; inválido = o pareamento de sempre, com o código).
        const pedido = deps.dispositivo.pedir({ nome: nomeDaMaquina(corpo.nome), plataforma, ...(typeof corpo.convite === "string" ? { convite: corpo.convite } : {}) });
        if (!pedido) { ctx.json(429, { codigo: "muitos_pedidos", mensagem: "Pedidos de pareamento demais agora. Tente de novo em alguns minutos." }); return; }
        if (pedido === "convite_usado") { ctx.json(401, { codigo: "convite_usado", mensagem: "Este convite já foi usado. Gere outro no nod." }); return; }
        ctx.json(201, pedido);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/pareamento\/dispositivo\/trocar$/,
      publica: true,
      async handler(ctx) {
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { codigoDispositivo?: unknown };
        const r = typeof corpo.codigoDispositivo === "string" ? deps.dispositivo.trocar({ codigoDispositivo: corpo.codigoDispositivo }) : { estado: "invalido" as const };
        if (r.estado === "pendente") { ctx.json(202, { estado: "pendente" }); return; }
        if (r.estado === "invalido") { ctx.json(400, { codigo: "pareamento_invalido" }); return; }
        // NOD-94: o papel (e o "Substituir") vem do convite que o servidor criou, nunca do corpo da máquina.
        const nuvemId = r.maquinaNuvemId;
        const emitida = await deps.dentro(r.escopo, async (d) => {
          const e = await executar(d, emitirChaveMaquina, { nome: r.nome, papel: r.papel, substituir: r.substituir });
          if (!nuvemId) return e;
          // ADR-121 (PR 2): a VM que o nod criou. A chave nova vira a máquina dela; a anterior não confirmada sai.
          const v = await d.repos.maquinasNuvem.vincularCriada(nuvemId, e.dados.id);
          if (!v) throw new ErroDeDominio("estado_invalido", { cause: "convite da nuvem já usado" });
          if (v.anterior) await d.repos.maquinaTokens.revogar(v.anterior, d.agora());
          return e;
        });
        log("info", "maquina_pareada_por_codigo", { pessoa_id: r.escopo.pessoaId, chave_id: emitida.dados.id, papel: r.papel, ...(nuvemId ? { maquina_nuvem_id: nuvemId } : {}) });
        // A chave já nasceu: uma falha ao avisar a instalação por SSH não pode tirar a chave da máquina (ela fica sem par).
        if (r.convite) {
          try {
            await deps.pareadaPorConvite?.({ escopo: r.escopo, convite: r.convite, maquinaId: emitida.dados.id });
          } catch (e) {
            log("aviso", "pareada_por_convite_falhou", { pessoa_id: r.escopo.pessoaId, chave_id: emitida.dados.id, erro: e instanceof Error ? e.message : String(e) });
          }
        }
        ctx.json(201, { chave: emitida.chave, machineId: emitida.dados.id, papel: r.papel });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/dispositivos\/(?<codigo>[^/]+)$/,
      async handler(ctx) {
        const pedido = deps.dispositivo.ver({ codigoPessoa: decodeURIComponent(ctx.params.codigo ?? ""), escopo: ctx.escopo });
        if (!pedido) { ctx.json(404, { codigo: "pareamento_invalido" }); return; }
        ctx.json(200, pedido);
      },
    },
    {
      metodo: "POST", acao: "maquinas.aprovar_dispositivo",
      padrao: /^\/maquinas\/dispositivos\/(?<codigo>[^/]+)\/aprovar$/,
      async handler(ctx) {
        const ok = deps.dispositivo.aprovar({ codigoPessoa: decodeURIComponent(ctx.params.codigo ?? ""), escopo: ctx.escopo });
        if (!ok) { ctx.json(404, { codigo: "pareamento_invalido" }); return; }
        ctx.json(200, { ok: true });
      },
    },
    // ── ADR-090: as máquinas da pessoa e onde cada bot trabalha ──────────────────────────────────────────────────────
    {
      metodo: "GET",
      padrao: /^\/maquinas$/,
      async handler(ctx) {
        const { chaves, padraoId, nuvem } = await deps.dentro(ctx.escopo, async (d) => ({ chaves: await d.repos.maquinaTokens.listar(), padraoId: (await d.repos.preferencias.buscar()).maquinaPadraoId ?? null, nuvem: await nuvemDa(d) }));
        const vivas = new Map((deps.maquinasVivas?.(ctx.escopo) ?? []).map((m) => [m.machineId, m]));
        const maquinas: MaquinaDto[] = chaves.filter((c) => c.revogadaEm === null).map((c) => {
          const viva = vivas.get(c.id);
          // ADR-102 (R2 da revisão): o nome da chave, que a pessoa pode trocar; o hostname anunciado só o batiza no pareamento.
          return { id: c.id, nome: c.nome, prefixo: c.prefixo, criadaEm: c.criadaEm, ultimoUsoEm: c.ultimoUsoEm, conectada: !!viva, plataforma: viva?.plataforma ?? null, ias: viva?.ias ?? {}, iasDetalhe: viva?.iasDetalhe ?? {}, gh: viva?.gh ?? false, papel: c.papel ?? "motor", ...(viva?.atualizaIas ? { atualizaIas: true } : {}), ...(nuvem.has(c.id) ? { nuvem: nuvem.get(c.id) } : {}) };
        });
        // ADR-092: com o servidor no Mac (modo local), o bot sem máquina roda neste Mac ("Este Mac" na tela), e a VM chega à
        // API deste Mac por um túnel SSH — a tela mostra o endereço da API, que é o que o motor guarda.
        ctx.json(200, { maquinas, padraoId: maquinas.some((m) => m.id === padraoId) ? padraoId : null, ...(deps.servidorNoMac ? { servidorNoMac: deps.servidorNoMac } : {}) });
      },
    },
    {
      metodo: "PUT", acao: "maquinas.definir_padrao",
      padrao: /^\/maquinas\/padrao$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        // ADA-243: o executor único, o mesmo do gerir_maquinas (paridade tela × chat).
        const r = await deps.dentro(ctx.escopo, async (d) => EXECUTORES_MAQUINAS["maquinas.definir_padrao"](d, { maquinaId: corpo.maquinaId }));
        ctx.json(200, { padraoId: r.data.padraoId });
      },
    },
    {
      metodo: "PUT", acao: "maquinas.escolher_do_bot",
      padrao: /^\/agentes\/(?<id>[^/]+)\/maquina$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const alterados = await deps.dentro(ctx.escopo, async (d) => d.repos.agentes.definirMaquina([ctx.params.id ?? ""], corpo.maquinaId === null ? null : await exigirChaveViva(d, corpo.maquinaId)));
        if (alterados.length === 0) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
        ctx.json(200, { agente: alterados[0] });
      },
    },
    {
      metodo: "PUT", acao: "maquinas.definir_bots",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/bots$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { agentes?: unknown };
        if (!Array.isArray(corpo.agentes) || corpo.agentes.length > 200 || !corpo.agentes.every((a) => typeof a === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "agentes" });
        const ids = corpo.agentes as string[];
        const alterados = await deps.dentro(ctx.escopo, async (d) => d.repos.agentes.definirMaquina(ids, await exigirChaveViva(d, ctx.params.id)));
        ctx.json(200, { movidos: alterados.length });
      },
    },
    {
      metodo: "POST", acao: "maquinas.rodar_desta_vez",
      padrao: /^\/conversas\/(?<id>[^/]+)\/rodar-desta-vez$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown; turnoId?: unknown; contaId?: unknown };
        // NOD-280 (definido em 2026-10-15): com o turno da nota, refaz aquele turno na máquina escolhida (o interrompido não é
        // pendente: o UPDATE abaixo não o alcançava). Sem `turnoId` (cliente antigo), o de antes: só os pendentes.
        if (corpo.turnoId !== undefined && corpo.turnoId !== null) {
          const conversaId = assertUuid(ctx.params.id, "conversa");
          const turnoId = assertUuid(corpo.turnoId, "turno");
          const maquinaId = assertUuid(corpo.maquinaId, "máquina");
          const contaId = corpo.contaId === undefined || corpo.contaId === null ? null : assertUuid(corpo.contaId, "conta");
          const r = await deps.dentro(ctx.escopo, (d) => executar(d, (dd, i) => rodarDestaVezComConta(dd, i), { conversaId, turnoId, maquinaId, contaId }));
          ctx.json(200, { turnos: r.turnoId ? 1 : 0, ...r });
          return;
        }
        const n = await deps.dentro(ctx.escopo, async (d) => d.repos.turnos.rodarDestaVez(ctx.params.id ?? "", await exigirChaveViva(d, corpo.maquinaId)));
        log("info", "turno_rodar_desta_vez", { pessoa_id: ctx.escopo.pessoaId, conversa_id: ctx.params.id, turnos: n });
        ctx.json(200, { turnos: n });
      },
    },
    {
      // NOD-314 (definido em 2026-10-20): "Rodar em <outra> desta vez" no topo da task que espera uma máquina sem contato.
      // Só os turnos AINDA pendentes do trabalho vão para a máquina escolhida, uma vez; a máquina fixa do bot não muda.
      // A máquina precisa ser da pessoa (404) e ter contato recente (409 maquina_sem_contato); sem pendente, 409 nada_na_fila.
      metodo: "POST", acao: "maquinas.rodar_desta_vez",
      padrao: /^\/trabalhos\/(?<id>[^/]+)\/rodar-desta-vez$/,
      async handler(ctx) {
        const trabalhoId = assertUuid(ctx.params.id, "trabalho");
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const maquinaId = assertUuid(corpo.maquinaId, "máquina");
        // QA do NOD-314: o trabalho inexistente é 404 antes de olhar a máquina; o 2º clique (os pendentes já iam para ela)
        // é 200 com `motivo: "ja_refeito"` — o mesmo código da nota da conversa, que a tela trata como neutro.
        // QA do NOD-314 (2026-10-21): e a máquina precisa ter conta da IA do turno (409 conta_fora_da_maquina).
        const r = await deps.dentro(ctx.escopo, async (d) => {
          if (!(await d.repos.trabalhos.buscar(trabalhoId))) throw new ErroDeDominio("nao_encontrado", { cause: "trabalho" });
          return rodarTrabalhoDestaVez(d, { trabalhoId, maquinaId: await exigirChaveViva(d, maquinaId) });
        });
        const motivo = typeof r === "string" ? r : r.movidos > 0 ? null : r.jaNela > 0 ? "ja_refeito" : "nada_na_fila";
        log("info", "turno_rodar_desta_vez", { pessoa_id: ctx.escopo.pessoaId, trabalho_id: trabalhoId, maquina_id: maquinaId, turnos: typeof r === "string" ? 0 : r.movidos, motivo });
        if (r === "maquina_sem_contato") { ctx.json(409, { codigo: r, mensagem: "Essa máquina também está sem contato agora. Escolha outra ou espere ela voltar." }); return; }
        if (r === "conta_fora_da_maquina") { ctx.json(409, { codigo: r, mensagem: "Essa máquina não tem uma conta pronta da IA desta task. Escolha outra ou espere a máquina do bot voltar." }); return; }
        if (motivo === "nada_na_fila") { ctx.json(409, { codigo: motivo, mensagem: "Esta task não tem nada esperando na fila agora." }); return; }
        ctx.json(200, { turnos: r.movidos, motivo });
      },
    },
  ];
}
