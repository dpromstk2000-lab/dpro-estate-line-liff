(function () {
  'use strict';

  const STAGES = Object.freeze([
    Object.freeze({ key: 'inquiry', label: '新規問い合わせ', order: 10 }),
    Object.freeze({ key: 'conditions', label: '希望条件確認', order: 20 }),
    Object.freeze({ key: 'proposal', label: '物件提案', order: 30 }),
    Object.freeze({ key: 'viewing', label: '内見調整・予約', order: 40 }),
    Object.freeze({ key: 'viewed', label: '内見済み', order: 50 }),
    Object.freeze({ key: 'application', label: '申込検討・希望', order: 60 }),
    Object.freeze({ key: 'contracted', label: '成約', order: 70 }),
    Object.freeze({ key: 'closed', label: '見送り', order: 80 })
  ]);

  const CUSTOMER_STAGE = Object.freeze({
    '初回問い合わせ': 'inquiry',
    '希望条件確認中': 'conditions',
    '物件提案済み': 'proposal',
    '内見予約済み': 'viewing',
    '内見済み': 'viewed',
    '申込検討中': 'application',
    '申込希望': 'application',
    '申込受付': 'application',
    '成約': 'contracted',
    '成約済み': 'contracted',
    '見送り': 'closed',
    'キャンセル': 'closed',
    '長期フォロー': 'closed'
  });

  const RESERVATION_STAGE = Object.freeze({
    '予約受付': 'viewing',
    '確認済み': 'viewing',
    '内見済み': 'viewed',
    '申込検討中': 'application',
    '申込希望': 'application',
    '成約': 'contracted',
    '成約済み': 'contracted',
    'キャンセル': 'closed'
  });

  const stageMap = new Map(STAGES.map(stage => [stage.key, stage]));

  function text(value) {
    return String(value ?? '').trim();
  }

  function customerId(customer) {
    return text(customer?.id || customer?.customer_id || customer?.phone_normalized || customer?.phone);
  }

  function reservationDateTime(reservation) {
    const date = text(reservation?.reservation_date);
    const time = text(reservation?.reservation_time).slice(0, 5) || '00:00';
    return `${date}T${time}`;
  }

  function latestReservation(reservations) {
    return [...reservations].sort((a, b) => reservationDateTime(b).localeCompare(reservationDateTime(a)))[0] || null;
  }

  function resolveStage(customer, reservation) {
    const customerKey = CUSTOMER_STAGE[text(customer?.customer_status)];
    const reservationKey = RESERVATION_STAGE[text(reservation?.status)];
    const candidates = [customerKey, reservationKey]
      .filter(Boolean)
      .map(key => stageMap.get(key))
      .filter(Boolean)
      .sort((a, b) => b.order - a.order);
    return candidates[0] || stageMap.get('inquiry');
  }

  function applicationState(customer, reservation) {
    const status = text(customer?.customer_status || reservation?.status);
    if (['成約', '成約済み'].includes(status)) return '成約';
    if (status === '申込希望' || status === '申込受付') return '申込希望';
    if (status === '申込検討中') return '申込検討中';
    if (['見送り', 'キャンセル', '長期フォロー'].includes(status)) return '見送り・保留';
    return '申込前';
  }

  function nextAction(stageKey) {
    const actions = {
      inquiry: '希望条件を確認',
      conditions: '条件に合う物件を提案',
      proposal: '内見候補日を確認',
      viewing: '内見前確認・案内',
      viewed: '感想確認と申込意思確認',
      application: '申込内容と必要書類を確認',
      contracted: '成約後の案内を確認',
      closed: '見送り理由・再提案時期を確認'
    };
    return actions[stageKey] || '次の対応を確認';
  }

  function buildCases(customers = [], reservations = []) {
    const customerMap = new Map();
    const reservationMap = new Map();

    for (const customer of customers) {
      const id = customerId(customer);
      if (id) customerMap.set(id, customer);
    }

    for (const reservation of reservations) {
      const nested = reservation?.customer || {};
      const id = customerId(nested) || text(reservation?.customer_id);
      if (!id) continue;
      if (!customerMap.has(id)) customerMap.set(id, nested);
      if (!reservationMap.has(id)) reservationMap.set(id, []);
      reservationMap.get(id).push(reservation);
    }

    return [...customerMap.entries()].map(([id, customer]) => {
      const related = reservationMap.get(id) || [];
      const latest = latestReservation(related);
      const stage = resolveStage(customer, latest);
      const property = latest?.property || null;
      return Object.freeze({
        id,
        customer,
        reservation: latest,
        property,
        stageKey: stage.key,
        stageLabel: stage.label,
        stageOrder: stage.order,
        applicationState: applicationState(customer, latest),
        nextAction: nextAction(stage.key),
        hasPersistentApplicationCase: Boolean(
          customer?.application_id || latest?.application_id || latest?.application_case_id
        )
      });
    }).sort((a, b) => {
      if (a.stageOrder !== b.stageOrder) return b.stageOrder - a.stageOrder;
      return reservationDateTime(b.reservation).localeCompare(reservationDateTime(a.reservation));
    });
  }

  function counts(cases) {
    const result = Object.fromEntries(STAGES.map(stage => [stage.key, 0]));
    for (const item of cases) result[item.stageKey] = (result[item.stageKey] || 0) + 1;
    result.all = cases.length;
    return result;
  }

  window.DPRO_ESTATE_DOMAIN = Object.freeze({
    version: 'ESTATE-NEXT-3',
    stages: STAGES,
    customerStageMap: CUSTOMER_STAGE,
    reservationStageMap: RESERVATION_STAGE,
    buildCases,
    counts
  });
}());
