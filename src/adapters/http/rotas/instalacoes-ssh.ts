import { METODOS_SSH, type MetodoSsh } from "../../../contracts/instalacoes-ssh.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { credencialValida, hostValido, portaValida, usuarioValido, type InstalacoesPorSsh } from "../../../services/instalacoes-por-ssh.ts";
import type { PareamentoDispositivo } from "../../../services/pareamento-dispositivo.ts";
import { assertUuid } from "../../../use-cases/apoio-l7.ts";
import type { Ctx, Rota } from "../roteador.ts";
import type { DentroDeTx } from "./dentro-de-tx.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): a instalação da máquina "só computador" por SSH, pela tela. Rotas de PESSOA (cookie),
 * só no modo compartilhado (no local, ADR-092, a opção não aparece). O pedido vive em memória (instalacoes-por-ssh.ts);
 * aqui só o banco do que é dela: a só-computador viva (para o "Substituir") e a impressão guardada do endereço.
 *
 * A credencial chega cifrada e vai para o serviço — nunca para log, nem o tamanho.
 */
export type DepsRotasInstalacoes = {
  dentro: DentroDeTx;
  instalacoes: InstalacoesPorSsh;
  dispositivo: PareamentoDispositivo;
  /**
   * NOD_URL_PUBLICA: o endereço do nod que a máquina nova alcança. NOD-344: ausente = null, e a instaladora usa a origem
   * a que ela mesma está pareada. Nunca o `Host`/`X-Forwarded-Host` de quem pediu: ele vai para o script que roda como
   * root na máquina nova, e o header é de quem chama.
   */
  urlPublica?: string;
};

function exigirPedido(deps: DepsRotasInstalacoes, ctx: Ctx) {
  const id = assertUuid(ctx.params.id, "instalação");
  const p = deps.instalacoes.ver(ctx.escopo, id);
  if (!p) throw new ErroDeDominio("nao_encontrado", { cause: "instalação" });
  return p;
}

export function rotasInstalacoesSsh(deps: DepsRotasInstalacoes): Rota[] {
  return [
    {
      // As máquinas que podem instalar agora (puxaram nos últimos 15 s), a mais recente primeiro: "Tentar de outra máquina".
      metodo: "GET",
      padrao: /^\/maquinas\/ssh\/instaladoras$/,
      async handler(ctx) {
        const vivas = deps.instalacoes.instaladoras(ctx.escopo);
        const nomes = vivas.length ? await deps.dentro(ctx.escopo, async (d) => new Map((await d.repos.maquinaTokens.listar()).filter((c) => c.revogadaEm === null).map((c) => [c.id, c.nome]))) : new Map<string, string>();
        ctx.json(200, { instaladoras: vivas.filter((i) => nomes.has(i.machineId)).map((i) => ({ id: i.machineId, nome: nomes.get(i.machineId)!, plataforma: i.plataforma })) });
      },
    },
    {
      metodo: "POST", acao: "maquinas.instalar_ssh",
      padrao: /^\/maquinas\/ssh$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as Record<string, unknown>;
        const host = hostValido(corpo.host);
        if (!host) throw new ErroDeDominio("entrada_invalida", { cause: "host" });
        const porta = portaValida(corpo.porta);
        if (porta === null) throw new ErroDeDominio("entrada_invalida", { cause: "porta" });
        const metodo = METODOS_SSH.find((m) => m === corpo.metodo) as MetodoSsh | undefined;
        if (!metodo) throw new ErroDeDominio("entrada_invalida", { cause: "método" });
        // No modo apelido o usuário vem do ~/.ssh/config do Mac; o campo é opcional (vazio = o do apelido).
        const usuario = metodo === "apelido" && (corpo.usuario === undefined || corpo.usuario === null || corpo.usuario === "") ? "" : usuarioValido(corpo.usuario);
        if (usuario === null) throw new ErroDeDominio("entrada_invalida", { cause: "usuário" });
        const origemId = corpo.origemId === undefined || corpo.origemId === null ? null : assertUuid(corpo.origemId, "máquina de origem");
        const substituir = corpo.substituir === true;
        const servidor = deps.urlPublica ?? null;

        const { vivo, impressaoConhecida } = await deps.dentro(ctx.escopo, async (d) => ({
          vivo: await d.repos.maquinaTokens.computadorVivo(d.agora()),
          impressaoConhecida: (await d.repos.maquinasSsh.doEndereco(host, porta))?.impressaoHost ?? null,
        }));
        // Uma só-computador por pessoa: a tela pergunta "Substituir?" (a anterior é revogada quando a nova parear).
        if (vivo && !substituir) { ctx.json(409, { codigo: "ja_tem_computador", maquina: vivo }); return; }

        const r = deps.instalacoes.pedir({
          escopo: ctx.escopo, origemId, host, porta, usuario, metodo, impressaoConhecida, servidor,
          criarConvite: () => deps.dispositivo.criarConvite(ctx.escopo, { papel: "computador", autoAprovar: true, substituir }).convite,
        });
        if (r === "sem_instaladora") { ctx.json(409, { codigo: "sem_instaladora", mensagem: "Nenhuma máquina sua está ligada para instalar. Abra o app do Mac ou ligue um motor." }); return; }
        if (r === "muitos_pedidos") { ctx.json(429, { codigo: "muitos_pedidos", mensagem: "Você já tem instalações demais abertas. Termine ou cancele uma delas." }); return; }
        if (r === "instaladora_antiga") { ctx.json(409, { codigo: "instaladora_antiga", mensagem: "A máquina que vai instalar está com o app antigo. Atualize o app dela e tente de novo." }); return; }
        if (r === "apelido_so_no_mac") throw new ErroDeDominio("entrada_invalida", { cause: "apelido só pelo Mac" });
        log("info", "instalacao_ssh_pedida", { pessoa_id: ctx.escopo.pessoaId, instalacao_id: r.id, origem_id: r.origemId, metodo, reinstalacao: impressaoConhecida !== null, substituir });
        ctx.json(201, r);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/ssh\/(?<id>[^/]+)$/,
      async handler(ctx) {
        ctx.json(200, exigirPedido(deps, ctx));
      },
    },
    {
      metodo: "POST", acao: "maquinas.credencial_ssh",
      padrao: /^\/maquinas\/ssh\/(?<id>[^/]+)\/credencial$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { cifrado?: unknown };
        const cifrado = credencialValida(corpo.cifrado);
        if (!cifrado) throw new ErroDeDominio("entrada_invalida", { cause: "credencial cifrada" });
        const p = exigirPedido(deps, ctx);
        const r = deps.instalacoes.entregarCredencial(ctx.escopo, p.id, cifrado);
        if (r === "sem_pedido") throw new ErroDeDominio("nao_encontrado", { cause: "instalação" });
        if (r === "nao_pede") { ctx.json(409, { codigo: "credencial_nao_pedida" }); return; }
        ctx.json(204, null);
      },
    },
    {
      metodo: "POST", acao: "maquinas.confiar_ssh",
      padrao: /^\/maquinas\/ssh\/(?<id>[^/]+)\/confiar-nova$/,
      async handler(ctx) {
        const p = exigirPedido(deps, ctx);
        const r = deps.instalacoes.confiarNova(ctx.escopo, p.id);
        if (!r) { ctx.json(409, { codigo: "estado_invalido" }); return; }
        // A impressão guardada do endereço passa a ser a nova (sem linha = primeira instalação que mudou no meio: nada a trocar).
        await deps.dentro(ctx.escopo, (d) => d.repos.maquinasSsh.trocarImpressao(r.host, r.porta, r.impressao, d.agora()));
        log("info", "instalacao_ssh_confiou_na_nova", { pessoa_id: ctx.escopo.pessoaId, instalacao_id: p.id });
        ctx.json(204, null);
      },
    },
    {
      metodo: "POST", acao: "maquinas.cancelar_ssh",
      padrao: /^\/maquinas\/ssh\/(?<id>[^/]+)\/cancelar$/,
      async handler(ctx) {
        const p = exigirPedido(deps, ctx);
        const convite = deps.instalacoes.cancelar(ctx.escopo, p.id);
        if (!convite) { ctx.json(409, { codigo: "estado_invalido" }); return; }
        // NOD-94 (QA): o script pode seguir rodando lá; o convite morto impede que ele pareie depois do cancelar.
        deps.dispositivo.revogarConvite(convite);
        log("info", "instalacao_ssh_cancelada", { pessoa_id: ctx.escopo.pessoaId, instalacao_id: p.id });
        ctx.json(204, null);
      },
    },
  ];
}
