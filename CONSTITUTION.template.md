# CONSTITUTION

## Meta
- version: 1
- last_updated: {{DATE}}
- updated_by: zero-error/init
- changelog:
  - v1: Constitution inicial gerada pelo black box

## Invariantes
- Toda API requer autenticação
- Toda mutation valida input
- Toda transação é idempotente
- Secrets jamais em código
- Toda função tem tipo de retorno explícito

## Direção
- Objetivo: {{OBJECTIVE}}
- Prioridade: {{PRIORITY}}
- Pronto = 100% do critério de aceitação

## Padrões
- Linguagem: {{LANGUAGE}}
- Framework: {{FRAMEWORK}}
- Linter: {{LINTER_RULES}}

## Proibições
- Workarounds (sempre resolver a causa raiz)
- `any` em TypeScript (usar `unknown` + type guard)
- `console.log` em produção (usar logger estruturado)
- Imports não-usados
- Funções > 50 linhas
- TODO/FIXME/HACK no código
- Try/catch vazio ou que silencia erro
- Cast forçado (`as any`, `as unknown as X`)
- Lógica duplicada
- Abstrações usadas apenas uma vez

## Doutrina do 100%
- 100% é o critério de aceitação mínimo
- Workarounds são proibidos
- Estudo pré-execução é obrigatório
- Fluxo: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR

## Configuração de Validação
- requireTests: true
- preCommitTimeout: 30
- prePushTimeout: 120
- ciTimeout: 600
- mutationThreshold: 80
- coverageThreshold: 80
