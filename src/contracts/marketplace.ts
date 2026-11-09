export type AppMarketplace = {
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;
  /**
   * definido em 2026-09-24 (ADR-044): o que um pedido SÓ DE LEITURA deixa de fora, em verbos que a
   * pessoa reconhece. Curado à mão; app sem curadoria cai na contagem das ações de escrita do catálogo.
   */
  naoIncluiNaLeitura?: readonly string[];
  /**
   * definido em 2026-09-24 (ADR-048): app que o próprio nod conecta (hoje só o GitHub). Aparece na
   * grade mesmo sem auth config no Composio — o Composio é só um dos jeitos de conectá-lo.
   */
  nativo?: true;
  /**
   * definido em 2026-09-30 (ADR-062, pergunta do Marlon "é o modelo que considera ou é hard coded?"): o que o app
   * devolve é escrito SÓ por gente da empresa (workspace fechado), então ler ele não é "conteúdo de fora" (ADR-026).
   * Curadoria à mão, nunca do modelo — é justamente o modelo que um texto de fora tentaria convencer. Sem a marca,
   * o app conta como de fora (falha fechada): e-mail, GitHub, Drive, agenda (convite de gente de fora), web e todo
   * app novo até alguém revisar. Risco aceito: canal do Slack compartilhado com gente de fora (Slack Connect).
   */
  conteudoInterno?: true;
};

/**
 * definido em 2026-09-17: catálogo Composio; a pessoa autoriza cada app em login separado.
 * revisto em 2026-09-21 (ADR-041): deixou de ser O catálogo e virou a CURADORIA. Quem diz o que
 * existe é o `GET /auth_configs` do Composio; esta lista dá nome, descrição e categoria em
 * português a quem já foi curado, e é o piso quando a chamada ao provedor falha. App configurado
 * no painel e ausente daqui aparece com o nome do provedor e a descrição genérica de CATEGORIA_PADRAO.
 */
export const APPS_MARKETPLACE: readonly AppMarketplace[] = [
  { slug: "slack", nome: "Slack", descricao: "Encontre conversas, acompanhe sua equipe e prepare mensagens.", categoria: "Comunicação", conteudoInterno: true },
  { slug: "github", nome: "GitHub", descricao: "Revise pull requests, leia código e acompanhe issues. Usa o gh já logado nesta máquina quando houver.", categoria: "Desenvolvimento", naoIncluiNaLeitura: ["comentar", "revisar pull requests"], nativo: true },
  { slug: "gmail", nome: "Gmail", descricao: "Leia e organize emails, prepare respostas e acompanhe sua caixa de entrada.", categoria: "Comunicação", naoIncluiNaLeitura: ["enviar", "apagar", "arquivar"] },
  { slug: "notion", nome: "Notion", descricao: "Encontre documentos e mantenha as informações do time organizadas.", categoria: "Conhecimento", conteudoInterno: true },
  { slug: "linear", nome: "Linear", descricao: "Acompanhe projetos, organize issues e descubra o que está bloqueado.", categoria: "Projetos", conteudoInterno: true },
  { slug: "googlesheets", nome: "Google Sheets", descricao: "Consulte planilhas, analise resultados e prepare relatórios.", categoria: "Produtividade" },
  { slug: "googlecalendar", nome: "Google Calendar", descricao: "Consulte sua agenda e organize compromissos.", categoria: "Produtividade" },
  { slug: "clickup", nome: "ClickUp", descricao: "Acompanhe tarefas, prazos e prioridades dos seus projetos.", categoria: "Projetos", conteudoInterno: true },
  // definido em 2026-09-21: os quatro auth configs que existiam no painel e não tinham curadoria.
  { slug: "supabase", nome: "Supabase", descricao: "Consulte tabelas, inspecione dados e acompanhe o estado do banco.", categoria: "Desenvolvimento" },
  { slug: "sentry", nome: "Sentry", descricao: "Investigue erros em produção, veja o impacto e priorize correções.", categoria: "Desenvolvimento" },
  { slug: "googledrive", nome: "Google Drive", descricao: "Encontre arquivos, leia documentos e organize as pastas do time.", categoria: "Conhecimento" },
  { slug: "github_mcp", nome: "GitHub MCP", descricao: "Acesso ao GitHub pelo servidor MCP próprio, com as ferramentas que você configurou.", categoria: "Desenvolvimento" },
];

/** O que um app sem curadoria recebe: some da grade nunca, mas também não inventa descrição. */
export const CATEGORIA_PADRAO = "Integrações";
export const DESCRICAO_PADRAO = "Conecte para dar a este app as ferramentas que seus bots podem usar.";

/** Um app do marketplace já mesclado com o catálogo do provedor (src/domain/catalogo-marketplace.ts). */
export type AppComLogo = AppMarketplace & {
  logo: string | null;
  /**
   * definido em 2026-09-29 (ADR-057): veio do catálogo público do Composio, com login gerenciado por
   * ele, sem curadoria e sem auth config no painel. A tela o mostra em "Mais apps", não no dia a dia.
   */
  doCatalogo?: true;
};
