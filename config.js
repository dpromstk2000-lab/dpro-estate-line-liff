(function () {
  'use strict';

  const CONFIG = {
    systemName: 'DPRO 不動産・賃貸内見 LINE',
    version: 'ESTATE-NEXT-6',
    apiBase: 'https://dpro-estate-line-api.dpromstk2000.workers.dev',
    nextApiBase: 'https://dpro-estate-next4-api.dpromstk2000.workers.dev',
    pageBase: 'https://dpromstk2000-lab.github.io/dpro-estate-line-liff',
    shopCode: 'dpro_estate_demo',
    storage: {
      adminCode: 'dpro_estate_admin_code',
      apiBase: 'estate_api_base',
      ownerPanel: 'dpro_estate_owner_panel',
      ipadPanel: 'dpro_estate_ipad_panel',
      settingsPanel: 'dpro_estate_settings_panel'
    },
    demo: {
      queryKey: 'demo',
      queryValue: '1',
      adminCode: '1234'
    }
  };

  window.DPRO_ESTATE_CONFIG = Object.freeze({
    ...CONFIG,
    storage: Object.freeze({ ...CONFIG.storage }),
    demo: Object.freeze({ ...CONFIG.demo })
  });
}());
