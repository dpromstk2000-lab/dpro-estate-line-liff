(function () {
  'use strict';

  const cfg = window.DPRO_ESTATE_CONFIG || {};
  const STATUS = Object.freeze({ OK: 'OK', ATTENTION: '注意', NG: 'NG' });
  const PUBLIC_PAGES = Object.freeze([
    { key: 'index', label: 'お客様画面', path: 'index.html', public: true },
    { key: 'member', label: 'マイページ', path: 'member.html', public: true },
    { key: 'property', label: '物件詳細', path: 'property.html', public: true },
    { key: 'owner', label: 'PC管理画面', path: 'owner.html', public: false },
    { key: 'ipad', label: 'iPad画面', path: 'owner-ipad.html', public: false },
    { key: 'followup', label: '追客画面', path: 'followup.html', public: false },
    { key: 'settings', label: '店舗設定', path: 'owner-settings.html', public: false }
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeBase(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function maskText(value) {
    return String(value || '')
      .replace(/(admin[_-]?code|code|token|phone)(["'\s:=]+)([^,"'\s}]+)/gi, '$1$2***')
      .slice(0, 1000);
  }

  function detail(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return maskText(value);
    try { return maskText(JSON.stringify(value)); }
    catch { return String(value); }
  }

  async function timedFetch(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
          Accept: 'application/json,text/plain,*/*',
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      const elapsedMs = Math.round(performance.now() - started);
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; }
      catch { data = null; }
      return {
        ok: response.ok,
        status: response.status,
        elapsedMs,
        headers: {
          cacheControl: response.headers.get('Cache-Control') || '',
          contentType: response.headers.get('Content-Type') || '',
          allowOrigin: response.headers.get('Access-Control-Allow-Origin') || ''
        },
        data,
        text: text.slice(0, 200000)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function makeCheck(key, label, category, status, message, meta = {}) {
    return { key, label, category, status, message, ...meta };
  }

  function budgetStatus(elapsedMs, budgetMs) {
    if (!Number.isFinite(elapsedMs)) return STATUS.NG;
    if (elapsedMs <= budgetMs) return STATUS.OK;
    if (elapsedMs <= budgetMs * 2) return STATUS.ATTENTION;
    return STATUS.NG;
  }

  async function fetchPage(page, cacheBust) {
    const base = normalizeBase(cfg.pageBase || location.origin + location.pathname.replace(/\/[^/]*$/, ''));
    const url = `${base}/${page.path}?v=estate-next-9-${cacheBust}`;
    const result = await timedFetch(url, { headers: { Accept: 'text/html' } }, 15000);
    const ids = [];
    const duplicates = [];
    if (result.ok) {
      const doc = new DOMParser().parseFromString(result.text, 'text/html');
      doc.querySelectorAll('[id]').forEach((node) => {
        const id = node.id;
        if (ids.includes(id) && !duplicates.includes(id)) duplicates.push(id);
        ids.push(id);
      });
    }
    return { ...result, url, duplicates };
  }

  function publicExposureFindings(html) {
    const findings = [];
    const rules = [
      { re: /api\/public\/member\?phone=/i, label: '電話番号だけの旧会員API参照' },
      { re: /admin_code=/i, label: '管理コードのURL埋込み' },
      { re: /value=["']1234["']/i, label: '管理コード1234の固定表示' },
      { re: /localStorage\.setItem\([^)]*(phone|name)/i, label: '氏名・電話番号のlocalStorage保存' }
    ];
    for (const rule of rules) if (rule.re.test(html)) findings.push(rule.label);
    return findings;
  }

  async function run(options = {}) {
    const adminCode = String(options.adminCode || '').trim();
    const checks = [];
    const cacheBust = Date.now();
    const budgets = cfg.performanceBudgetsMs || {};
    const nextBase = normalizeBase(cfg.nextApiBase);
    const legacyBase = normalizeBase(cfg.apiBase);
    const shop = encodeURIComponent(cfg.shopCode || 'dpro_estate_demo');
    const authHeaders = adminCode ? {
      'X-DPRO-Admin-Code': adminCode,
      'X-Admin-Code': adminCode
    } : {};

    const health = await timedFetch(`${nextBase}/api/health`, {}, 12000);
    if (!health.ok || health.data?.ok !== true) {
      checks.push(makeCheck('next-health', '拡張Worker health', 'API', STATUS.NG, health.data?.error || `HTTP ${health.status}`, { elapsedMs: health.elapsedMs }));
    } else {
      const diag = health.data?.diagnostics || {};
      const bindingOk = diag.legacy_service_binding_set === true && diag.legacy_transport === 'service_binding';
      checks.push(makeCheck('next-health', '拡張Worker health', 'API', budgetStatus(health.elapsedMs, budgets.health || 2000), `${health.data.version || '-'} / ${health.elapsedMs}ms`, { elapsedMs: health.elapsedMs }));
      checks.push(makeCheck('service-binding', '既存Worker Service Binding', 'セキュリティ', bindingOk ? STATUS.OK : STATUS.NG, bindingOk ? 'LEGACY_ESTATE_API 接続済み' : 'Service Bindingが未設定です。'));
      checks.push(makeCheck('cache-control', 'APIキャッシュ制御', 'セキュリティ', /no-store/i.test(health.headers.cacheControl) ? STATUS.OK : STATUS.ATTENTION, health.headers.cacheControl || 'Cache-Controlなし'));
    }

    if (!adminCode) {
      checks.push(makeCheck('admin-auth', '管理コード認証', 'セキュリティ', STATUS.NG, '管理コードを入力してください。'));
    } else {
      const system = await timedFetch(`${nextBase}/api/admin/system-check?shop_code=${shop}&write_test=0`, { headers: authHeaders }, 20000);
      if (!system.ok || system.data?.ok !== true) {
        checks.push(makeCheck('admin-auth', '管理コード認証・全体API検査', 'セキュリティ', STATUS.NG, system.data?.error || `HTTP ${system.status}`, { elapsedMs: system.elapsedMs }));
      } else {
        checks.push(makeCheck('admin-auth', '管理コード認証・全体API検査', 'セキュリティ', budgetStatus(system.elapsedMs, budgets.adminSystemCheck || 5000), `認証OK / ${system.elapsedMs}ms`, { elapsedMs: system.elapsedMs }));
        const tables = new Map((system.data.tables || []).map((row) => [row.table, row.ok]));
        const requiredTables = [
          'estate_application_cases', 'estate_case_events', 'estate_vacancy_checks',
          'estate_member_sessions', 'estate_member_auth_attempts', 'estate_member_revisit_requests',
          'estate_followup_tasks', 'estate_property_proposals', 'estate_customer_exclusions'
        ];
        const missing = requiredTables.filter((name) => tables.get(name) !== true);
        checks.push(makeCheck('supabase-tables', 'Supabase 9テーブル', 'データ', missing.length ? STATUS.NG : STATUS.OK, missing.length ? `未確認: ${missing.join(', ')}` : '9テーブルすべてOK'));
        const followup = system.data.followup_test || {};
        const followupOk = ['task_duplicate_guard','proposal_duplicate_guard','exclusion_duplicate_guard','revisit_duplicate_guard','candidate_match_logic'].every((key) => followup[key] === true);
        checks.push(makeCheck('duplicate-guards', '追客・提案の二重操作防止', 'データ', followupOk ? STATUS.OK : STATUS.NG, followupOk ? '全ガードOK' : detail(followup)));
        const member = system.data.member_security_test || {};
        checks.push(makeCheck('member-security', '会員セッション保護', 'セキュリティ', member.ok === true && member.token_hash_only === true ? STATUS.OK : STATUS.NG, member.ok === true ? 'トークンハッシュ・期限・再相談ガードOK' : detail(member)));
      }
    }

    const publicApis = [
      ['legacy-health', '既存Worker health', `${legacyBase}/api/health`],
      ['public-settings', '公開店舗設定', `${legacyBase}/api/public/settings`],
      ['public-areas', '公開エリア', `${legacyBase}/api/public/areas`],
      ['public-properties', '公開物件', `${legacyBase}/api/public/properties?limit=20`]
    ];
    for (const [key, label, url] of publicApis) {
      const result = await timedFetch(url, {}, 12000);
      checks.push(makeCheck(key, label, 'API', result.ok && result.data?.ok !== false ? budgetStatus(result.elapsedMs, budgets.publicApi || 3500) : STATUS.NG, result.ok ? `${result.elapsedMs}ms` : (result.data?.error || `HTTP ${result.status}`), { elapsedMs: result.elapsedMs }));
    }

    const phoneProbe = await timedFetch(`${legacyBase}/api/public/member?phone=00000000000`, {}, 12000);
    const probeData = phoneProbe.data && typeof phoneProbe.data === 'object' ? phoneProbe.data : {};
    const ignoredMetaKeys = new Set(['ok', 'found', 'count', 'total', 'message', 'error', 'version', 'status']);
    const hasPayloadValue = (value) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.some((item) => hasPayloadValue(item));
      if (typeof value === 'object') {
        return Object.entries(value).some(([key, item]) => !ignoredMetaKeys.has(String(key).toLowerCase()) && hasPayloadValue(item));
      }
      if (typeof value === 'string') return value.trim() !== '';
      if (typeof value === 'boolean') return value === true;
      if (typeof value === 'number') return Number.isFinite(value);
      return true;
    };
    const sensitiveFields = ['customer', 'member', 'reservations', 'reservation', 'profile', 'preference', 'phone', 'name', 'customer_name', 'line_display_name'];
    const exposedFields = sensitiveFields.filter((key) => hasPayloadValue(probeData[key]));
    if (probeData.found === true && !exposedFields.includes('found')) exposedFields.push('found');
    if (phoneProbe.ok && exposedFields.length) {
      checks.push(makeCheck('legacy-phone-endpoint', '旧電話番号だけ会員照会', 'セキュリティ', STATUS.NG, `匿名照会で実データ項目を返しました: ${exposedFields.join(', ')}`));
    } else {
      const responseKind = phoneProbe.ok ? '該当データなしの互換レスポンス' : `HTTP ${phoneProbe.status}`;
      checks.push(makeCheck('legacy-phone-endpoint', '旧電話番号だけ会員照会', 'セキュリティ', STATUS.ATTENTION, `公開画面からは削除済み。${responseKind}を確認しました。旧Worker原本がないためエンドポイント自体の直接遮断は未確認です。`));
    }

    for (const page of PUBLIC_PAGES) {
      const result = await fetchPage(page, cacheBust);
      if (!result.ok) {
        checks.push(makeCheck(`page-${page.key}`, page.label, '画面', STATUS.NG, `HTTP ${result.status}`, { elapsedMs: result.elapsedMs, url: result.url }));
        continue;
      }
      const findings = page.public ? publicExposureFindings(result.text) : [];
      let status = budgetStatus(result.elapsedMs, budgets.page || 5000);
      let message = `${result.elapsedMs}ms`;
      if (result.duplicates.length) {
        status = STATUS.NG;
        message += ` / 重複ID: ${result.duplicates.join(', ')}`;
      }
      if (findings.length) {
        status = STATUS.NG;
        message += ` / 公開情報リスク: ${findings.join(', ')}`;
      }
      checks.push(makeCheck(`page-${page.key}`, page.label, '画面', status, message, { elapsedMs: result.elapsedMs, url: result.url }));
    }

    const counts = checks.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});
    const overall = counts[STATUS.NG] ? STATUS.NG : (counts[STATUS.ATTENTION] ? STATUS.ATTENTION : STATUS.OK);
    return {
      system: cfg.systemName || 'DPRO 不動産・賃貸内見 LINE',
      version: cfg.version || 'ESTATE-NEXT-10',
      generatedAt: nowIso(),
      overall,
      counts: { ok: counts[STATUS.OK] || 0, attention: counts[STATUS.ATTENTION] || 0, ng: counts[STATUS.NG] || 0 },
      checks
    };
  }

  async function prepareDemo(adminCode) {
    const nextBase = normalizeBase(cfg.nextApiBase);
    const shop = encodeURIComponent(cfg.shopCode || 'dpro_estate_demo');
    return timedFetch(`${nextBase}/api/admin/demo/prepare?shop_code=${shop}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DPRO-Admin-Code': adminCode,
        'X-Admin-Code': adminCode
      },
      body: JSON.stringify({ shop_code: cfg.shopCode || 'dpro_estate_demo' })
    }, 25000);
  }

  window.DPRO_ESTATE_SYSTEM_CHECK = Object.freeze({ run, prepareDemo, STATUS, pages: PUBLIC_PAGES });
}());
