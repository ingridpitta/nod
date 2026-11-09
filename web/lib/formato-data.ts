/**
 * Formatadores de data reaproveitados por (locale, opções). Construir um `Intl.DateTimeFormat` é caro;
 * formatar com um pronto, não. medido em 2026-09-30: `hora()` criando o formatador a cada chamada foi o
 * item mais caro do perfil do Chrome (42 s de CPU de 118 s) com 8 bots escrevendo ao mesmo tempo e uma
 * conversa de 200 mensagens aberta (scripts/carga-tela). Sem `timeZone`, o formatador fica com o fuso
 * da máquina de quando foi criado: trocar o fuso do sistema com o Nod aberto só vale depois de recarregar.
 */
const formatadores = new Map<string, Intl.DateTimeFormat>();

export function formatoData(locale: string, opcoes: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const chave = `${locale}|${JSON.stringify(opcoes)}`;
  let f = formatadores.get(chave);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opcoes);
    formatadores.set(chave, f);
  }
  return f;
}
