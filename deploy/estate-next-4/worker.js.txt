const VERSION = 'ESTATE-NEXT-4-EXTENSION-20260723';
const DEFAULT_LEGACY_API = 'https://dpro-estate-line-api.dpromstk2000.workers.dev';
const DEFAULT_SHOP_CODE = 'dpro_estate_demo';
const STAGES = new Set(['inquiry','conditions','proposal','viewing','viewed','application','contracted','closed']);
const VACANCY_RESULTS = new Set(['募集中','確認中','申込あり','成約済み','不明']);

class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const configured = (env.ALLOWED_ORIGIN || '').trim();
  const allowed = configured || 'https://dpromstk2000-lab.github.io';
  const origin = requestOrigin && (allowed === '*' || requestOrigin === allowed) ? requestOrigin : allowed;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-DPRO-Admin-Code,X-Admin-Code',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

function cleanText(value, max = 2000) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function cleanDate(value) {
  const text = cleanText(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, '日付はYYYY-MM-DD形式で指定してください。');
  return text;
}

function positiveInt(value, fallback = 30, max = 200) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(number, max);
}

function adminCode(request, body = {}) {
  return cleanText(
    request.headers.get('X-DPRO-Admin-Code') ||
    request.headers.get('X-Admin-Code') ||
    body.admin_code || body.code,
    100,
  );
}

function shopCode(url, body = {}) {
  return cleanText(body.shop_code || url.searchParams.get('shop_code') || DEFAULT_SHOP_CODE, 100) || DEFAULT_SHOP_CODE;
}

async function parseJson(request) {
  if (!['POST','PATCH','PUT','DELETE'].includes(request.method)) return {};
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new HttpError(400, 'JSON形式を確認してください。'); }
}

async function secureEqualText(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left ?? ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right ?? ''))),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return diff === 0;
}

async function verifyAdmin(request, env, body, shop) {
  const code = adminCode(request, body);
  if (!code) throw new HttpError(401, '管理コードが必要です。');

  // Cloudflare Worker間の認証経路が環境により401になる場合に備え、
  // 拡張Worker側のSecretを第一認証元として使用します。
  const localCode = cleanText(env.DPRO_ESTATE_ADMIN_CODE || env.ADMIN_CODE, 100);
  if (localCode && await secureEqualText(code, localCode)) return code;

  // Secret未設定時や移行期間は、従来WorkerのログインAPIも試します。
  const base = (env.LEGACY_API_BASE || DEFAULT_LEGACY_API).replace(/\/$/, '');
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DPRO-Admin-Code': code,
      'X-Admin-Code': code,
    },
    body: JSON.stringify({ code, admin_code: code, shop_code: shop }),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.ok === false) {
    throw new HttpError(401, localCode
      ? '拡張Workerの管理コードSecretと入力値が一致しません。'
      : '拡張WorkerへDPRO_ESTATE_ADMIN_CODE Secretを設定してください。');
  }
  return code;
}

function supabaseHeaders(env, prefer = '') {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Supabase環境変数が未設定です。');
  const headers = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function supabase(env, table, { method = 'GET', query = '', body = undefined, prefer = '' } = {}) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: supabaseHeaders(env, prefer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new HttpError(response.status, `Supabase ${table} エラー`, data);
  return data;
}

function casePayload(body, shop) {
  const stage = cleanText(body.stage_key, 40) || 'inquiry';
  if (!STAGES.has(stage)) throw new HttpError(400, '案件ステータスが不正です。');
  const lostReason = cleanText(body.lost_reason, 1000);
  if (stage === 'closed' && !lostReason) throw new HttpError(400, '見送り時は見送り理由が必要です。');
  const customerId = cleanText(body.customer_id, 200);
  if (!customerId) throw new HttpError(400, 'customer_idが必要です。');
  return {
    shop_code: shop,
    customer_id: customerId,
    property_id: cleanText(body.property_id, 200),
    reservation_id: cleanText(body.reservation_id, 200),
    stage_key: stage,
    application_status: cleanText(body.application_status, 100) || '申込前',
    assigned_staff_id: cleanText(body.assigned_staff_id, 200),
    assigned_staff_name: cleanText(body.assigned_staff_name, 200),
    next_action: cleanText(body.next_action, 1000),
    next_action_due_date: cleanDate(body.next_action_due_date),
    viewing_memo: cleanText(body.viewing_memo, 4000),
    lost_reason: lostReason,
    internal_memo: cleanText(body.internal_memo, 4000),
    last_activity_at: new Date().toISOString(),
  };
}

function eventSnapshot(row) {
  if (!row) return null;
  const allowed = ['id','shop_code','customer_id','property_id','reservation_id','stage_key','application_status','assigned_staff_id','assigned_staff_name','next_action','next_action_due_date','viewing_memo','lost_reason','internal_memo','version','updated_at'];
  return Object.fromEntries(allowed.map(key => [key, row[key] ?? null]));
}

async function insertEvent(env, shop, caseId, type, beforeData, afterData) {
  await supabase(env, 'estate_case_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: [{
      shop_code: shop,
      case_id: caseId,
      event_type: type,
      actor_type: 'owner',
      before_data: eventSnapshot(beforeData),
      after_data: eventSnapshot(afterData),
    }],
  });
}

async function listCases(env, shop, url) {
  const limit = positiveInt(url.searchParams.get('limit'), 30, 200);
  const offset = positiveInt(url.searchParams.get('offset'), 0, 100000);
  const stage = cleanText(url.searchParams.get('stage_key'), 40);
  const customer = cleanText(url.searchParams.get('customer_id'), 200);
  const filters = [
    `shop_code=eq.${encodeURIComponent(shop)}`,
    'select=*',
    'order=updated_at.desc',
    `limit=${limit}`,
    `offset=${offset}`,
  ];
  if (stage) filters.push(`stage_key=eq.${encodeURIComponent(stage)}`);
  if (customer) filters.push(`customer_id=eq.${encodeURIComponent(customer)}`);
  return await supabase(env, 'estate_application_cases', { query: filters.join('&') });
}

async function upsertCase(env, shop, body) {
  const payload = casePayload(body, shop);
  const existing = await supabase(env, 'estate_application_cases', {
    query: `shop_code=eq.${encodeURIComponent(shop)}&customer_id=eq.${encodeURIComponent(payload.customer_id)}&select=*&limit=1`,
  });
  const before = Array.isArray(existing) ? existing[0] : null;
  const record = { ...payload, version: before ? Number(before.version || 1) + 1 : 1 };
  const rows = await supabase(env, 'estate_application_cases', {
    method: 'POST',
    query: 'on_conflict=shop_code,customer_id',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [record],
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  await insertEvent(env, shop, saved.id, before ? 'case_updated' : 'case_created', before, saved);
  return saved;
}

async function patchCase(env, shop, body) {
  const id = cleanText(body.id || body.case_id, 200);
  if (!id) throw new HttpError(400, 'case_idが必要です。');
  const existing = await supabase(env, 'estate_application_cases', {
    query: `id=eq.${encodeURIComponent(id)}&shop_code=eq.${encodeURIComponent(shop)}&select=*&limit=1`,
  });
  const before = Array.isArray(existing) ? existing[0] : null;
  if (!before) throw new HttpError(404, '案件が見つかりません。');
  const expected = body.version === undefined || body.version === null ? null : Number(body.version);
  if (expected !== null && Number(before.version) !== expected) throw new HttpError(409, '他の操作で案件が更新されています。再読み込みしてください。');
  const merged = casePayload({ ...before, ...body, customer_id: before.customer_id }, shop);
  const query = [`id=eq.${encodeURIComponent(id)}`, `shop_code=eq.${encodeURIComponent(shop)}`, `version=eq.${Number(before.version)}`, 'select=*'].join('&');
  const rows = await supabase(env, 'estate_application_cases', {
    method: 'PATCH', query, prefer: 'return=representation', body: { ...merged, version: Number(before.version) + 1 },
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  if (!saved) throw new HttpError(409, '案件の同時更新を検出しました。再読み込みしてください。');
  await insertEvent(env, shop, id, 'case_updated', before, saved);
  return saved;
}

async function listVacancy(env, shop, url) {
  const propertyId = cleanText(url.searchParams.get('property_id'), 200);
  const limit = positiveInt(url.searchParams.get('limit'), 20, 100);
  const filters = [`shop_code=eq.${encodeURIComponent(shop)}`, 'select=*', 'order=checked_at.desc', `limit=${limit}`];
  if (propertyId) filters.push(`property_id=eq.${encodeURIComponent(propertyId)}`);
  return await supabase(env, 'estate_vacancy_checks', { query: filters.join('&') });
}

async function recordVacancy(env, shop, body) {
  const propertyId = cleanText(body.property_id, 200);
  const result = cleanText(body.result, 40);
  if (!propertyId) throw new HttpError(400, 'property_idが必要です。');
  if (!VACANCY_RESULTS.has(result)) throw new HttpError(400, '空室確認結果が不正です。');
  const rows = await supabase(env, 'estate_vacancy_checks', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      shop_code: shop,
      property_id: propertyId,
      result,
      checked_at: new Date().toISOString(),
      checked_by_staff_id: cleanText(body.checked_by_staff_id, 200),
      checked_by_staff_name: cleanText(body.checked_by_staff_name, 200),
      next_check_due_date: cleanDate(body.next_check_due_date),
      source: cleanText(body.source, 100) || 'owner',
      memo: cleanText(body.memo, 4000),
    }],
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function tableCheck(env, table) {
  try {
    await supabase(env, table, { query: 'select=id&limit=1' });
    return { table, ok: true };
  } catch (error) {
    return { table, ok: false, status: error.status || 500, message: error.message };
  }
}

async function writeSelfTest(env, shop) {
  const token = `system-check-${Date.now()}`;
  let caseId = null;
  let vacancyId = null;
  try {
    const cases = await supabase(env, 'estate_application_cases', {
      method: 'POST', prefer: 'return=representation', body: [{ shop_code: shop, customer_id: token, stage_key: 'inquiry', application_status: '申込前', version: 1 }],
    });
    caseId = cases?.[0]?.id;
    const vacancies = await supabase(env, 'estate_vacancy_checks', {
      method: 'POST', prefer: 'return=representation', body: [{ shop_code: shop, property_id: token, result: '不明', source: 'system-check' }],
    });
    vacancyId = vacancies?.[0]?.id;
    if (caseId) await supabase(env, 'estate_case_events', {
      method: 'POST', prefer: 'return=minimal', body: [{ shop_code: shop, case_id: caseId, event_type: 'system_check', actor_type: 'system' }],
    });
    return { ok: Boolean(caseId && vacancyId) };
  } finally {
    if (vacancyId) await supabase(env, 'estate_vacancy_checks', { method: 'DELETE', query: `id=eq.${encodeURIComponent(vacancyId)}`, prefer: 'return=minimal' }).catch(() => null);
    if (caseId) await supabase(env, 'estate_application_cases', { method: 'DELETE', query: `id=eq.${encodeURIComponent(caseId)}`, prefer: 'return=minimal' }).catch(() => null);
  }
}

async function systemCheck(env, shop, writeTest) {
  const tables = await Promise.all([
    tableCheck(env, 'estate_application_cases'),
    tableCheck(env, 'estate_case_events'),
    tableCheck(env, 'estate_vacancy_checks'),
  ]);
  const allOk = tables.every(item => item.ok);
  const result = { ok: allOk, service: 'DPRO Estate NEXT-4 Extension API', version: VERSION, shop_code: shop, tables };
  if (writeTest && allOk) result.write_test = await writeSelfTest(env, shop);
  if (result.write_test && !result.write_test.ok) result.ok = false;
  return result;
}

function customerStage(status) {
  const map = {
    '初回問い合わせ':'inquiry','希望条件確認中':'conditions','物件提案済み':'proposal','内見予約済み':'viewing',
    '内見済み':'viewed','申込検討中':'application','申込希望':'application','申込受付':'application',
    '成約':'contracted','成約済み':'contracted','見送り':'closed','キャンセル':'closed','長期フォロー':'closed',
  };
  return map[status] || 'inquiry';
}

async function legacyJson(env, path, code, shop) {
  const base = (env.LEGACY_API_BASE || DEFAULT_LEGACY_API).replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  url.searchParams.set('shop_code', shop);
  const response = await fetch(url, { headers: { 'X-DPRO-Admin-Code': code, 'X-Admin-Code': code } });
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new HttpError(response.status, data?.error || `既存API ${path} の取得に失敗しました。`);
  return data;
}

async function prepareDemo(env, shop, code) {
  if (shop !== DEFAULT_SHOP_CODE) throw new HttpError(403, 'デモ店舗以外では拡張データを初期化できません。');
  await supabase(env, 'estate_vacancy_checks', { method: 'DELETE', query: `shop_code=eq.${encodeURIComponent(shop)}`, prefer: 'return=minimal' });
  await supabase(env, 'estate_application_cases', { method: 'DELETE', query: `shop_code=eq.${encodeURIComponent(shop)}`, prefer: 'return=minimal' });
  const [customersData, reservationsData, propertiesData] = await Promise.all([
    legacyJson(env, '/api/admin/customers?limit=100', code, shop),
    legacyJson(env, '/api/admin/reservations?limit=150', code, shop),
    legacyJson(env, '/api/admin/properties?include_private=true&limit=200', code, shop),
  ]);
  const customers = customersData.customers || [];
  const reservations = reservationsData.reservations || [];
  const latestByCustomer = new Map();
  for (const reservation of reservations) {
    const id = reservation.customer_id || reservation.customer?.id;
    if (!id) continue;
    const key = `${reservation.reservation_date || ''}T${String(reservation.reservation_time || '').slice(0,5)}`;
    if (!latestByCustomer.has(id) || key > latestByCustomer.get(id).key) latestByCustomer.set(id, { key, reservation });
  }
  const rows = customers.slice(0, 100).map(customer => {
    const latest = latestByCustomer.get(customer.id)?.reservation || null;
    const stage = customerStage(customer.customer_status || latest?.status);
    return {
      shop_code: shop,
      customer_id: String(customer.id),
      property_id: latest?.property_id ? String(latest.property_id) : null,
      reservation_id: latest?.id ? String(latest.id) : null,
      stage_key: stage,
      application_status: stage === 'application' ? '申込検討中' : stage === 'contracted' ? '成約' : '申込前',
      next_action: stage === 'viewed' ? '感想確認と申込意思確認' : stage === 'application' ? '申込内容を確認' : '次の対応を確認',
      next_action_due_date: null,
      lost_reason: stage === 'closed' ? 'デモ初期値：見送り・保留' : null,
      version: 1,
    };
  });
  if (rows.length) await supabase(env, 'estate_application_cases', {
    method: 'POST', query: 'on_conflict=shop_code,customer_id', prefer: 'resolution=merge-duplicates,return=minimal', body: rows,
  });
  const properties = propertiesData.properties || [];
  const vacancyRows = properties.filter(item => item.property_status === '確認中').slice(0, 50).map(item => ({
    shop_code: shop, property_id: String(item.id), result: '確認中', source: 'demo_prepare', memo: '営業前デモ準備で初期登録',
  }));
  if (vacancyRows.length) await supabase(env, 'estate_vacancy_checks', { method: 'POST', prefer: 'return=minimal', body: vacancyRows });
  return { ok: true, case_count: rows.length, vacancy_count: vacancyRows.length };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json(request, env, {
          ok: true,
          service: 'DPRO Estate NEXT-4 Extension API',
          version: VERSION,
          legacy_api: env.LEGACY_API_BASE || DEFAULT_LEGACY_API,
          supabase_url_set: Boolean(env.SUPABASE_URL),
          supabase_service_key_set: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
          admin_code_secret_set: Boolean(env.DPRO_ESTATE_ADMIN_CODE || env.ADMIN_CODE),
          auth_strategy: 'local-secret-with-legacy-fallback',
          time: new Date().toISOString(),
        });
      }

      const body = await parseJson(request);
      const shop = shopCode(url, body);
      const code = await verifyAdmin(request, env, body, shop);

      if (url.pathname === '/api/admin/system-check' && request.method === 'GET') {
        const result = await systemCheck(env, shop, url.searchParams.get('write_test') === '1');
        return json(request, env, result, result.ok ? 200 : 503);
      }
      if (url.pathname === '/api/admin/application-cases' && request.method === 'GET') {
        const rows = await listCases(env, shop, url);
        return json(request, env, { ok: true, version: VERSION, count: rows.length, cases: rows });
      }
      if (url.pathname === '/api/admin/application-cases' && request.method === 'POST') {
        const saved = await upsertCase(env, shop, body);
        return json(request, env, { ok: true, version: VERSION, case: saved }, 201);
      }
      if (url.pathname === '/api/admin/application-cases' && request.method === 'PATCH') {
        const saved = await patchCase(env, shop, body);
        return json(request, env, { ok: true, version: VERSION, case: saved });
      }
      if (url.pathname === '/api/admin/vacancy-checks' && request.method === 'GET') {
        const rows = await listVacancy(env, shop, url);
        return json(request, env, { ok: true, version: VERSION, count: rows.length, vacancy_checks: rows });
      }
      if (url.pathname === '/api/admin/vacancy-checks' && request.method === 'POST') {
        const saved = await recordVacancy(env, shop, body);
        return json(request, env, { ok: true, version: VERSION, vacancy_check: saved }, 201);
      }
      if (url.pathname === '/api/admin/demo/prepare' && request.method === 'POST') {
        const result = await prepareDemo(env, shop, code);
        return json(request, env, { ...result, version: VERSION });
      }
      throw new HttpError(404, 'エンドポイントが見つかりません。');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json(request, env, {
        ok: false,
        version: VERSION,
        error: error.message || '予期しないエラーが発生しました。',
        detail: error instanceof HttpError ? error.detail : null,
      }, status);
    }
  },
};
