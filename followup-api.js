(function () {
  'use strict';

  const CONFIG = window.DPRO_ESTATE_CONFIG || {};
  const BASE = String(CONFIG.nextApiBase || '').replace(/\/$/, '');
  const SHOP = CONFIG.shopCode || 'dpro_estate_demo';

  async function request(path, { method = 'GET', adminCode = '', query = {}, body = null, operationId = '' } = {}) {
    if (!BASE) throw new Error('追客APIが未設定です。');
    const url = new URL(BASE + path);
    url.searchParams.set('shop_code', SHOP);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    const headers = { 'Content-Type': 'application/json' };
    if (adminCode) {
      headers['X-DPRO-Admin-Code'] = adminCode;
      headers['X-Admin-Code'] = adminCode;
    }
    if (operationId) headers['X-Idempotency-Key'] = operationId;
    const response = await fetch(url.toString(), {
      method,
      headers,
      cache: 'no-store',
      body: body === null ? undefined : JSON.stringify({
        ...body,
        shop_code: SHOP,
        admin_code: adminCode,
        operation_id: operationId || body.operation_id || undefined,
      }),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `追客APIエラー ${response.status}`);
    return data;
  }

  function newOperationId(prefix = 'followup') {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${random}`;
  }

  const client = {
    version: 'ESTATE-NEXT-8',
    base: BASE,
    newOperationId,
    health() { return request('/api/health'); },
    listTasks(adminCode, options = {}) {
      return request('/api/admin/followup-tasks', { adminCode, query: options });
    },
    createTask(adminCode, payload) {
      return request('/api/admin/followup-tasks', { method: 'POST', adminCode, body: payload, operationId: payload.operation_id || newOperationId('task-create') });
    },
    updateTask(adminCode, payload) {
      return request('/api/admin/followup-tasks', { method: 'PATCH', adminCode, body: payload, operationId: payload.operation_id || newOperationId('task-update') });
    },
    generateTasks(adminCode) {
      return request('/api/admin/followup-tasks/generate', { method: 'POST', adminCode, body: {}, operationId: newOperationId('task-generate') });
    },
    listRevisits(adminCode, options = {}) {
      return request('/api/admin/revisit-requests', { adminCode, query: options });
    },
    updateRevisit(adminCode, payload) {
      return request('/api/admin/revisit-requests', { method: 'PATCH', adminCode, body: payload, operationId: payload.operation_id || newOperationId('revisit-update') });
    },
    getExclusions(adminCode, customerId) {
      return request('/api/admin/customer-exclusions', { adminCode, query: { customer_id: customerId } });
    },
    saveExclusions(adminCode, payload) {
      return request('/api/admin/customer-exclusions', { method: 'PATCH', adminCode, body: payload, operationId: payload.operation_id || newOperationId('exclusion-save') });
    },
    candidates(adminCode, customerId, includeProposed = false) {
      return request('/api/admin/property-candidates', { adminCode, query: { customer_id: customerId, include_proposed: includeProposed ? '1' : '' } });
    },
    listProposals(adminCode, options = {}) {
      return request('/api/admin/property-proposals', { adminCode, query: options });
    },
    createProposal(adminCode, payload) {
      return request('/api/admin/property-proposals', { method: 'POST', adminCode, body: payload, operationId: payload.operation_id || newOperationId('proposal-create') });
    },
    updateProposal(adminCode, payload) {
      return request('/api/admin/property-proposals', { method: 'PATCH', adminCode, body: payload, operationId: payload.operation_id || newOperationId('proposal-update') });
    },
  };

  window.DPRO_ESTATE_FOLLOWUP_API = Object.freeze(client);
}());
