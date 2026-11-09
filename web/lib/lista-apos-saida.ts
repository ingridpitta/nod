import type { PerfilCelular, SecaoEspaco } from "../estado/reducer.ts";

/**
 * NOD-382 (revisão 7): diz se a pessoa abriu ou fechou um perfil enquanto o pedido de excluir/ocultar corria. A frota que
 * zera o perfil (NOD-370) não conta: ela não passa por abrirPerfil/fecharPerfil, que são os que chamam `mexeu`.
 */
export type MarcaDoPerfil = { mexeu(): void; marca(): number; intacto(m: number): boolean };

export function criarMarcaDoPerfil(): MarcaDoPerfil {
  let versao = 0;
  return { mexeu() { versao++; }, marca: () => versao, intacto: (m) => m === versao };
}

export type PlanoDaSaida = { fecharPerfil: boolean; limparPainel: boolean; abrirEspaco: SecaoEspaco | null; abrirLista: boolean };

/**
 * NOD-382 (revisão 8): o que fazer quando o pedido de excluir/ocultar volta. `perfil` é o perfil do bot no início do
 * pedido; `intacto`, se a pessoa não abriu nem fechou perfil no meio (MarcaDoPerfil); `perfilAgora`, o id do perfil
 * aberto agora (null se a frota já o zerou); `espacoAberto`, se Seu espaço está aberto. null = ficar onde está.
 */
export function planoDaSaida(botId: string, perfil: PerfilCelular | null, intacto: boolean, perfilAgora: string | null, espacoAberto: boolean): PlanoDaSaida | null {
  if (!perfil || perfil.agenteId !== botId || !intacto) return null;
  // Com o perfil ainda aberto, o fecharPerfil leva à origem (e reabre Seu espaço); zerado pela frota, o painel fica a limpar.
  const fechar = perfilAgora === botId;
  const doEspaco = perfil.origem === "espaco";
  return {
    fecharPerfil: fechar,
    limparPainel: perfilAgora === null,
    abrirEspaco: doEspaco && perfil.espaco && !fechar && !espacoAberto ? perfil.espaco : null,
    abrirLista: !doEspaco,
  };
}
