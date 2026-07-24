const VERSION = 'ESTATE-NEXT-7-EXTENSION-20260724';
const DEFAULT_LEGACY_API = 'https://dpro-estate-line-api.dpromstk2000.workers.dev';
const DEFAULT_SHOP_CODE = 'dpro_estate_demo';
const STAGES = new Set(['inquiry','conditions','proposal','viewing','viewed','application','contracted','closed']);
const VACANCY_RESULTS = new Set(['募集中','確認中','申込あり','成約済み','不明']);
const APPLICATION_INTENTS = new Set(['未確認','検討中','申込希望','保留','申込しない']);
const INITIAL_COST_STATUSES = new Set(['未確認','概算作成中','概算提示済み','説明済み','合意']);
const DOCUMENT_STATUSES = new Set(['未案内','案内済み','回収中','確認中','完了']);
const DOCUMENT_ITEM_STATUSES = new Set(['未案内','依頼済み','受領','確認済み','不要']);
const COST_KEYS = new Set(['rent','deposit','key_money','brokerage','guarantee','insurance','key_change','other']);

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
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-DPRO-Admin-Code,X-Admin-Code,X-Idempotency-Key',
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


function cleanMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, '金額は0以上で指定してください。');
  return Math.round(number);
}

function operationId(request, body = {}) {
  return cleanText(request.headers.get('X-Idempotency-Key') || body.operation_id, 200);
}

function cleanCostBreakdown(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of COST_KEYS) result[key] = cleanMoney(source[key] ?? 0);
  return result;
}

function cleanDocuments(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const raw of rows.slice(0, 30)) {
    const key = cleanText(raw?.key, 80);
    const label = cleanText(raw?.label, 200);
    const status = cleanText(raw?.status, 40) || '未案内';
    if (!key || seen.has(key)) continue;
    if (!DOCUMENT_ITEM_STATUSES.has(status)) throw new HttpError(400, '必要書類の状態が不正です。');
    seen.add(key);
    result.push({ key, label: label || key, status });
  }
  return result;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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
  const intent = cleanText(body.application_intent, 40) || '未確認';
  const costStatus = cleanText(body.initial_cost_status, 40) || '未確認';
  const docsStatus = cleanText(body.documents_status, 40) || '未案内';
  if (!APPLICATION_INTENTS.has(intent)) throw new HttpError(400, '申込意思の状態が不正です。');
  if (!INITIAL_COST_STATUSES.has(costStatus)) throw new HttpError(400, '初期費用の状態が不正です。');
  if (!DOCUMENT_STATUSES.has(docsStatus)) throw new HttpError(400, '必要書類の全体状態が不正です。');
  const breakdown = cleanCostBreakdown(body.initial_cost_breakdown);
  const calculated = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const submittedTotal = cleanMoney(body.initial_cost_total ?? calculated);
  if (submittedTotal !== calculated) throw new HttpError(400, '初期費用合計と内訳が一致しません。');
  return {
    shop_code: shop,
    customer_id: customerId,
    property_id: cleanText(body.property_id, 200),
    reservation_id: cleanText(body.reservation_id, 200),
    stage_key: stage,
    application_status: cleanText(body.application_status, 100) || '申込前',
    application_intent: intent,
    application_intent_confirmed_at: cleanText(body.application_intent_confirmed_at, 40),
    assigned_staff_id: cleanText(body.assigned_staff_id, 200),
    assigned_staff_name: cleanText(body.assigned_staff_name, 200),
    next_action: cleanText(body.next_action, 1000),
    next_action_due_date: cleanDate(body.next_action_due_date),
    viewing_memo: cleanText(body.viewing_memo, 4000),
    initial_cost_status: costStatus,
    initial_cost_total: calculated,
    initial_cost_breakdown: breakdown,
    initial_cost_note: cleanText(body.initial_cost_note, 4000),
    initial_cost_updated_at: cleanText(body.initial_cost_updated_at, 40),
    documents_status: docsStatus,
    required_documents: cleanDocuments(body.required_documents),
    documents_note: cleanText(body.documents_note, 4000),
    documents_updated_at: cleanText(body.documents_updated_at, 40),
    lost_reason: lostReason,
    internal_memo: cleanText(body.internal_memo, 4000),
    last_operation_id: cleanText(body.operation_id || body.last_operation_id, 200),
    last_activity_at: new Date().toISOString(),
  };
}

function finalizeCasePayload(payload, before = null) {
  const now = new Date().toISOString();
  const result = { ...payload };
  if (!before || result.application_intent !== before.application_intent) {
    result.application_intent_confirmed_at = result.application_intent === '未確認' ? null : now;
  } else result.application_intent_confirmed_at = before.application_intent_confirmed_at || null;
  const costChanged = !before || result.initial_cost_status !== before.initial_cost_status || result.initial_cost_total !== Number(before.initial_cost_total || 0) || !sameJson(result.initial_cost_breakdown, before.initial_cost_breakdown) || result.initial_cost_note !== before.initial_cost_note;
  result.initial_cost_updated_at = costChanged ? now : (before?.initial_cost_updated_at || null);
  const documentsChanged = !before || result.documents_status !== before.documents_status || !sameJson(result.required_documents, before.required_documents) || result.documents_note !== before.documents_note;
  result.documents_updated_at = documentsChanged ? now : (before?.documents_updated_at || null);
  return result;
}

function eventSnapshot(row) {
  if (!row) return null;
  const allowed = ['id','shop_code','customer_id','property_id','reservation_id','stage_key','application_status','application_intent','application_intent_confirmed_at','assigned_staff_id','assigned_staff_name','next_action','next_action_due_date','viewing_memo','initial_cost_status','initial_cost_total','initial_cost_breakdown','initial_cost_note','initial_cost_updated_at','documents_status','required_documents','documents_note','documents_updated_at','lost_reason','internal_memo','last_operation_id','version','updated_at'];
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
  const operation = cleanText(body.operation_id, 200);
  const customerId = cleanText(body.customer_id, 200);
  if (!customerId) throw new HttpError(400, 'customer_idが必要です。');
  const existing = await supabase(env, 'estate_application_cases', {
    query: `shop_code=eq.${encodeURIComponent(shop)}&customer_id=eq.${encodeURIComponent(customerId)}&select=*&limit=1`,
  });
  const before = Array.isArray(existing) ? existing[0] : null;
  if (operation && before?.last_operation_id === operation) return before;
  const payload = casePayload({ ...(before || {}), ...body, customer_id: customerId, operation_id: operation }, shop);
  const finalized = finalizeCasePayload(payload, before);
  const record = { ...finalized, version: before ? Number(before.version || 1) + 1 : 1 };
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
  const operation = cleanText(body.operation_id, 200);
  if (operation && before.last_operation_id === operation) return before;
  const expected = body.version === undefined || body.version === null ? null : Number(body.version);
  if (expected !== null && Number(before.version) !== expected) throw new HttpError(409, '他の操作で案件が更新されています。再読み込みしてください。');
  const merged = finalizeCasePayload(casePayload({ ...before, ...body, operation_id: operation, customer_id: before.customer_id }, shop), before);
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
  const operation = cleanText(body.operation_id, 200);
  if (!propertyId) throw new HttpError(400, 'property_idが必要です。');
  if (!VACANCY_RESULTS.has(result)) throw new HttpError(400, '空室確認結果が不正です。');
  if (operation) {
    const existing = await supabase(env, 'estate_vacancy_checks', { query: `shop_code=eq.${encodeURIComponent(shop)}&operation_id=eq.${encodeURIComponent(operation)}&select=*&limit=1` });
    if (Array.isArray(existing) && existing[0]) return existing[0];
  }
  const rows = await supabase(env, 'estate_vacancy_checks', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      shop_code: shop,
      property_id: propertyId,
      result,
      operation_id: operation,
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

async function tableCheck(env, table, select = 'id') {
  try {
    await supabase(env, table, { query: `select=${encodeURIComponent(select)}&limit=1` });
    return { table, ok: true };
  } catch (error) {
    return { table, ok: false, status: error.status || 500, message: error.message };
  }
}

async function writeSelfTest(env, shop) {
  const token = `system-check-${Date.now()}`;
  const createOperation = `${token}-create`;
  const updateOperation = `${token}-update`;
  const vacancyOperation = `${token}-vacancy`;
  let caseId = null;
  let vacancyId = null;
  try {
    const docs = [{ key: 'identity', label: '本人確認書類', status: '依頼済み' }];
    const breakdown = { rent: 80000, deposit: 0, key_money: 80000, brokerage: 88000, guarantee: 40000, insurance: 18000, key_change: 22000, other: 0 };
    const createBody = { customer_id: token, stage_key: 'application', application_status: '申込希望', application_intent: '申込希望', initial_cost_status: '概算提示済み', initial_cost_total: 328000, initial_cost_breakdown: breakdown, documents_status: '案内済み', required_documents: docs, operation_id: createOperation };
    const first = await upsertCase(env, shop, createBody);
    caseId = first?.id;
    const duplicateCreate = await upsertCase(env, shop, createBody);
    const updateBody = { ...createBody, id: caseId, version: first.version, documents_status: '回収中', operation_id: updateOperation };
    const updated = await patchCase(env, shop, updateBody);
    const duplicateUpdate = await patchCase(env, shop, updateBody);
    const vacancyBody = { property_id: token, result: '不明', source: 'system-check', operation_id: vacancyOperation };
    const vacancy = await recordVacancy(env, shop, vacancyBody);
    vacancyId = vacancy?.id;
    const duplicateVacancy = await recordVacancy(env, shop, vacancyBody);
    const events = await supabase(env, 'estate_case_events', { query: `case_id=eq.${encodeURIComponent(caseId)}&select=id,event_type&order=created_at.asc` });
    const ok = Boolean(
      caseId && vacancyId &&
      duplicateCreate?.id === caseId && duplicateCreate?.version === first.version &&
      updated?.documents_status === '回収中' && duplicateUpdate?.version === updated.version &&
      duplicateVacancy?.id === vacancyId &&
      Array.isArray(events) && events.length === 2
    );
    return { ok, duplicate_case_guard: duplicateCreate?.id === caseId && duplicateUpdate?.version === updated.version, duplicate_vacancy_guard: duplicateVacancy?.id === vacancyId, event_count: Array.isArray(events) ? events.length : 0 };
  } finally {
    if (vacancyId) await supabase(env, 'estate_vacancy_checks', { method: 'DELETE', query: `id=eq.${encodeURIComponent(vacancyId)}`, prefer: 'return=minimal' }).catch(() => null);
    if (caseId) await supabase(env, 'estate_application_cases', { method: 'DELETE', query: `id=eq.${encodeURIComponent(caseId)}`, prefer: 'return=minimal' }).catch(() => null);
  }
}

async function systemCheck(env, shop, writeTest) {
  const tables = await Promise.all([
    tableCheck(env, 'estate_application_cases', 'id,application_intent,initial_cost_total,initial_cost_breakdown,documents_status,required_documents,last_operation_id'),
    tableCheck(env, 'estate_case_events'),
    tableCheck(env, 'estate_vacancy_checks', 'id,operation_id'),
    tableCheck(env, 'estate_member_sessions', 'id,token_hash,auth_method,expires_at'),
    tableCheck(env, 'estate_member_auth_attempts', 'key_hash,failed_count,blocked_until'),
    tableCheck(env, 'estate_member_revisit_requests', 'id,customer_id,preference_snapshot,operation_id'),
  ]);
  const allOk = tables.every(item => item.ok);
  const result = {
    ok: allOk,
    service: 'DPRO Estate NEXT-7 Extension API',
    version: VERSION,
    shop_code: shop,
    tables,
    features: {
      application_intent: true,
      initial_cost: true,
      required_documents: true,
      idempotency_guard: true,
      individual_line_copy: true,
      secure_member_session: true,
      reservation_code_verification: true,
      line_id_token_ready: true,
      previous_preferences: true,
      revisit_request: true,
    },
  };
  if (writeTest && allOk) {
    result.write_test = await writeSelfTest(env, shop);
    result.member_security_test = await memberSecuritySelfTest(env, shop);
  }
  if (result.write_test && !result.write_test.ok) result.ok = false;
  if (result.member_security_test && !result.member_security_test.ok) result.ok = false;
  return result;
}


function normalizePhone(value) {
  let digits = String(value || '').normalize('NFKC').replace(/\D/g, '');
  if (/^81\d{9,10}$/.test(digits)) digits = `0${digits.slice(2)}`;
  return digits.slice(0, 15);
}

function normalizeReservationCode(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 64);
}

function reservationAccessCode(value) {
  return normalizeReservationCode(value).slice(0, 8);
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function hashText(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
  return bytesToHex(new Uint8Array(digest));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1], 500);
}

function authSecret(env) {
  return cleanText(env.MEMBER_AUTH_SALT || env.DPRO_ESTATE_ADMIN_CODE || env.ADMIN_CODE || env.SUPABASE_SERVICE_ROLE_KEY, 1000);
}

async function attemptKey(request, env, shop, phone) {
  const ip = cleanText(request.headers.get('CF-Connecting-IP') || 'unknown', 100);
  const secret = authSecret(env);
  if (!secret) throw new HttpError(503, '会員認証用Secretが未設定です。');
  return hashText(`${shop}|${normalizePhone(phone)}|${ip}|${secret}`);
}

async function assertNotRateLimited(env, keyHash) {
  const rows = await supabase(env, 'estate_member_auth_attempts', {
    query: `key_hash=eq.${encodeURIComponent(keyHash)}&select=*&limit=1`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row?.blocked_until && new Date(row.blocked_until).getTime() > Date.now()) {
    throw new HttpError(429, '確認回数が多いため、しばらく時間をおいて再度お試しください。');
  }
  return row;
}

async function recordAuthFailure(env, shop, keyHash, before = null) {
  const now = new Date();
  const windowStart = before?.window_started_at ? new Date(before.window_started_at) : null;
  const withinWindow = windowStart && now.getTime() - windowStart.getTime() < 15 * 60 * 1000;
  const failedCount = (withinWindow ? Number(before?.failed_count || 0) : 0) + 1;
  const blockedUntil = failedCount >= 5 ? new Date(now.getTime() + 30 * 60 * 1000).toISOString() : null;
  await supabase(env, 'estate_member_auth_attempts', {
    method: 'POST',
    query: 'on_conflict=key_hash',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{
      key_hash: keyHash,
      shop_code: shop,
      failed_count: failedCount,
      window_started_at: withinWindow ? before.window_started_at : now.toISOString(),
      blocked_until: blockedUntil,
      updated_at: now.toISOString(),
    }],
  });
}

async function clearAuthFailure(env, keyHash) {
  await supabase(env, 'estate_member_auth_attempts', {
    method: 'DELETE', query: `key_hash=eq.${encodeURIComponent(keyHash)}`, prefer: 'return=minimal',
  }).catch(() => null);
}

async function legacyPublicMemberByPhone(env, shop, phone) {
  const base = (env.LEGACY_API_BASE || DEFAULT_LEGACY_API).replace(/\/$/, '');
  const url = new URL(`${base}/api/public/member`);
  url.searchParams.set('shop_code', shop);
  url.searchParams.set('phone', phone);
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) throw new HttpError(response.status, data?.error || '予約情報の確認に失敗しました。');
  return data;
}

async function verifyLineIdToken(env, idToken) {
  const clientId = cleanText(env.LINE_CHANNEL_ID, 100);
  if (!clientId) throw new HttpError(503, 'LINE本人確認は準備中です。受付番号で確認してください。');
  const form = new URLSearchParams({ id_token: idToken, client_id: clientId });
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.sub) throw new HttpError(401, 'LINE本人確認に失敗しました。受付番号で確認してください。');
  return { line_user_id: String(data.sub), name: cleanText(data.name, 200) };
}

async function legacyAdminSnapshot(env, shop) {
  const code = cleanText(env.DPRO_ESTATE_ADMIN_CODE || env.ADMIN_CODE, 100);
  if (!code) throw new HttpError(503, '会員情報取得用の管理コードSecretが未設定です。');
  const [customersData, reservationsData] = await Promise.all([
    legacyJson(env, '/api/admin/customers?limit=200', code, shop),
    legacyJson(env, '/api/admin/reservations?limit=300', code, shop),
  ]);
  return {
    customers: Array.isArray(customersData.customers) ? customersData.customers : [],
    reservations: Array.isArray(reservationsData.reservations) ? reservationsData.reservations : [],
  };
}

function customerPreference(customer) {
  const value = customer?.preference || customer?.preferences || null;
  return Array.isArray(value) ? (value[0] || {}) : (value || {});
}

function reservationCustomerId(reservation) {
  return String(reservation?.customer_id || reservation?.customer?.id || reservation?.customer_info?.id || '');
}

async function memberByLineUser(env, shop, lineUserId) {
  const snapshot = await legacyAdminSnapshot(env, shop);
  const customer = snapshot.customers.find(item => String(item.line_user_id || '') === String(lineUserId));
  if (!customer) return null;
  return {
    customer,
    preference: customerPreference(customer),
    reservations: snapshot.reservations.filter(item => reservationCustomerId(item) === String(customer.id)),
  };
}

async function memberByCustomerId(env, shop, customerId) {
  const snapshot = await legacyAdminSnapshot(env, shop);
  const customer = snapshot.customers.find(item => String(item.id) === String(customerId));
  if (!customer) throw new HttpError(404, 'お客様情報が見つかりません。');
  return {
    customer,
    preference: customerPreference(customer),
    reservations: snapshot.reservations.filter(item => reservationCustomerId(item) === String(customer.id)),
  };
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length < 5) return '確認済み';
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

function safePreference(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    desired_areas: Array.isArray(source.desired_areas) ? source.desired_areas.map(item => cleanText(item, 100)).filter(Boolean).slice(0, 20) : [],
    max_rent: Number(source.max_rent || 0) || null,
    floor_plans: Array.isArray(source.floor_plans) ? source.floor_plans.map(item => cleanText(item, 80)).filter(Boolean).slice(0, 20) : [],
    move_in_timing: cleanText(source.move_in_timing, 200),
    parking_required: Boolean(source.parking_required),
    pet_required: Boolean(source.pet_required),
    two_people: Boolean(source.two_people),
    low_initial_cost: Boolean(source.low_initial_cost),
    near_station: Boolean(source.near_station),
    workplace_or_school: cleanText(source.workplace_or_school, 500),
    other_request: cleanText(source.other_request, 1000),
  };
}

function safeReservation(row) {
  const property = row?.property || row?.property_info || {};
  const status = cleanText(row?.status, 100) || '予約受付';
  return {
    reservation_code: reservationAccessCode(row?.id),
    reservation_date: cleanText(row?.reservation_date, 20),
    reservation_time: cleanText(row?.reservation_time, 20),
    status,
    cancelled: status.includes('キャンセル') || status.toLowerCase() === 'cancelled',
    meeting_type: cleanText(row?.meeting_type, 200),
    meeting_place: cleanText(row?.meeting_place, 500),
    customer_note: cleanText(row?.customer_note, 1000),
    property: {
      property_name: cleanText(property.property_name || row?.property_name, 300),
      area_name: cleanText(property.area_name || row?.area_name, 200),
      rent_amount: Number(property.rent_amount || row?.rent_amount || 0) || null,
      floor_plan: cleanText(property.floor_plan || row?.floor_plan, 100),
    },
  };
}

function safeApplicationCase(row) {
  if (!row) return null;
  return {
    stage_key: cleanText(row.stage_key, 40),
    application_status: cleanText(row.application_status, 100),
    application_intent: cleanText(row.application_intent, 40),
    initial_cost_status: cleanText(row.initial_cost_status, 40),
    initial_cost_total: Number(row.initial_cost_total || 0),
    documents_status: cleanText(row.documents_status, 40),
    required_documents: cleanDocuments(row.required_documents),
    next_action_due_date: cleanDate(row.next_action_due_date),
  };
}

async function createMemberSession(request, env, shop, body) {
  const phone = normalizePhone(body.phone);
  const suppliedCode = normalizeReservationCode(body.reservation_code);
  const demo = Boolean(body.demo) && shop === DEFAULT_SHOP_CODE;
  let member = null;
  let authMethod = 'reservation_code';
  let attempt = null;
  let keyHash = null;

  if (body.line_id_token) {
    const verified = await verifyLineIdToken(env, cleanText(body.line_id_token, 5000));
    member = await memberByLineUser(env, shop, verified.line_user_id);
    authMethod = 'line';
    if (!member) throw new HttpError(404, 'LINEに紐づく予約情報が見つかりません。');
  } else {
    if (!phone) throw new HttpError(400, '予約時の電話番号が必要です。');
    keyHash = await attemptKey(request, env, shop, phone);
    attempt = await assertNotRateLimited(env, keyHash);
    const data = await legacyPublicMemberByPhone(env, shop, phone);
    if (!data?.found || !data?.customer) {
      await recordAuthFailure(env, shop, keyHash, attempt);
      throw new HttpError(401, '電話番号または受付番号を確認してください。');
    }
    const reservations = Array.isArray(data.reservations) ? data.reservations : [];
    const codeMatch = reservations.some(item => {
      const full = normalizeReservationCode(item.id);
      return suppliedCode && (suppliedCode === full || suppliedCode === full.slice(0, 8));
    });
    if (!demo && !codeMatch) {
      await recordAuthFailure(env, shop, keyHash, attempt);
      throw new HttpError(401, '電話番号または受付番号を確認してください。');
    }
    member = { customer: data.customer, preference: data.preference || customerPreference(data.customer), reservations };
    authMethod = demo ? 'demo' : 'reservation_code';
    await clearAuthFailure(env, keyHash);
  }

  const token = randomToken(32);
  const tokenHash = await hashText(token);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await supabase(env, 'estate_member_sessions', {
    method: 'DELETE', query: `expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, prefer: 'return=minimal',
  }).catch(() => null);
  const rows = await supabase(env, 'estate_member_sessions', {
    method: 'POST', prefer: 'return=representation', body: [{
      shop_code: shop,
      customer_id: String(member.customer.id),
      token_hash: tokenHash,
      auth_method: authMethod,
      expires_at: expiresAt,
      last_seen_at: new Date().toISOString(),
    }],
  });
  const session = Array.isArray(rows) ? rows[0] : rows;
  return { session_token: token, expires_at: expiresAt, auth_method: authMethod, session_id: session?.id };
}

async function requireMemberSession(request, env, shop) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, '会員セッションが必要です。');
  const tokenHash = await hashText(token);
  const now = new Date().toISOString();
  const rows = await supabase(env, 'estate_member_sessions', {
    query: `token_hash=eq.${encodeURIComponent(tokenHash)}&shop_code=eq.${encodeURIComponent(shop)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=*&limit=1`,
  });
  const session = Array.isArray(rows) ? rows[0] : null;
  if (!session) throw new HttpError(401, '会員セッションの有効期限が切れました。もう一度本人確認してください。');
  await supabase(env, 'estate_member_sessions', {
    method: 'PATCH', query: `id=eq.${encodeURIComponent(session.id)}`, prefer: 'return=minimal', body: { last_seen_at: now },
  }).catch(() => null);
  return { session, tokenHash };
}

async function memberProfile(env, shop, session) {
  const member = await memberByCustomerId(env, shop, session.customer_id);
  const cases = await supabase(env, 'estate_application_cases', {
    query: `shop_code=eq.${encodeURIComponent(shop)}&customer_id=eq.${encodeURIComponent(session.customer_id)}&select=*&order=updated_at.desc&limit=1`,
  });
  const customer = member.customer || {};
  return {
    customer: {
      customer_name: cleanText(customer.customer_name, 300),
      masked_phone: maskPhone(customer.phone),
      line_display_name: cleanText(customer.line_display_name, 300),
      contact_method: cleanText(customer.contact_method, 100),
      customer_status: cleanText(customer.customer_status, 100),
      last_contact_at: cleanText(customer.last_contact_at, 50),
    },
    preference: safePreference(member.preference),
    reservations: member.reservations.map(safeReservation).sort((a, b) => `${a.reservation_date || ''} ${a.reservation_time || ''}`.localeCompare(`${b.reservation_date || ''} ${b.reservation_time || ''}`)),
    application_case: safeApplicationCase(Array.isArray(cases) ? cases[0] : null),
    auth_method: session.auth_method,
    session_expires_at: session.expires_at,
  };
}

async function saveRevisitRequest(env, shop, session, body, preference) {
  const operation = cleanText(body.operation_id, 200);
  if (!operation) throw new HttpError(400, 'operation_idが必要です。');
  const existing = await supabase(env, 'estate_member_revisit_requests', {
    query: `shop_code=eq.${encodeURIComponent(shop)}&operation_id=eq.${encodeURIComponent(operation)}&select=*&limit=1`,
  });
  if (Array.isArray(existing) && existing[0]) return { row: existing[0], duplicate: true };
  const rows = await supabase(env, 'estate_member_revisit_requests', {
    method: 'POST', prefer: 'return=representation', body: [{
      shop_code: shop,
      customer_id: String(session.customer_id),
      session_id: session.id,
      request_type: cleanText(body.request_type, 50) === 'new_search' ? 'new_search' : 'same_preferences',
      preference_snapshot: safePreference(preference),
      status: '受付',
      operation_id: operation,
      updated_at: new Date().toISOString(),
    }],
  });
  return { row: Array.isArray(rows) ? rows[0] : rows, duplicate: false };
}

async function memberSecuritySelfTest(env, shop) {
  const token = randomToken(32);
  const tokenHash = await hashText(token);
  const customerId = `member-check-${Date.now()}`;
  const operation = `${customerId}-revisit`;
  let sessionId = null;
  let revisitId = null;
  let attemptHash = null;
  try {
    const sessions = await supabase(env, 'estate_member_sessions', {
      method: 'POST', prefer: 'return=representation', body: [{
        shop_code: shop, customer_id: customerId, token_hash: tokenHash, auth_method: 'demo', expires_at: new Date(Date.now() + 600000).toISOString(),
      }],
    });
    const session = Array.isArray(sessions) ? sessions[0] : sessions;
    sessionId = session?.id;
    const first = await saveRevisitRequest(env, shop, session, { operation_id: operation, request_type: 'same_preferences' }, { desired_areas: ['検査'] });
    revisitId = first.row?.id;
    const duplicate = await saveRevisitRequest(env, shop, session, { operation_id: operation, request_type: 'same_preferences' }, { desired_areas: ['検査'] });
    attemptHash = await hashText(`${customerId}-attempt`);
    await supabase(env, 'estate_member_auth_attempts', {
      method: 'POST', query: 'on_conflict=key_hash', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ key_hash: attemptHash, shop_code: shop, failed_count: 1 }],
    });
    return {
      ok: Boolean(sessionId && revisitId && duplicate.duplicate && token !== tokenHash),
      token_hash_only: token !== tokenHash,
      revisit_duplicate_guard: Boolean(duplicate.duplicate),
      session_expiry_set: Boolean(session?.expires_at),
    };
  } finally {
    if (revisitId) await supabase(env, 'estate_member_revisit_requests', { method: 'DELETE', query: `id=eq.${encodeURIComponent(revisitId)}`, prefer: 'return=minimal' }).catch(() => null);
    if (sessionId) await supabase(env, 'estate_member_sessions', { method: 'DELETE', query: `id=eq.${encodeURIComponent(sessionId)}`, prefer: 'return=minimal' }).catch(() => null);
    if (attemptHash) await supabase(env, 'estate_member_auth_attempts', { method: 'DELETE', query: `key_hash=eq.${encodeURIComponent(attemptHash)}`, prefer: 'return=minimal' }).catch(() => null);
  }
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
  await supabase(env, 'estate_member_revisit_requests', { method: 'DELETE', query: `shop_code=eq.${encodeURIComponent(shop)}`, prefer: 'return=minimal' }).catch(() => null);
  await supabase(env, 'estate_member_sessions', { method: 'DELETE', query: `shop_code=eq.${encodeURIComponent(shop)}`, prefer: 'return=minimal' }).catch(() => null);
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
      application_intent: stage === 'application' ? '検討中' : '未確認',
      initial_cost_status: '未確認',
      initial_cost_total: 0,
      initial_cost_breakdown: {},
      documents_status: '未案内',
      required_documents: [],
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
          service: 'DPRO Estate NEXT-7 Extension API',
          version: VERSION,
          legacy_api: env.LEGACY_API_BASE || DEFAULT_LEGACY_API,
          supabase_url_set: Boolean(env.SUPABASE_URL),
          supabase_service_key_set: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
          admin_code_secret_set: Boolean(env.DPRO_ESTATE_ADMIN_CODE || env.ADMIN_CODE),
          auth_strategy: 'local-secret-with-legacy-fallback',
          idempotency_guard: true,
          application_features: ['application_intent','initial_cost','required_documents','individual_line_copy'],
          member_security: {
            secure_session: true,
            reservation_code_verification: true,
            phone_only_production: false,
            phone_only_demo: true,
            line_id_token_ready: true,
            line_channel_configured: Boolean(env.LINE_CHANNEL_ID),
            rate_limit: true,
            revisit_request: true,
          },
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === '/api/public/member/session' && request.method === 'POST') {
        const body = await parseJson(request);
        const shop = shopCode(url, body);
        const result = await createMemberSession(request, env, shop, body);
        return json(request, env, { ok: true, version: VERSION, ...result }, 201);
      }
      if (url.pathname === '/api/public/member/profile' && request.method === 'GET') {
        const shop = shopCode(url, {});
        const { session } = await requireMemberSession(request, env, shop);
        const profile = await memberProfile(env, shop, session);
        return json(request, env, { ok: true, version: VERSION, profile });
      }
      if (url.pathname === '/api/public/member/revisit' && request.method === 'POST') {
        const body = await parseJson(request);
        const shop = shopCode(url, body);
        const { session } = await requireMemberSession(request, env, shop);
        const member = await memberByCustomerId(env, shop, session.customer_id);
        const result = await saveRevisitRequest(env, shop, session, body, member.preference);
        return json(request, env, { ok: true, version: VERSION, duplicate: result.duplicate, revisit_request: { id: result.row?.id, status: result.row?.status, created_at: result.row?.created_at } }, result.duplicate ? 200 : 201);
      }
      if (url.pathname === '/api/public/member/logout' && request.method === 'POST') {
        const body = await parseJson(request);
        const shop = shopCode(url, body);
        const { session } = await requireMemberSession(request, env, shop);
        await supabase(env, 'estate_member_sessions', { method: 'PATCH', query: `id=eq.${encodeURIComponent(session.id)}`, prefer: 'return=minimal', body: { revoked_at: new Date().toISOString() } });
        return json(request, env, { ok: true, version: VERSION, logged_out: true });
      }

      const body = await parseJson(request);
      body.operation_id = operationId(request, body) || body.operation_id;
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
