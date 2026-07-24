(function () {
  'use strict';

  const CONFIG = window.DPRO_ESTATE_CONFIG || {};
  const BASE = String(CONFIG.nextApiBase || '').replace(/\/$/, '');
  let sessionToken = '';

  async function request(path, { method = 'GET', body = null, token = sessionToken } = {}) {
    if (!BASE) throw new Error('会員APIが未設定です。');
    const url = new URL(BASE + path);
    url.searchParams.set('shop_code', CONFIG.shopCode || 'dpro_estate_demo');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url.toString(), {
      method,
      headers,
      cache: 'no-store',
      body: body === null ? undefined : JSON.stringify({ ...body, shop_code: CONFIG.shopCode || 'dpro_estate_demo' }),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `会員APIエラー ${response.status}`);
    return data;
  }

  const client = {
    version: 'ESTATE-NEXT-7',
    base: BASE,
    setSessionToken(token) { sessionToken = String(token || ''); },
    clearSessionToken() { sessionToken = ''; },
    createSession(payload) { return request('/api/public/member/session', { method: 'POST', body: payload, token: '' }); },
    profile() { return request('/api/public/member/profile'); },
    revisit(payload) { return request('/api/public/member/revisit', { method: 'POST', body: payload }); },
    logout() { return request('/api/public/member/logout', { method: 'POST', body: {} }); },
  };

  window.DPRO_ESTATE_MEMBER_API = Object.freeze(client);
}());
