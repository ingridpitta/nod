/**
 * Menu do app em pt-BR (definido em 2026-10-05, NOD-174). Os `role` do Electron trazem rótulos em inglês ("Quit nod",
 * "Edit", "Toggle Developer Tools"); aqui todo item com `role` ganha `label` explícito e mantém o `role` para o
 * comportamento nativo (Copiar e Colar seguem funcionando). Sem Electron em tempo de execução: só o tipo, testável no
 * vitest (tests/unit/desktop/menu.test.ts). Ferramentas de desenvolvedor só fora do app empacotado.
 */
import type { MenuItemConstructorOptions } from "electron";
import { TEXTOS_ATUALIZACAO, type EstadoAtualizacaoApp } from "./atualizacao.ts";

export type AcaoDeBusca = "abrir" | "proxima" | "anterior";
export type AcoesDoMenu = { conexao: () => void; definirAvisos: (ligado: boolean) => void; exportarDiagnostico: () => void; buscar?: (acao: AcaoDeBusca) => void; procurarAtualizacao?: () => void; reiniciarParaAtualizar?: () => void };
export type OpcoesDoMenu = { avisos: boolean; empacotado: boolean; atualizacao?: EstadoAtualizacaoApp };

/** NOD-132: o item da atualização do app no menu nod, conforme o estado (desligada mostra o motivo, desabilitado). */
export function itensDaAtualizacao(estado: EstadoAtualizacaoApp | undefined, acoes: AcoesDoMenu): MenuItemConstructorOptions[] {
  if (!estado) return [];
  switch (estado.fase) {
    case "desligada": return [{ label: estado.motivo, enabled: false }];
    case "procurando": return [{ label: TEXTOS_ATUALIZACAO.procurando, enabled: false }];
    case "baixando": return [{ label: TEXTOS_ATUALIZACAO.baixando, enabled: false }];
    case "pronta": return [{ label: TEXTOS_ATUALIZACAO.reiniciar(estado.versao), click: () => acoes.reiniciarParaAtualizar?.() }];
    case "ociosa":
    case "erro": return [{ label: TEXTOS_ATUALIZACAO.procurar, click: () => acoes.procurarAtualizacao?.() }];
  }
}

/** O idioma que o Chromium usa no menu de contexto, nos diálogos nativos e na validação da página. */
export const IDIOMA_DO_APP = "pt-BR";

export function templateDoMenu(opcoes: OpcoesDoMenu, acoes: AcoesDoMenu): MenuItemConstructorOptions[] {
  const visualizar: MenuItemConstructorOptions[] = [
    { label: "Recarregar", role: "reload" },
    ...(opcoes.empacotado ? [] : [{ label: "Ferramentas de desenvolvedor", role: "toggleDevTools" } satisfies MenuItemConstructorOptions]),
    { type: "separator" },
    { label: "Tamanho real", role: "resetZoom" },
    { label: "Aumentar", role: "zoomIn" },
    { label: "Diminuir", role: "zoomOut" },
    { type: "separator" },
    { label: "Tela cheia", role: "togglefullscreen" },
  ];
  return [
    {
      label: "nod",
      submenu: [
        { label: "Conexão / verificar conta de IA", click: () => acoes.conexao() },
        // NOD-138: só pelo menu nativo, funciona na tela de conexão e com a janela web fora do ar.
        { label: "Exportar diagnóstico…", click: () => acoes.exportarDiagnostico() },
        ...itensDaAtualizacao(opcoes.atualizacao, acoes),
        { type: "separator" },
        { label: "Avisos no Mac", type: "checkbox", checked: opcoes.avisos, click: (item) => acoes.definirAvisos(item.checked) },
        { type: "separator" },
        { label: "Sair do nod", role: "quit" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { label: "Desfazer", role: "undo" },
        { label: "Refazer", role: "redo" },
        { type: "separator" },
        { label: "Recortar", role: "cut" },
        { label: "Copiar", role: "copy" },
        { label: "Colar", role: "paste" },
        { label: "Selecionar tudo", role: "selectAll" },
        // NOD-42 (definido em 2026-10-28): Editar › Buscar. No Linux e no Windows, `registerAccelerator: false` mostra o
        // atalho sem tomá-lo: a tecla chega à página, que decide se abre (só na conversa, na sala e na task). No Mac a opção
        // não vale e a tecla pode chegar pelas duas vias: a página ignora o eco (`ecoDoMenu`, web/lib/descoberta-da-busca.ts).
        ...(acoes.buscar ? [
          { type: "separator" },
          {
            label: "Buscar",
            submenu: [
              { label: "Buscar", accelerator: "CmdOrCtrl+F", registerAccelerator: false, click: () => acoes.buscar?.("abrir") },
              { label: "Buscar próxima", accelerator: "CmdOrCtrl+G", registerAccelerator: false, click: () => acoes.buscar?.("proxima") },
              { label: "Buscar anterior", accelerator: "Shift+CmdOrCtrl+G", registerAccelerator: false, click: () => acoes.buscar?.("anterior") },
            ],
          },
        ] satisfies MenuItemConstructorOptions[] : []),
      ],
    },
    { label: "Visualizar", submenu: visualizar },
  ];
}
