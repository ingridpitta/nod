# Paridade tela × chat

<!-- Gerado por `npm run paridade` a partir de src/domain/acoes/ (NOD-391, ADR-135). Não edite à mão: a catraca (tests/conformidade/paridade.test.ts) compara. -->

Ações de pessoa que mudam algo: **197**, mais 3 só de leitura. No chat: **74 vivas**, 3 parciais, 89 faltando e 34 que nunca vão para o chat. Piso de vivas: 74.

Estados: **vivo** = o chat faz pelo mesmo executor da tela, com teste de contrato; **parcial** = o chat faz, mas diverge ou falta parâmetro; **falta** = a onda dona ainda vai ligar; **nunca** = exceção escrita.

## bots

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `bots.criar` | Criar um bot | muda | vivo (`gerir_bots criar`) | `POST ^\/agentes$` |
| `bots.duplicar` | Duplicar um bot | muda | vivo (`gerir_bots duplicar`) | `POST ^\/agentes\/(?<id>[^/]+)\/duplicar$` |
| `bots.editar` | Editar o perfil de um bot | muda | vivo (`gerir_bots editar`) | `PATCH ^\/agentes\/(?<id>[^/]+)$` |
| `bots.mover` | Mover um bot de time (e organizar a barra lateral) | muda | vivo (`gerir_bots mover`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/organizacao$`<br>`POST ^\/agentes\/mover$` |
| `bots.excluir` | Excluir um bot (e desligar o computador dele) | arriscada | vivo (`gerir_bots excluir`) | `DELETE ^\/agentes\/(?<id>[^/]+)$` |
| `bots.mudar_modo` | Mudar o modo de aprovação de um bot | arriscada | vivo (`gerir_bots mudar_modo`) | `POST ^\/agentes\/(?<id>[^/]+)\/modo-aprovacao$` |
| `bots.restaurar_versao` | Restaurar uma versão do perfil de um bot | muda | vivo (`gerir_bots restaurar_versao`) | `POST ^\/agentes\/(?<id>[^/]+)\/perfil\/versoes\/(?<versao>[0-9]+)\/restaurar$` |
| `bots.restaurar` | Restaurar um bot excluído | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/restaurar$` |
| `bots.fixar` | Fixar um bot no topo | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/fixar$` |
| `bots.ocultar` | Ocultar um bot da barra | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/ocultar$` |
| `bots.definir_inteligencia` | Escolher a IA, o modelo e o raciocínio de um bot | muda | falta (NOD-393) | `PUT ^\/agentes\/(?<id>[^/]+)\/inteligencia$` |
| `bots.decidir_troca_de_ia` | Decidir o aviso de troca de IA de um bot | muda | falta (NOD-400) | `POST ^\/agentes\/(?<id>[^/]+)\/troca-de-ia$` |
| `bots.mudar_voz` | Escolher a voz de um bot | muda | falta (NOD-397) | `PATCH ^\/agentes\/(?<id>[^/]+)\/voz$` |
| `bots.cobrar_colega` | Cobrar ou desistir da espera por um colega | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/esperas-de-colega\/(?<tarefa>[^/]+)\/(?<acao>cobrar\|desistir)$` |

## memoria

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `memoria.criar` | Anotar uma memória no bot | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/memoria$` |
| `memoria.editar` | Editar uma memória do bot | muda | falta (NOD-393) | `PATCH ^\/agentes\/(?<id>[^/]+)\/memoria\/(?<mid>[^/]+)$` |
| `memoria.apagar` | Apagar uma memória do bot | arriscada | falta (NOD-393) | `DELETE ^\/agentes\/(?<id>[^/]+)\/memoria\/(?<mid>[^/]+)$` |
| `memoria.revisar_diario` | Revisar o diário da memória | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/memoria\/diario\/revisar$` |
| `memoria.desfazer_diario` | Desfazer uma entrada do diário da memória | muda | falta (NOD-393) | `POST ^\/agentes\/(?<id>[^/]+)\/memoria\/diario\/(?<eid>[^/]+)\/desfazer$` |

## rotinas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `rotinas.criar` | Criar uma rotina num bot | muda | parcial (`gerir_bots criar_rotina`): a tela manda fonte, limites e política sem dado; o lote preenche com padrões e não tem teste de contrato | `POST ^\/rotinas$` |
| `rotinas.executar` | Rodar uma rotina agora | pessoa_confirma | vivo (`executar_rotina`) | `POST ^\/rotinas\/(?<id>[^/]+)\/executar$` |
| `rotinas.pausar` | Pausar uma rotina (com data de volta opcional) | muda | vivo (`pausar_rotina`) | `POST ^\/rotinas\/(?<id>[^/]+)\/pausar$` |
| `rotinas.ativar` | Ativar uma rotina | muda | vivo (`reativar_rotina`) | `POST ^\/rotinas\/(?<id>[^/]+)\/ativar$` |
| `rotinas.mudar_ritmo` | Mudar o ritmo de uma rotina | muda | falta (NOD-393) | `POST ^\/rotinas\/(?<id>[^/]+)\/ritmo$` |
| `rotinas.gerar_endereco` | Gerar novo endereço do webhook | muda | falta (NOD-393) | `POST ^\/rotinas\/(?<id>[^/]+)\/endereco$` |
| `rotinas.enviar_teste` | Enviar teste ao webhook | muda | falta (NOD-393) | `POST ^\/rotinas\/(?<id>[^/]+)\/testar-webhook$` |

## acessos

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `acessos.dar` | Dar a um bot acesso a um app (Nenhum / Ler / Ler e alterar) | muda | parcial (`gerir_bots dar_acesso`): o lote só concede (sem o nível Nenhum, sem revogar o que sobra) e passa pela decisão de acesso, não pelo executor da tela | `POST ^\/agentes\/(?<id>[^/]+)\/acessos$` |
| `acessos.dar_em_lote` | Dar o mesmo nível de um app a vários bots (ou a todos) de uma vez | muda | vivo (`gerir_acessos acessos_em_lote`) | `POST ^\/conectores\/(?<id>[^/]+)\/acessos\/lote$` |
| `acessos.desfazer_lote` | Desfazer um lote de acessos (até 24 horas) | muda | vivo (`gerir_acessos desfazer_acessos`) | `POST ^\/acessos\/lotes\/(?<id>[^/]+)\/desfazer$` |
| `acessos.conceder` | Conceder uma capacidade de um app a um bot | muda | falta (NOD-394) | `POST ^\/agentes\/(?<id>[^/]+)\/concessoes$` |
| `acessos.liberar` | Liberar num clique os apps que o bot ainda não tem | muda | falta (NOD-394) | `POST ^\/agentes\/(?<id>[^/]+)\/acessos\/liberar$` |
| `acessos.dispensar` | Dispensar a oferta de liberar apps | muda | falta (NOD-394) | `POST ^\/agentes\/(?<id>[^/]+)\/acessos\/dispensar$` |
| `acessos.revogar` | Revogar acessos de um bot | muda | falta (NOD-394) | `DELETE ^\/concessoes\/(?<id>[^/]+)$`<br>`POST ^\/agentes\/(?<id>[^/]+)\/concessoes\/revogar$` |

## apps

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `apps.padrao` | Definir o padrão do app (o nível com que os bots novos nascem) | muda | vivo (`gerir_acessos padrao_acesso`) | `POST ^\/conectores\/(?<id>[^/]+)\/padrao$` |
| `apps.criar` | Adicionar um app (conector) | arriscada | falta (NOD-394) | `POST ^\/conectores$` |
| `apps.sondar` | Testar um app de novo | muda | falta (NOD-394) | `POST ^\/conectores\/(?<id>[^/]+)\/sondar$` |
| `apps.habilitar` | Ligar um app | muda | falta (NOD-394) | `POST ^\/conectores\/(?<id>[^/]+)\/habilitar$` |
| `apps.desabilitar` | Desligar um app | muda | falta (NOD-394) | `POST ^\/conectores\/(?<id>[^/]+)\/desabilitar$` |
| `apps.conectar` | Conectar um app do Marketplace | muda | falta (NOD-394) | `POST ^\/marketplace\/(?<slug>[a-z0-9-]+)\/conectar$` |
| `apps.verificar` | Verificar a conexão de um app do Marketplace | leitura | falta (NOD-394) | `POST ^\/marketplace\/(?<slug>[a-z0-9-]+)\/verificar$` |
| `apps.credenciais` | Guardar as credenciais de um app | pessoa_confirma | nunca: leva um segredo (token, chave ou credencial): só pelo campo seguro da tela, nunca pela conversa | `PATCH ^\/conectores\/(?<id>[^/]+)\/credenciais$` |
| `apps.configurar_marketplace` | Guardar a chave do Marketplace | pessoa_confirma | nunca: leva um segredo (token, chave ou credencial): só pelo campo seguro da tela, nunca pela conversa | `POST ^\/marketplace\/configurar$` |
| `apps.github_token` | Conectar o GitHub por token | pessoa_confirma | nunca: leva um segredo (token, chave ou credencial): só pelo campo seguro da tela, nunca pela conversa | `POST ^\/marketplace\/github\/token$` |
| `apps.github_app` | Conectar o GitHub por app instalado | pessoa_confirma | nunca: leva um segredo (token, chave ou credencial): só pelo campo seguro da tela, nunca pela conversa | `POST ^\/marketplace\/github\/app$` |

## contas_ia

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `contas_ia.ordenar` | Ordenar a fila das contas de IA | muda | falta (NOD-400) | `PUT ^\/contas-ia\/ordem$` |
| `contas_ia.mudar_modo` | Mudar o modo das contas de IA | muda | falta (NOD-400) | `PUT ^\/contas-ia\/modo$` |
| `contas_ia.editar` | Editar uma conta de IA | muda | falta (NOD-400) | `PATCH ^\/contas-ia\/(?<id>[^/]+)$` |
| `contas_ia.sair` | Sair de uma conta de IA | arriscada | falta (NOD-400) | `POST ^\/contas-ia\/(?<id>[^/]+)\/sair$` |
| `contas_ia.remover` | Remover uma conta de IA | arriscada | falta (NOD-400) | `DELETE ^\/contas-ia\/(?<id>[^/]+)$` |
| `contas_ia.seguir` | Seguir com a próxima conta de IA | muda | falta (NOD-400) | `POST ^\/contas-ia\/(?<id>[^/]+)\/seguir$` |
| `contas_ia.tentar_de_novo` | Tentar a conta de IA de novo | muda | falta (NOD-400) | `POST ^\/contas-ia\/(?<id>[^/]+)\/tentar-de-novo$` |
| `contas_ia.entrar` | Entrar numa IA numa máquina | muda | falta (NOD-400) | `POST ^\/maquinas\/(?<id>[^/]+)\/logins$` |
| `contas_ia.codigo_do_login` | Mandar o código do login da IA | pessoa_confirma | falta (NOD-400) | `POST ^\/maquinas\/(?<id>[^/]+)\/logins\/(?<login>[^/]+)\/codigo$` |
| `contas_ia.cancelar_login` | Cancelar o login da IA | muda | falta (NOD-400) | `POST ^\/maquinas\/(?<id>[^/]+)\/logins\/(?<login>[^/]+)\/cancelar$` |
| `contas_ia.trocar_executor` | Trocar a IA deste Mac (modo local) | muda | falta (NOD-400) | `POST ^\/executor$` |

## maquinas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `maquinas.criar_chave` | Emitir uma chave de máquina | pessoa_confirma | nunca: a chave crua sai uma vez e é segredo: não pode ir para a conversa | `POST ^\/maquinas\/chaves$` |
| `maquinas.revogar_chave` | Revogar uma chave de máquina | arriscada | falta (NOD-396) | `DELETE ^\/maquinas\/chaves\/(?<id>[^/]+)$` |
| `maquinas.parear` | Gerar o código de pareamento de uma máquina | pessoa_confirma | nunca: pareamento: a pessoa confere o código no aparelho | `POST ^\/maquinas\/pareamentos$` |
| `maquinas.aprovar_dispositivo` | Aprovar um aparelho pelo código | pessoa_confirma | nunca: pareamento: a pessoa confere o código no aparelho | `POST ^\/maquinas\/dispositivos\/(?<codigo>[^/]+)\/aprovar$` |
| `maquinas.convidar` | Convidar uma máquina | muda | falta (NOD-396) | `POST ^\/maquinas\/convites$` |
| `maquinas.editar` | Renomear ou ajustar uma máquina | muda | falta (NOD-396) | `PATCH ^\/maquinas\/(?<id>[^/]+)$` |
| `maquinas.remover` | Remover o nod de um computador (os bots de lá passam para o padrão) | pessoa_confirma | vivo (`remover_computador remover_computador`) | `POST ^\/maquinas\/(?<id>[^/]+)\/remover$` |
| `maquinas.desconectar` | Desconectar uma máquina | arriscada | falta (NOD-396) | `POST ^\/maquinas\/(?<id>[^/]+)\/desconectar$` |
| `maquinas.atualizar_ia` | Atualizar a IA instalada numa máquina | muda | falta (NOD-396) | `POST ^\/maquinas\/(?<id>[^/]+)\/ias\/(?<ia>[^/]+)\/atualizar$` |
| `maquinas.definir_padrao` | Escolher a máquina padrão | muda | vivo (`gerir_maquinas`) | `PUT ^\/maquinas\/padrao$` |
| `maquinas.escolher_do_bot` | Escolher a máquina de um bot | muda | falta (NOD-396) | `PUT ^\/agentes\/(?<id>[^/]+)\/maquina$` |
| `maquinas.definir_bots` | Escolher os bots de uma máquina | muda | falta (NOD-396) | `PUT ^\/maquinas\/(?<id>[^/]+)\/bots$` |
| `maquinas.rodar_desta_vez` | Rodar desta vez noutra máquina | muda | falta (NOD-396) | `POST ^\/conversas\/(?<id>[^/]+)\/rodar-desta-vez$`<br>`POST ^\/trabalhos\/(?<id>[^/]+)\/rodar-desta-vez$` |
| `maquinas.instalar_ssh` | Instalar o nod numa máquina por SSH | arriscada | falta (NOD-396) | `POST ^\/maquinas\/ssh$` |
| `maquinas.credencial_ssh` | Mandar a senha ou a chave SSH | pessoa_confirma | nunca: senha ou chave SSH é segredo: só pelo campo seguro da tela | `POST ^\/maquinas\/ssh\/(?<id>[^/]+)\/credencial$` |
| `maquinas.confiar_ssh` | Confiar na nova impressão do servidor SSH | pessoa_confirma | falta (NOD-396) | `POST ^\/maquinas\/ssh\/(?<id>[^/]+)\/confiar-nova$` |
| `maquinas.cancelar_ssh` | Cancelar a instalação por SSH | muda | falta (NOD-396) | `POST ^\/maquinas\/ssh\/(?<id>[^/]+)\/cancelar$` |

## nuvem

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `nuvem.conectar_google` | Conectar a conta Google da nuvem | pessoa_confirma | nunca: login OAuth do Google: só no navegador da pessoa | `POST ^\/nuvem\/google$` |
| `nuvem.criar_maquina` | Criar uma máquina na nuvem | arriscada | falta (NOD-396) | `POST ^\/nuvem\/maquinas$` |
| `nuvem.excluir_maquina` | Excluir uma máquina da nuvem | arriscada | falta (NOD-396) | `DELETE ^\/nuvem\/maquinas\/(?<id>[^/]+)$` |
| `nuvem.dormir` | Pôr uma máquina da nuvem para dormir | muda | falta (NOD-396) | `POST ^\/nuvem\/maquinas\/(?<id>[^/]+)\/dormir$` |
| `nuvem.acordar` | Acordar uma máquina da nuvem | muda | falta (NOD-396) | `POST ^\/nuvem\/maquinas\/(?<id>[^/]+)\/acordar$` |
| `nuvem.dormir_apos` | Escolher quando a máquina da nuvem dorme | muda | falta (NOD-396) | `PUT ^\/nuvem\/maquinas\/(?<id>[^/]+)\/dormir-apos$` |

## computador

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `computador.operar` | Ligar, desligar ou reiniciar o computador | muda | falta (NOD-396) | `POST ^\/computador$` |
| `computador.trocar_lugar` | Mudar o computador de máquina | arriscada | falta (NOD-396) | `POST ^\/computador\/lugar$` |
| `computador.operar_do_bot` | Ligar, desligar ou reiniciar o computador de um bot | muda | falta (NOD-396) | `POST ^\/agentes\/(?<id>[^/]+)\/computador$` |
| `computador.usar_tela` | Usar a tela do computador com as próprias mãos | muda | nunca: são as mãos da pessoa no computador do bot | `POST ^\/agentes\/(?<id>[^/]+)\/computador\/acoes$` |

## conversas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `conversas.enviar` | Mandar uma mensagem | muda | nunca: é o próprio chat | `POST ^\/conversas\/(?<id>[^/]+)\/mensagens$` |
| `conversas.anexar` | Anexar um arquivo | muda | nunca: é o próprio chat | `POST ^\/conversas\/(?<id>[^/]+)\/anexos$` |
| `conversas.reagir` | Reagir a uma mensagem | muda | falta (NOD-397) | `PUT ^\/mensagens\/(?<id>[^/]+)\/reacoes$` |
| `conversas.desfazer_turno` | Desfazer os arquivos que o bot mudou num turno | arriscada | falta (NOD-397) | `POST ^\/conversas\/(?<id>[^/]+)\/turnos\/(?<turno>[^/]+)\/desfazer$` |
| `conversas.parar` | Parar o bot desta conversa | muda | falta (NOD-397) | `POST ^\/conversas\/(?<id>[^/]+)\/parar$` |
| `conversas.parar_tudo` | Parar todos os bots | muda | falta (NOD-397) | `POST ^\/parar$` |
| `conversas.nova_sessao` | Começar uma sessão nova | muda | falta (NOD-397) | `POST ^\/conversas\/(?<id>[^/]+)\/nova-sessao$` |
| `conversas.marcar_lida` | Marcar a conversa como lida | muda | vivo (`nao_lidos`) | `POST ^\/conversas\/(?<id>[^/]+)\/lida$` |
| `conversas.marcar_nao_lida` | Marcar a conversa como não lida | muda | vivo (`nao_lidos`) | `POST ^\/conversas\/(?<id>[^/]+)\/nao-lida$` |
| `conversas.marcar_tudo_lido` | Marcar tudo como lido | muda | vivo (`nao_lidos`) | `POST ^\/nao-lidos\/marcar-tudo$` |
| `conversas.desfazer_leitura` | Desfazer a marcação como lida | muda | vivo (`nao_lidos`) | `POST ^\/nao-lidos\/desfazer$`<br>`POST ^\/nao-lidos\/recibos\/(?<id>[^/]+)\/desfazer$` |
| `conversas.definir_pasta` | Escolher a pasta de trabalho da conversa | muda | falta (NOD-397) | `POST ^\/conversas\/(?<id>[^/]+)\/workspace$` |
| `conversas.criar_pasta` | Criar uma pasta de trabalho | muda | falta (NOD-397) | `POST ^\/conversas\/(?<id>[^/]+)\/workspace\/pastas$` |
| `conversas.tirar_pasta` | Tirar a pasta de trabalho da conversa | muda | falta (NOD-397) | `DELETE ^\/conversas\/(?<id>[^/]+)\/workspace$` |

## cartoes

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `cartoes.decidir` | Aprovar ou recusar um cartão | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/decisoes\/(?<id>[^/]+)\/decidir$` |
| `cartoes.responder` | Responder a uma pergunta do bot no cartão | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/decisoes\/(?<id>[^/]+)\/responder$` |
| `cartoes.reabrir` | Reabrir um cartão | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/decisoes\/(?<id>[^/]+)\/reabrir$` |
| `cartoes.dispensar` | Dispensar um cartão | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/decisoes\/(?<id>[^/]+)\/dispensar$` |
| `cartoes.confirmar_proposta` | Confirmar uma proposta | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/propostas\/(?<id>[^/]+)\/confirmar$` |
| `cartoes.recusar_proposta` | Recusar uma proposta | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/propostas\/(?<id>[^/]+)\/recusar$` |
| `cartoes.permitir_pasta` | Permitir uma pasta pedida pelo bot | pessoa_confirma | nunca: cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon) | `POST ^\/propostas\/(?<id>[^/]+)\/permitir-pasta$` |
| `cartoes.guardar_credencial` | Guardar a chave pedida pelo bot | pessoa_confirma | nunca: o valor é segredo: só pelo campo seguro do cartão | `POST ^\/propostas\/(?<id>[0-9a-f-]{36})\/credencial$` |

## turnos

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `turnos.retomar_decisao` | Retomar o turno de uma decisão | muda | falta (NOD-397) | `POST ^\/decisoes\/(?<id>[^/]+)\/retomar$` |
| `turnos.cancelar` | Cancelar um turno | muda | falta (NOD-397) | `POST ^\/turnos\/(?<id>[^/]+)\/cancelar$` |
| `turnos.retomar` | Retomar um turno interrompido | muda | falta (NOD-397) | `POST ^\/turnos\/(?<id>[^/]+)\/retomar$` |

## incidentes

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `incidentes.dispensar` | Dispensar um incidente | muda | falta (NOD-397) | `POST ^\/incidentes\/(?<id>[^/]+)\/dispensar$` |

## modo

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `modo.contestar` | Contestar uma ação que o modo aprovou sozinho | muda | falta (NOD-397) | `POST ^\/acoes-do-modo\/(?<id>[^/]+)\/contestar$` |

## salas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `salas.criar` | Criar uma sala | muda | falta (NOD-397) | `POST ^\/salas$` |
| `salas.adicionar_membro` | Pôr um bot numa sala | muda | falta (NOD-397) | `POST ^\/salas\/(?<id>[^/]+)\/membros$` |
| `salas.enviar` | Mandar uma mensagem numa sala | muda | nunca: é o próprio chat | `POST ^\/salas\/(?<id>[^/]+)\/mensagens$` |
| `salas.parar` | Parar a sala | muda | falta (NOD-397) | `POST ^\/salas\/(?<id>[^/]+)\/parar$` |

## trabalhos

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `trabalhos.parar` | Parar um trabalho | muda | falta (NOD-397) | `POST ^\/trabalhos\/(?<id>[^/]+)\/parar$` |
| `trabalhos.enviar` | Mandar uma mensagem num trabalho | muda | nunca: é o próprio chat | `POST ^\/trabalhos\/(?<id>[^/]+)\/mensagens$` |
| `trabalhos.depois` | Deixar um trabalho para depois | muda | falta (NOD-397) | `POST ^\/trabalhos\/(?<id>[^/]+)\/depois$` |
| `trabalhos.fazer_aqui` | Fazer um trabalho aqui | muda | falta (NOD-397) | `POST ^\/trabalhos\/(?<id>[^/]+)\/fazer-aqui$` |

## voz

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `voz.ligar` | Ligar para um bot | muda | falta (NOD-397) | `POST ^\/ligacoes$` |
| `voz.encerrar` | Encerrar a ligação | muda | falta (NOD-397) | `POST ^\/ligacoes\/(?<id>[^/]+)\/encerrar$` |
| `voz.continuar` | Continuar a ligação | muda | falta (NOD-397) | `POST ^\/ligacoes\/(?<id>[^/]+)\/continuar$` |
| `voz.apagar_falas` | Apagar as falas da ligação | arriscada | falta (NOD-397) | `DELETE ^\/ligacoes\/(?<id>[^/]+)\/falas$` |
| `voz.avaliar` | Avaliar a ligação | muda | falta (NOD-397) | `POST ^\/ligacoes\/(?<id>[^/]+)\/avaliacao$` |
| `voz.consentir` | Dar o consentimento de voz | pessoa_confirma | nunca: consentimento é ato da pessoa na tela, não um pedido ao bot | `POST ^\/voz\/consentimento$` |

## preferencias

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `preferencias.salvar` | Salvar as preferências | muda | falta (NOD-397) | `PUT ^\/preferencias$` |
| `preferencias.fechar_aviso` | Fechar um aviso | muda | nunca: estado da própria tela, sem efeito para os bots | `POST ^\/preferencias\/avisos-fechados$` |
| `preferencias.exibir_quadro` | Mudar o Exibir do quadro (a visão no celular, as recolhidas, o compacto e as Opções do quadro) | muda | vivo (`gerir_quadro`) | `PUT ^\/preferencias\/quadros\/(?<id>[^/]+)\/exibir$` |

## artefatos

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `artefatos.salvar_estado` | Salvar o que a pessoa marcou num artefato | muda | nunca: estado da própria tela, sem efeito para os bots | `PUT ^\/artefatos\/(?<id>[^/]+)\/estado$` |

## telemetria

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `telemetria.registrar` | Registrar linhas de telemetria da tela | muda | nunca: estado da própria tela, sem efeito para os bots | `POST ^\/telemetria\/linhas$`<br>`POST ^\/telemetria\/quadro$` |

## onboarding

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `onboarding.etapa` | Avançar uma etapa do onboarding | muda | nunca: passo do onboarding da tela; no chat, o mesmo efeito é bots.criar ou rotinas.criar | `POST ^\/onboarding\/etapa$` |
| `onboarding.concluir` | Concluir o onboarding | muda | nunca: passo do onboarding da tela; no chat, o mesmo efeito é bots.criar ou rotinas.criar | `POST ^\/onboarding\/concluir$` |
| `onboarding.bot` | Criar o primeiro bot no onboarding | muda | nunca: passo do onboarding da tela; no chat, o mesmo efeito é bots.criar ou rotinas.criar | `POST ^\/onboarding\/bot$` |
| `onboarding.rotina` | Criar a primeira rotina no onboarding | muda | nunca: passo do onboarding da tela; no chat, o mesmo efeito é bots.criar ou rotinas.criar | `POST ^\/onboarding\/rotina$` |

## relatos

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `relatos.registrar` | Contar um bug, uma melhoria ou uma dúvida | muda | parcial (`registrar_relato`): a ferramenta do Nod e o botão gravam por casos de uso diferentes e sem teste de contrato | `POST ^\/relatos$` |

## conta

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `conta.trocar_senha` | Trocar a senha | pessoa_confirma | nunca: senha nunca passa pela conversa; o chat só abre o cartão (abrir_conta); quem preenche e confirma é a pessoa, no cartão | rota pública de conta (/api/conta, ADR-124) |
| `conta.entrar` | Entrar, cadastrar ou recuperar a conta | pessoa_confirma | nunca: sessão: sem sessão não há chat; o chat só abre o cartão (abrir_conta); quem preenche e confirma é a pessoa, no cartão | rota pública de conta (/api/conta, ADR-124) |
| `conta.parear_aparelho` | Parear um aparelho com a conta | pessoa_confirma | nunca: pareamento: a pessoa confere o código no aparelho; o chat só abre o cartão (abrir_conta); quem preenche e confirma é a pessoa, no cartão | rota pública de conta (/api/conta, ADR-124) |
| `conta.sair_das_outras` | Sair dos outros aparelhos | arriscada | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |
| `conta.editar_perfil` | Editar o nome, o sobre mim e a foto | muda | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |
| `conta.trocar_email` | Trocar o e-mail da conta | pessoa_confirma | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |
| `conta.remover_google` | Tirar o login Google da conta | pessoa_confirma | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |
| `conta.exportar` | Exportar os dados da conta | muda | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |
| `conta.excluir` | Excluir a conta (ou desfazer a exclusão) | pessoa_confirma | falta (NOD-395) | rota pública de conta (/api/conta, ADR-124) |

## tela

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `tela.capturar` | Capturar uma tela do Nod | leitura | nunca: só no dev, no CI e no efêmero (NOD_CAPTURA_TELA); captura no chat da pessoa pede revisão de privacidade à parte | `POST ^\/tela\/captura$` |

## quadro

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `quadro.criar` | Criar o quadro de um bot (meta e prazo opcionais; com nome, outro quadro no mesmo bot, ADA-14) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro$` |
| `quadro.editar` | Mudar a meta, o prazo, o nome, o projeto ou quem dá o Done no quadro | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro$` |
| `quadro.criar_tarefa` | Criar uma tarefa no quadro | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas$`<br>`POST ^\/quadros\/(?<qid>[^/]+)\/tarefas$` |
| `quadro.importar_linear` | Trazer itens do Linear para o quadro | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/linear$` |
| `quadro.importar_time_linear` | Trazer um time do Linear para o quadro (com prévia) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/importacao$` |
| `quadro.assumir` | O quadro assume a esteira: pausar as rotinas dos bots do quadro (com confirmação e Desfazer) | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/assumir$`<br>`POST ^\/agentes\/(?<id>[^/]+)\/quadro\/assumir$` |
| `quadro.mudar_tarefa` | Mudar uma tarefa (status, responsável, PR, pergunta, labels, prazo) ou tirá-la do quadro | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)$`<br>`PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)$`<br>`PATCH ^\/quadros\/(?<qid>[^/]+)\/tarefas\/(?<tid>[^/]+)$` |
| `quadro.responder` | Responder a pergunta de uma tarefa bloqueada | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/resposta$`<br>`POST ^\/quadros\/(?<qid>[^/]+)\/tarefas\/(?<tid>[^/]+)\/resposta$` |
| `quadro.comentar` | Comentar uma tarefa (aciona o responsável, o agente da thread ou o bot @mencionado; no quadro de outra pessoa, fica para a dona) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/comentarios$`<br>`POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/comentarios$`<br>`POST ^\/quadros\/(?<qid>[^/]+)\/comentarios$` |
| `quadro.desfazer` | Desfazer a última mudança no quadro | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/lotes\/(?<lid>[^/]+)\/desfazer$`<br>`POST ^\/quadros\/(?<qid>[^/]+)\/lotes\/(?<lid>[^/]+)\/desfazer$` |
| `quadro.mover_tarefa` | Mudar a tarefa para o quadro de outro bot | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/mover$` |
| `quadro.remover` | Remover o quadro (o bot volta a ser um agente comum; conversa e memória ficam) | arriscada | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro$` |
| `quadro.criar_coluna` | Criar uma coluna no quadro (com o grupo) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas$` |
| `quadro.renomear_coluna` | Renomear uma coluna do quadro (ou pôr/tirar o prazo dela) | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas\/(?<cid>[^/]+)$` |
| `quadro.mover_coluna` | Mudar uma coluna de lugar (dentro do grupo) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas\/(?<cid>[^/]+)\/mover$` |
| `quadro.remover_coluna` | Remover uma coluna (as tarefas vão para o destino) | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas\/(?<cid>[^/]+)$` |
| `quadro.substituir_colunas` | Trocar o conjunto de colunas do quadro | muda | vivo (`gerir_quadro`) | `PUT ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas$` |
| `quadro.definir_passagem` | Definir quem pega a tarefa ao entrar numa coluna | muda | vivo (`gerir_quadro`) | `PUT ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas\/(?<cid>[^/]+)\/passagem$` |
| `quadro.terminei` | Terminar a etapa (a tarefa vai para a próxima coluna) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/terminei$` |
| `quadro.adicionar_pessoa` | Pôr alguém do time no quadro | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/pessoas$` |
| `quadro.tirar_pessoa` | Tirar alguém do quadro (as pendências dela voltam para a dona) | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/pessoas\/(?<pid>[^/]+)$` |
| `quadro.mudar_modo` | Escolher como as pessoas conversam com o quadro | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/modo$` |
| `quadro.travar_coluna` | Travar a saída de uma coluna (só sai para…, só a pessoa tira daqui) | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/colunas\/(?<cid>[^/]+)\/trava$` |
| `quadro.desfazer_movimento` | Desfazer um movimento do histórico da tarefa | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/movimentos\/(?<mid>[^/]+)\/desfazer$` |
| `quadro.repetir_trabalho` | Repetir o trabalho de uma tarefa (abre um novo; a Bloqueada volta para onde estava) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/trabalhos\/repetir$` |
| `quadro.cancelar_trabalho` | Cancelar o trabalho em andamento de uma tarefa (a tarefa fica onde está) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/trabalhos\/cancelar$` |
| `quadro.recado_trabalho` | Mandar um recado ao trabalho em andamento de uma tarefa | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/trabalhos\/recado$` |
| `quadro.listar` | Listar os quadros do bot (ou de todos os bots) e os projetos | leitura | vivo (`gerir_quadro`) | só leitura: a tela lê em GET /agentes/:id/quadros (a catraca B só conta as rotas que mudam algo) |
| `quadro.abrir` | Escolher em qual quadro o app Quadro do bot abre | muda | vivo (`gerir_quadro`) | `PUT ^\/agentes\/(?<id>[^/]+)\/quadros\/aberto$` |
| `quadro.definir_padrao` | Definir o quadro padrão de um bot | muda | vivo (`gerir_quadro`) | `PUT ^\/agentes\/(?<id>[^/]+)\/quadros\/(?<qid>[^/]+)\/padrao$` |
| `quadro.vincular_bot` | Pôr um quadro também em outro bot (quadro compartilhado) | muda | vivo (`gerir_quadro`) | `POST ^\/quadros\/(?<qid>[^/]+)\/bots$` |
| `quadro.desvincular_bot` | Tirar um bot de um quadro compartilhado (o próximo vira dono) | muda | vivo (`gerir_quadro`) | `DELETE ^\/quadros\/(?<qid>[^/]+)\/bots\/(?<bot>[^/]+)$` |
| `quadro.criar_projeto` | Criar um projeto (agrupa quadros) | muda | vivo (`gerir_quadro`) | `POST ^\/projetos$` |
| `quadro.editar_projeto` | Mudar o nome, a descrição, a meta ou o prazo de um projeto | muda | vivo (`gerir_quadro`) | `PATCH ^\/projetos\/(?<pid>[^/]+)$` |
| `quadro.arquivar_projeto` | Arquivar um projeto (os quadros ficam, soltos) | muda | vivo (`gerir_quadro`) | `POST ^\/projetos\/(?<pid>[^/]+)\/arquivar$` |
| `quadro.restaurar_projeto` | Restaurar um projeto arquivado | muda | vivo (`gerir_quadro`) | `POST ^\/projetos\/(?<pid>[^/]+)\/restaurar$` |
| `quadro.acordar_trabalho` | Acordar agora o trabalho de uma tarefa que espera uma volta (hora marcada ou CI) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/trabalhos\/acordar$` |
| `quadro.criar_label` | Criar uma label no quadro (nome e cor) | muda | vivo (`gerir_quadro`) | `POST ^\/agentes\/(?<id>[^/]+)\/quadro\/labels$` |
| `quadro.editar_label` | Renomear ou recolorir uma label do quadro | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/labels\/(?<lid>[^/]+)$` |
| `quadro.remover_label` | Remover uma label do quadro (sai de todas as tarefas) | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/labels\/(?<lid>[^/]+)$` |
| `quadro.editar_comentario` | Editar o próprio comentário numa tarefa (com refazer: cancela o run que ele abriu e reaciona com o texto novo) | muda | vivo (`gerir_quadro`) | `PATCH ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/comentarios\/(?<cid>[^/]+)$` |
| `quadro.apagar_comentario` | Apagar o próprio comentário numa tarefa (as respostas da thread ficam) | muda | vivo (`gerir_quadro`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)\/comentarios\/(?<cid>[^/]+)$` |

## paginas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `paginas.criar_app` | Criar um app do bot (nome, ícone, fonte, forma, quem vê, regra do "pede você") | muda | vivo (`gerir_apps`) | a tela leva à caixa da conversa com a frase começada (NOD-444); o card do chat se confirma em POST decisoes/:id/decidir |
| `paginas.editar_app` | Editar um app (nome, ícone, forma, fonte, regra) ou o retrato que ele mostra | muda | vivo (`gerir_apps`) | a tela leva à caixa da conversa com a frase começada (NOD-444); o card do chat se confirma em POST decisoes/:id/decidir |
| `paginas.ordenar` | Reordenar as páginas do bot (a Conversa inclusive; a primeira é a tela inicial) | muda | vivo (`gerir_apps`) | `PUT ^\/agentes\/(?<id>[^/]+)\/paginas\/ordem$` |
| `paginas.remover_app` | Tirar um app da pílula (o dado de origem fica; tem Desfazer) | muda | vivo (`gerir_apps`) | `DELETE ^\/agentes\/(?<id>[^/]+)\/apps\/(?<app>[^/]+)$` |
| `paginas.restaurar_app` | Trazer de volta um app removido (o Desfazer) | muda | vivo (`gerir_apps`) | `POST ^\/agentes\/(?<id>[^/]+)\/apps\/(?<app>[^/]+)\/restaurar$` |

## times

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `times.criar` | Criar um time de bots (no lugar pedido, já com bots) | muda | vivo (`gerir_times`) | `POST ^\/times\/sincronizar$`<br>`POST ^\/times$` |
| `times.renomear` | Renomear um time | muda | vivo (`gerir_times`) | `PATCH ^\/times\/(?<id>[^/]+)$` |
| `times.excluir` | Excluir um time (os bots vão para Sem time) | arriscada | vivo (`gerir_times excluir_time`) | `DELETE ^\/times\/(?<id>[^/]+)$` |
| `times.ordenar` | Mudar um time de lugar na barra | muda | vivo (`gerir_times`) | `PATCH ^\/times\/(?<id>[^/]+)\/posicao$` |
| `times.recolher` | Recolher ou abrir um time | muda | vivo (`gerir_times`) | `PATCH ^\/times\/(?<id>[^/]+)\/recolhido$` |

## canvas

| Ação | O que faz | Risco | No chat | Rotas |
| --- | --- | --- | --- | --- |
| `canvas.comentar` | Comentar num canvas (pino numa tela, post-it numa jornada ou resposta) | muda | vivo (`gerir_canvas`) | `POST ^\/canvas\/(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/comentarios$` |
| `canvas.resolver_comentario` | Resolver ou reabrir um comentário do canvas (com as respostas) | muda | vivo (`gerir_canvas`) | `POST ^\/canvas\/comentarios\/(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/resolver$` |
| `canvas.instalar` | Instalar o app Canvas | muda | falta (NOD-394) | `PUT ^\/canvas\/app$` |
| `canvas.desinstalar` | Desinstalar o app Canvas (tira o acesso de todos os bots; os canvas ficam) | muda | falta (NOD-394) | `DELETE ^\/canvas\/app$` |
| `canvas.dar_acesso` | Dar ou tirar o acesso de um bot ao Canvas (ver e comentar, ou criar e publicar) | muda | falta (NOD-394) | `PUT ^\/canvas\/app\/acessos\/(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$` |

## O que cada onda leva

- **NOD-393** (Onda 1: bots e rotinas): `bots.restaurar`, `bots.fixar`, `bots.ocultar`, `bots.definir_inteligencia`, `bots.cobrar_colega`, `memoria.criar`, `memoria.editar`, `memoria.apagar`, `memoria.revisar_diario`, `memoria.desfazer_diario`, `rotinas.mudar_ritmo`, `rotinas.gerar_endereco`, `rotinas.enviar_teste`
- **NOD-394** (Onda 2: apps e acessos): `acessos.conceder`, `acessos.liberar`, `acessos.dispensar`, `acessos.revogar`, `apps.criar`, `apps.sondar`, `apps.habilitar`, `apps.desabilitar`, `apps.conectar`, `apps.verificar`, `canvas.instalar`, `canvas.desinstalar`, `canvas.dar_acesso`
- **NOD-395** (Onda 3: conta e segurança): `conta.sair_das_outras`, `conta.editar_perfil`, `conta.trocar_email`, `conta.remover_google`, `conta.exportar`, `conta.excluir`
- **NOD-396** (Onda 4: máquinas e computadores): `maquinas.revogar_chave`, `maquinas.convidar`, `maquinas.editar`, `maquinas.desconectar`, `maquinas.atualizar_ia`, `maquinas.escolher_do_bot`, `maquinas.definir_bots`, `maquinas.rodar_desta_vez`, `maquinas.instalar_ssh`, `maquinas.confiar_ssh`, `maquinas.cancelar_ssh`, `nuvem.criar_maquina`, `nuvem.excluir_maquina`, `nuvem.dormir`, `nuvem.acordar`, `nuvem.dormir_apos`, `computador.operar`, `computador.trocar_lugar`, `computador.operar_do_bot`
- **NOD-397** (Onda 5: conversa, salas, voz e preferências): `bots.mudar_voz`, `conversas.reagir`, `conversas.desfazer_turno`, `conversas.parar`, `conversas.parar_tudo`, `conversas.nova_sessao`, `conversas.definir_pasta`, `conversas.criar_pasta`, `conversas.tirar_pasta`, `turnos.retomar_decisao`, `turnos.cancelar`, `turnos.retomar`, `incidentes.dispensar`, `modo.contestar`, `salas.criar`, `salas.adicionar_membro`, `salas.parar`, `trabalhos.parar`, `trabalhos.depois`, `trabalhos.fazer_aqui`, `voz.ligar`, `voz.encerrar`, `voz.continuar`, `voz.apagar_falas`, `voz.avaliar`, `preferencias.salvar`
- **NOD-400** (Onda 4b: contas de IA): `bots.decidir_troca_de_ia`, `contas_ia.ordenar`, `contas_ia.mudar_modo`, `contas_ia.editar`, `contas_ia.sair`, `contas_ia.remover`, `contas_ia.seguir`, `contas_ia.tentar_de_novo`, `contas_ia.entrar`, `contas_ia.codigo_do_login`, `contas_ia.cancelar_login`, `contas_ia.trocar_executor`
