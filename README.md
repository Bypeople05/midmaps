# Super Secretaria Mind Map

Editor de mind map com geração por IA via Google Gemini. O app serve o HTML e o backend no mesmo serviço Node, pronto para Coolify.

## Arquivos principais

- `mind_map_editor_interativo_projeto_administradora.html`: frontend do editor.
- `server.js`: servidor Node com endpoint de IA.
- `package.json`: script de start.
- `Dockerfile`: opção de deploy via Docker.
- `.env.example`: variáveis necessárias.

## Rodar localmente

Crie um arquivo `.env` ou defina a variável no terminal:

```bash
GEMINI_API_KEY=sua-chave-gemini-aqui
```

No Coolify, coloque `GEMINI_API_KEY` no campo **Name** e somente a chave no campo **Value**. Nao cole `GEMINI_API_KEY=...` inteiro dentro do valor.

Depois rode:

```bash
npm start
```

Acesse:

```txt
http://localhost:3000
```

Health check:

```txt
http://localhost:3000/health
```

## Configuração no Coolify

Use uma aplicação Node/Nixpacks:

```txt
Build Pack: Nixpacks
Start Command: npm start
Port: 3000
```

Variável obrigatória:

```txt
GEMINI_API_KEY=sua-chave-gemini-aqui
```

Variáveis para salvar mapas no Supabase:

```txt
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role-apenas-no-backend
```

Antes de ativar essas variáveis, rode o SQL em `supabase/schema.sql` no SQL Editor do Supabase.

Variáveis opcionais:

```txt
ALLOWED_ORIGINS=https://seu-dominio.com
GEMINI_MODEL=gemini-2.5-flash
```

## Configuração no frontend

No editor, clique em `Configurar IA`, selecione `Backend próprio` e use:

```txt
/api/generate-mindmap
```

Se o frontend estiver em outro domínio, use a URL completa:

```txt
https://seu-dominio.com/api/generate-mindmap
```

## Endpoints

- `GET /`: abre o editor.
- `GET /health`: verifica se o backend está online.
- `GET /api/config`: entrega as chaves públicas do Supabase para o frontend.
- `POST /api/generate-mindmap`: gera mind map via Gemini.
- `POST /generate-mindmap`: alias do endpoint acima.

Payload:

```json
{
  "text": "Texto para transformar em mind map..."
}
```
