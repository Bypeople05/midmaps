import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const INDEX_FILE = 'mind_map_editor_interativo_projeto_administradora.html';
const MAX_BODY_BYTES = 1_000_000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function getCorsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
    ? (origin || '*')
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body muito grande.'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function buildPrompt(text) {
  const truncated = text.substring(0, 15000);
  return `Voce e um especialista em onboarding SaaS, discovery comercial e estruturacao visual. Analise esta transcricao de reuniao e transforme-a em um JSON estruturado para o nosso mapa mental, focando em objetivos, dores e plano de acao.

TRANSCRICAO DA REUNIAO:
"""
${truncated}
"""

INSTRUCOES:
1. Identifique o tema central e crie um no raiz (level 0) com titulo curto (maximo 6 palavras).
2. Identifique 4 a 8 ramos principais (level 1), priorizando: contexto, objetivos, dores, decisoes, requisitos, riscos, plano de acao e proximos passos.
3. Para cada ramo, adicione 3 a 7 sub-nos (level 2) com pontos especificos extraidos da reuniao.
4. Se relevante, adicione sub-sub-nos (level 3) para detalhar ainda mais.
5. Linguagem concisa, cada no com no maximo 6 palavras.
6. Destaque responsaveis, prazos e pendencias quando aparecerem.
7. Seja fiel ao conteudo, sem inventar informacoes.

FORMATO DE RESPOSTA (retorne APENAS o JSON, sem markdown, sem explicacao):
{"text":"Titulo central","level":0,"children":[{"text":"Ramo 1","level":1,"children":[{"text":"Sub-ponto","level":2,"children":[]}]}]}`;
  return `Você é um especialista em análise de texto e estruturação visual. Analise o texto abaixo e gere um mind map no formato JSON exatamente como especificado.

TEXTO PARA ANÁLISE:
"""
${truncated}
"""

INSTRUÇÕES:
1. Identifique o tema central e crie um nó raiz (level 0) com título curto (máximo 6 palavras).
2. Identifique 4 a 8 ramos principais (level 1) representando grandes temas/categorias.
3. Para cada ramo, adicione 3 a 7 sub-nós (level 2) com pontos específicos.
4. Se relevante, adicione sub-sub-nós (level 3) para detalhar ainda mais.
5. Linguagem concisa, cada nó com no máximo 6 palavras.
6. Para reuniões de negócios use tipicamente: contexto, dores, soluções, casos de uso, próximos passos, decisões, métricas.
7. Seja fiel ao conteúdo, sem inventar informações.

FORMATO DE RESPOSTA (retorne APENAS o JSON, sem markdown, sem explicação):
{"text":"Título central","level":0,"children":[{"text":"Ramo 1","level":1,"children":[{"text":"Sub-ponto","level":2,"children":[]}]}]}`;
}

async function generateMindmap(req, res, corsHeaders) {
  if (!process.env.ANTHROPIC_API_KEY) {
    sendJson(res, 500, {
      error: 'Backend não configurado: falta ANTHROPIC_API_KEY nas variáveis de ambiente.'
    }, corsHeaders);
    return;
  }

  const body = await readJsonBody(req);
  const text = String(body.text || '').trim();

  if (!text) {
    sendJson(res, 400, { error: 'Campo "text" é obrigatório.' }, corsHeaders);
    return;
  }

  if (text.length < 50) {
    sendJson(res, 400, { error: 'Texto muito curto. Envie ao menos 50 caracteres.' }, corsHeaders);
    return;
  }

  if (text.length > 50000) {
    sendJson(res, 400, { error: 'Texto muito longo. Máximo 50.000 caracteres.' }, corsHeaders);
    return;
  }

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: buildPrompt(text) }]
    })
  });

  const responseBody = await anthropicResponse.text();

  if (!anthropicResponse.ok) {
    sendJson(res, 502, {
      error: `Erro na API Anthropic: ${anthropicResponse.status}`,
      details: responseBody.substring(0, 300)
    }, corsHeaders);
    return;
  }

  const data = JSON.parse(responseBody);
  const responseText = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  sendJson(res, 200, responseText, corsHeaders);
}

function getPublicConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || ''
  };
}

function getSupabaseAdminConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

async function supabaseAdminRequest(path, options = {}) {
  const config = getSupabaseAdminConfig();
  if (!config.url || !config.serviceRoleKey) {
    throw new Error('Supabase admin nao configurado: falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.');
  }

  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || text || `Supabase retornou ${response.status}`);
  }
  return payload;
}

async function getUserFromAccessToken(accessToken) {
  const config = getSupabaseAdminConfig();
  if (!config.url || !config.serviceRoleKey) {
    throw new Error('Supabase admin nao configurado: falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.');
  }

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.message || 'Sessao invalida.');
  }
  return payload;
}

async function isWorkspaceManager(userId, workspaceId) {
  const profile = await supabaseAdminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=app_role`);
  if (profile?.[0]?.app_role === 'admin') return true;

  const membership = await supabaseAdminRequest(
    `/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&role=in.(owner,admin)&select=id`
  );
  return Array.isArray(membership) && membership.length > 0;
}

async function inviteWorkspaceMember(req, res, corsHeaders, origin) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) {
    sendJson(res, 401, { error: 'Login obrigatorio para convidar membros.' }, corsHeaders);
    return;
  }

  const body = await readJsonBody(req);
  const workspaceId = String(body.workspaceId || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = ['admin', 'member'].includes(body.role) ? body.role : 'member';

  if (!workspaceId || !email) {
    sendJson(res, 400, { error: 'workspaceId e email sao obrigatorios.' }, corsHeaders);
    return;
  }

  const user = await getUserFromAccessToken(accessToken);
  const canInvite = await isWorkspaceManager(user.id, workspaceId);
  if (!canInvite) {
    sendJson(res, 403, { error: 'Voce nao tem permissao para convidar membros neste workspace.' }, corsHeaders);
    return;
  }

  await supabaseAdminRequest('/rest/v1/workspace_invites?on_conflict=workspace_id,email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      email,
      role,
      invited_by: user.id
    })
  });

  let inviteEmailSent = true;
  try {
    const redirectTo = origin || process.env.PUBLIC_APP_URL || '';
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    await supabaseAdminRequest(`/auth/v1/invite${query}`, {
      method: 'POST',
      body: JSON.stringify({
        email,
        data: { workspace_id: workspaceId, role }
      })
    });
  } catch (error) {
    inviteEmailSent = false;
    console.warn('Convite por email falhou, convite pendente foi salvo:', error.message);
  }

  sendJson(res, 200, {
    ok: true,
    email,
    workspaceId,
    inviteEmailSent
  }, corsHeaders);
}

function serveStatic(req, res, corsHeaders) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === '/' ? `/${INDEX_FILE}` : url.pathname;
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(__dirname, safePath);

  if (!filePath.startsWith(__dirname) || !existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' }, corsHeaders);
    return;
  }

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  res.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    ...corsHeaders
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'mindmap-generator',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
      }, corsHeaders);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      sendJson(res, 200, getPublicConfig(), corsHeaders);
      return;
    }

    if (req.method === 'POST' && ['/api/generate-mindmap', '/generate-mindmap'].includes(url.pathname)) {
      await generateMindmap(req, res, corsHeaders);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/invite-member') {
      await inviteWorkspaceMember(req, res, corsHeaders, origin);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, corsHeaders);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' }, corsHeaders);
  } catch (error) {
    sendJson(res, 500, { error: `Erro interno: ${error.message}` }, corsHeaders);
  }
});

server.listen(PORT, () => {
  console.log(`Mind map app running on port ${PORT}`);
});
