(function () {
  'use strict';

  const CONFIG = window.DPRO_ESTATE_CONFIG || {};
  const BASE = String(CONFIG.nextApiBase || '').replace(/\/$/, '');

  async function request(path, { method = 'GET', adminCode = '', shopCode = CONFIG.shopCode || 'dpro_estate_demo', query = {}, body = null } = {}) {
    if (!BASE) throw new Error('NEXT-4拡張APIが未設定です。');
    const url = new URL(BASE + path);
    url.searchParams.set('shop_code', shopCode);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, value);
    });
    const headers = { 'Content-Type': 'application/json' };
    if (adminCode) {
      headers['X-DPRO-Admin-Code'] = adminCode;
      headers['X-Admin-Code'] = adminCode;
    }
    const init = { method, headers };
    if (body !== null) init.body = JSON.stringify({ ...body, shop_code: shopCode, admin_code: adminCode });
    const response = await fetch(url.toString(), init);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `拡張APIエラー ${response.status}`);
    return data;
  }

  const client = {
    version: 'ESTATE-NEXT-4',
    base: BASE,
    health() {
      return request('/api/health', { query: {} });
    },
    systemCheck(adminCode, writeTest = false) {
      return request('/api/admin/system-check', { adminCode, query: { write_test: writeTest ? '1' : '' } });
    },
    listCases(adminCode, { limit = 200, offset = 0, stageKey = '', customerId = '' } = {}) {
      return request('/api/admin/application-cases', { adminCode, query: { limit, offset, stage_key: stageKey, customer_id: customerId } });
    },
    createCase(adminCode, payload) {
      return request('/api/admin/application-cases', { method: 'POST', adminCode, body: payload });
    },
    updateCase(adminCode, payload) {
      return request('/api/admin/application-cases', { method: 'PATCH', adminCode, body: payload });
    },
    listVacancyChecks(adminCode, propertyId, limit = 20) {
      return request('/api/admin/vacancy-checks', { adminCode, query: { property_id: propertyId, limit } });
    },
    recordVacancyCheck(adminCode, payload) {
      return request('/api/admin/vacancy-checks', { method: 'POST', adminCode, body: payload });
    },
    prepareDemo(adminCode) {
      return request('/api/admin/demo/prepare', { method: 'POST', adminCode, body: {} });
    },
  };

  window.DPRO_ESTATE_NEXT4_API = Object.freeze(client);
}());
