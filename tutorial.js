/* DPRO TUTORIAL STANDARD V1.1 / ESTATE R3 */
(function () {
  'use strict';

  const TUTORIAL_ID = 'estate-first10-v1.1';
  const SCHEMA_VERSION = '1.1.0';
  const STORAGE_KEY = 'dpro_tutorial_estate_first10_v1_1';
  const TOTAL = 10;
  const EDGE = 8;
  const STEP_ROUTES = {
    1: 'index.html?demo=1', 2: 'index.html?demo=1', 3: 'index.html?demo=1',
    4: 'index.html?demo=1', 5: 'index.html?demo=1', 6: 'member.html?demo=1',
    7: 'followup.html?demo=1', 8: 'followup.html?demo=1',
    9: 'owner-ipad.html?demo=1', 10: 'owner.html?demo=1'
  };
  const STEPS = Object.freeze([
    { number:1, route:'index.html', title:'公開操作デモの範囲を確認', body:'架空データ専用の内見予約デモであることと、実在する個人情報を入力しないことを確認します。', targets:['.operation-demo-banner','.hero','body'], facts:['公開操作デモ','架空データ','公式説明ページとは別'] },
    { number:2, route:'index.html', title:'希望条件の入力場所を確認', body:'希望エリア、家賃上限、間取り、こだわり条件が物件候補と予約内容へ反映される構成を確認します。入力は任意で、チュートリアルは個人情報を要求しません。', targets:['#areaChips','#maxRent','#reserve'], facts:['エリア複数選択','家賃上限','間取り','こだわり条件'] },
    { number:3, route:'index.html', title:'物件候補と選択の流れを確認', body:'条件に近い物件、もっと見る、物件未定で相談の3つの選び方を確認します。物件選択は画面内状態だけで、予約送信は行いません。', targets:['#propertyList','#properties','#filterByConditionBtn'], facts:['おすすめ3件','もっと見る','物件未定相談'] },
    { number:4, route:'index.html', title:'内見日時と集合方法を確認', body:'公開の空き枠を読み取り、予約日、予約時間、店舗来店・現地集合・オンライン等の入力場所を確認します。', targets:['#reservationDate','#slotList','#meetingType'], facts:['公開空き枠GET','日付','時間','集合方法'] },
    { number:5, route:'index.html', title:'予約内容を確認し、送信境界を理解', body:'右側の予約内容確認で入力内容を確認します。実際の「この内容で内見予約する」は業務データを作るため、First10では押しません。', targets:['#summaryBox','.sticky-card','#member'], facts:['確認サマリー','送信は対象外','安全な予約確認へ進む'] },
    { number:6, route:'member.html', title:'お客様マイページの本人確認境界', body:'電話番号だけでは表示せず、受付番号またはLINE本人確認を組み合わせる安全境界を確認します。セッション作成や再相談登録は行いません。', targets:['#authCard:not(.hidden)','#memberArea:not(.hidden)','#sessionStatus'], facts:['電話番号だけでは非表示','受付番号またはLINE確認','再相談は明示操作'] },
    { number:7, route:'followup.html', title:'今日の追客と再相談を確認', body:'未完了、期限超過、本日期限、再相談依頼のKPIと一覧構成を読み取ります。状態更新やタスク生成は行いません。', targets:['#kpiArea','#panel-today','#authCard'], facts:['期限優先','再相談一覧','読取のみ'] },
    { number:8, route:'followup.html', title:'同じ画面の物件提案タブを確認', body:'追客画面内で顧客条件、候補物件、除外条件、過去提案を照合する場所を確認します。保存・除外・提案履歴作成は行いません。', targets:[".tab[data-panel='proposal']",'#panel-proposal','#candidateSummary'], facts:['SAME SCREEN','候補照合','過去提案除外'] },
    { number:9, route:'owner-ipad.html', title:'現場スタッフ画面の優先業務を確認', body:'今日・明日の内見、本日追客、案件、空室、LINE文面の入口を確認します。更新・保存・記録操作は行いません。', targets:['#kpiArea','.nav','#authCard'], facts:['今日の内見','追客','案件','空室','個別LINE'] },
    { number:10, route:'owner.html', title:'オーナーPCで全体管理を確認', body:'今日やること、内見予約、顧客カルテ、物件管理、案件進捗、LINE文面コピーを横断できることを確認してFirst10を完了します。', targets:["[data-panel-button='today']","[data-panel-button='cases']",'#kpiArea','#authCard'], facts:['管理全体像','案件進捗','個別確認型LINE'] }
  ]);

  let state = loadState();
  let root;
  let launcher;
  let card;
  let highlight;
  let targetElement = null;
  let targetObserver = null;
  let targetTimer = null;
  let lastLauncherFocus = null;
  let dragging = null;
  const diagnostics = [];

  function defaultState() {
    return {
      tutorialId: TUTORIAL_ID,
      schemaVersion: SCHEMA_VERSION,
      status: 'not_started',
      currentStep: 1,
      completedSteps: [],
      currentRoute: routeName(),
      cardPosition: { x: .5, y: .12 },
      startedAt: null,
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.tutorialId !== TUTORIAL_ID || parsed.schemaVersion !== SCHEMA_VERSION) return defaultState();
      parsed.currentStep = clampStep(parsed.currentStep);
      parsed.completedSteps = Array.isArray(parsed.completedSteps) ? [...new Set(parsed.completedSteps.filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL))] : [];
      parsed.cardPosition = validPosition(parsed.cardPosition) ? parsed.cardPosition : { x:.5, y:.12 };
      return parsed;
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    state.currentStep = clampStep(state.currentStep);
    state.currentRoute = routeName();
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    expose();
  }

  function clampStep(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(TOTAL, Math.max(1, Math.round(n))) : 1;
  }

  function validPosition(value) {
    return value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
  }

  function routeName() {
    const name = location.pathname.split('/').pop();
    return name || 'index.html';
  }

  function routeUrl(stepNumber) {
    const relative = STEP_ROUTES[clampStep(stepNumber)];
    const url = new URL(relative, location.href);
    const currentDemo = new URLSearchParams(location.search).get('demo');
    if (currentDemo === '1') url.searchParams.set('demo', '1');
    return url.href;
  }

  function routeMatches(step) {
    return routeName() === step.route;
  }

  function navigateToStep(number) {
    const step = STEPS[clampStep(number) - 1];
    if (routeMatches(step)) {
      renderStep();
      return;
    }
    saveState();
    location.href = routeUrl(number);
  }

  function log(type, detail) {
    diagnostics.push({ at:new Date().toISOString(), type, step:state.currentStep, route:routeName(), ...detail });
    if (diagnostics.length > 150) diagnostics.shift();
    expose();
  }

  function mount() {
    if (document.getElementById('dproTutorialRoot')) return;
    root = document.createElement('div');
    root.id = 'dproTutorialRoot';
    root.innerHTML = `
      <button id="dproTutorialLauncher" type="button"></button>
      <div id="dproTutorialHighlight" hidden aria-hidden="true"></div>
      <section id="dproTutorialCard" role="region" aria-labelledby="dproTutorialTitle" aria-describedby="dproTutorialDescription" tabindex="-1" hidden>
        <div class="dpro-tutorial-header">
          <div class="dpro-tutorial-handle" id="dproTutorialHandle" role="button" tabindex="0" aria-label="ガイドを移動" aria-describedby="dproTutorialMoveHelp">
            <span class="dpro-tutorial-handle-mark">⠿ ガイドを移動</span>
          </div>
          <button class="dpro-tutorial-close" id="dproTutorialClose" type="button" aria-label="ガイドを閉じる">閉じる</button>
        </div>
        <div class="dpro-tutorial-body">
          <div class="dpro-tutorial-progress-row"><span id="dproTutorialProgress">1 / 10</span><span class="dpro-tutorial-progress-bar" aria-hidden="true"><span id="dproTutorialProgressFill"></span></span></div>
          <h2 id="dproTutorialTitle"></h2>
          <p id="dproTutorialDescription"></p>
          <ul id="dproTutorialFacts"></ul>
          <div id="dproTutorialTargetStatus" aria-live="polite"></div>
          <span id="dproTutorialMoveHelp" hidden>矢印キーで10ピクセル、Shiftと矢印キーで1ピクセル移動。Homeで位置を戻します。</span>
          <div class="dpro-tutorial-actions">
            <button class="dpro-tutorial-button" id="dproTutorialBack" type="button">戻る</button>
            <button class="dpro-tutorial-button" id="dproTutorialSkip" type="button">スキップ</button>
            <button class="dpro-tutorial-button primary" id="dproTutorialNext" type="button">次へ</button>
          </div>
          <div class="dpro-tutorial-secondary-actions">
            <button class="dpro-tutorial-button quiet" id="dproTutorialResetPosition" type="button">位置を戻す</button>
            <span aria-hidden="true">Escで一時停止</span>
          </div>
        </div>
      </section>`;
    document.body.appendChild(root);
    launcher = document.getElementById('dproTutorialLauncher');
    card = document.getElementById('dproTutorialCard');
    highlight = document.getElementById('dproTutorialHighlight');
    bind();
    updateLauncher();
    if (state.status === 'in_progress' && routeMatches(STEPS[state.currentStep - 1])) renderStep();
    expose();
  }

  function bind() {
    launcher.addEventListener('click', launch);
    document.getElementById('dproTutorialClose').addEventListener('click', pause);
    document.getElementById('dproTutorialBack').addEventListener('click', back);
    document.getElementById('dproTutorialSkip').addEventListener('click', skip);
    document.getElementById('dproTutorialNext').addEventListener('click', next);
    document.getElementById('dproTutorialResetPosition').addEventListener('click', resetPosition);
    const handle = document.getElementById('dproTutorialHandle');
    handle.addEventListener('pointerdown', pointerDown);
    handle.addEventListener('pointermove', pointerMove);
    handle.addEventListener('pointerup', pointerUp);
    handle.addEventListener('pointercancel', pointerUp);
    handle.addEventListener('keydown', handleKey);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !card.hidden) {
        event.preventDefault();
        pause();
      }
    });
    window.addEventListener('resize', refreshGeometry, { passive:true });
    window.addEventListener('scroll', refreshHighlight, { passive:true, capture:true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refreshGeometry, { passive:true });
      window.visualViewport.addEventListener('scroll', refreshGeometry, { passive:true });
    }
  }

  function launch() {
    lastLauncherFocus = launcher;
    if (state.status === 'completed' || state.status === 'skipped') {
      replay();
      return;
    }
    if (state.status === 'not_started') {
      state.currentStep = 1;
      state.completedSteps = [];
      state.startedAt = new Date().toISOString();
    }
    state.status = 'in_progress';
    saveState();
    navigateToStep(state.currentStep);
  }

  function replay() {
    state = defaultState();
    state.status = 'in_progress';
    state.startedAt = new Date().toISOString();
    saveState();
    navigateToStep(1);
  }

  function pause() {
    if (card.hidden) return;
    state.status = 'paused';
    saveState();
    hideCard();
    updateLauncher();
    launcher.focus({ preventScroll:true });
    log('pause', { focusRestored:document.activeElement === launcher });
  }

  function skip() {
    if (!window.confirm('First10をスキップしますか？「やり直す」からいつでも再開できます。')) return;
    state.status = 'skipped';
    saveState();
    hideCard();
    updateLauncher();
    launcher.focus({ preventScroll:true });
    log('skip', {});
  }

  function back() {
    if (state.currentStep <= 1) return;
    state.currentStep -= 1;
    state.status = 'in_progress';
    saveState();
    navigateToStep(state.currentStep);
  }

  function next() {
    const n = state.currentStep;
    if (!state.completedSteps.includes(n)) state.completedSteps.push(n);
    if (n >= TOTAL) {
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      saveState();
      hideCard();
      updateLauncher();
      launcher.focus({ preventScroll:true });
      log('complete', { completedSteps:state.completedSteps.length });
      return;
    }
    state.currentStep = n + 1;
    saveState();
    navigateToStep(state.currentStep);
  }

  function renderStep() {
    const step = STEPS[state.currentStep - 1];
    if (!routeMatches(step)) {
      navigateToStep(step.number);
      return;
    }
    state.status = 'in_progress';
    saveState();
    document.body.classList.add('dpro-tutorial-active');
    launcher.hidden = true;
    card.hidden = false;
    highlight.hidden = true;
    document.getElementById('dproTutorialProgress').textContent = `${step.number} / ${TOTAL}`;
    document.getElementById('dproTutorialProgressFill').style.width = `${step.number / TOTAL * 100}%`;
    document.getElementById('dproTutorialTitle').textContent = step.title;
    document.getElementById('dproTutorialDescription').textContent = step.body;
    document.getElementById('dproTutorialFacts').innerHTML = step.facts.map(fact => `<li>${escapeHtml(fact)}</li>`).join('');
    document.getElementById('dproTutorialBack').disabled = step.number === 1;
    document.getElementById('dproTutorialNext').textContent = step.number === TOTAL ? '完了' : '次へ';
    placeFromState();
    resolveTarget(step);
    requestAnimationFrame(() => card.focus({ preventScroll:true }));
    log('render', { targetCandidates:step.targets.length });
  }

  function hideCard() {
    document.body.classList.remove('dpro-tutorial-active');
    card.hidden = true;
    highlight.hidden = true;
    targetElement = null;
    clearTargetWait();
  }

  function updateLauncher() {
    if (!launcher) return;
    launcher.hidden = false;
    const labels = {
      not_started:'First10を開始',
      in_progress:'First10を再開',
      paused:'First10を再開',
      completed:'First10をやり直す',
      skipped:'First10をやり直す'
    };
    launcher.textContent = labels[state.status] || labels.not_started;
    launcher.setAttribute('aria-label', `${launcher.textContent}（全10ステップ）`);
  }

  function visibleElement(selector) {
    try {
      return [...document.querySelectorAll(selector)].find(el => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
      }) || null;
    } catch (_) { return null; }
  }

  function resolveTarget(step) {
    clearTargetWait();
    const started = Date.now();
    const attempt = () => {
      for (let i = 0; i < step.targets.length; i += 1) {
        const el = visibleElement(step.targets[i]);
        if (el) {
          targetElement = el;
          document.getElementById('dproTutorialTargetStatus').textContent = i === 0 ? '案内位置を表示しています。' : '代替位置で案内しています。';
          if (!isMostlyVisible(el)) scrollTargetIntoView(el);
          refreshHighlight();
          requestAnimationFrame(() => requestAnimationFrame(refreshHighlight));
          setTimeout(refreshHighlight, 120);
          setTimeout(refreshHighlight, 320);
          log('target', { selector:step.targets[i], fallbackIndex:i, resolved:true });
          clearTargetWait();
          return;
        }
      }
      if (Date.now() - started >= 4500) {
        targetElement = null;
        highlight.hidden = true;
        document.getElementById('dproTutorialTargetStatus').textContent = '対象が読み込み中でも、ガイド操作は続けられます。';
        log('target', { selector:null, fallbackIndex:-1, resolved:false });
        clearTargetWait();
      }
    };
    attempt();
    if (!targetElement) {
      targetObserver = new MutationObserver(attempt);
      targetObserver.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden','style'] });
      targetTimer = setInterval(attempt, 250);
    }
  }

  function clearTargetWait() {
    if (targetObserver) targetObserver.disconnect();
    if (targetTimer) clearInterval(targetTimer);
    targetObserver = null;
    targetTimer = null;
  }

  function isMostlyVisible(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 60 && r.top < window.innerHeight - 60 && r.right > 0 && r.left < window.innerWidth;
  }

  function scrollTargetIntoView(el) {
    const html = document.documentElement;
    const body = document.body;
    const previousHtml = html.style.scrollBehavior;
    const previousBody = body.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    body.style.scrollBehavior = 'auto';
    el.scrollIntoView({ behavior:'auto', block:'center', inline:'nearest' });
    requestAnimationFrame(() => {
      html.style.scrollBehavior = previousHtml;
      body.style.scrollBehavior = previousBody;
    });
  }

  function refreshHighlight() {
    if (!targetElement || card.hidden || !targetElement.isConnected) {
      if (highlight) highlight.hidden = true;
      return;
    }
    const r = targetElement.getBoundingClientRect();
    const pad = 7;
    const left = Math.max(EDGE, r.left - pad);
    const top = Math.max(EDGE, r.top - pad);
    const right = Math.min(window.innerWidth - EDGE, r.right + pad);
    const bottom = Math.min(window.innerHeight - EDGE, r.bottom + pad);
    if (right <= left || bottom <= top) {
      highlight.hidden = true;
      return;
    }
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = `${right - left}px`;
    highlight.style.height = `${bottom - top}px`;
    highlight.hidden = false;
  }

  function viewport() {
    const vv = window.visualViewport;
    return { width:vv ? vv.width : window.innerWidth, height:vv ? vv.height : window.innerHeight, left:vv ? vv.offsetLeft : 0, top:vv ? vv.offsetTop : 0 };
  }

  function cardLimits() {
    const vp = viewport();
    const rect = card.getBoundingClientRect();
    return {
      minX:vp.left + EDGE,
      minY:vp.top + EDGE,
      maxX:Math.max(vp.left + EDGE, vp.left + vp.width - rect.width - EDGE),
      maxY:Math.max(vp.top + EDGE, vp.top + vp.height - rect.height - EDGE)
    };
  }

  function clampCard(left, top, persist) {
    const limits = cardLimits();
    const x = Math.min(limits.maxX, Math.max(limits.minX, Number(left) || limits.minX));
    const y = Math.min(limits.maxY, Math.max(limits.minY, Number(top) || limits.minY));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    if (persist) {
      const xSpan = Math.max(1, limits.maxX - limits.minX);
      const ySpan = Math.max(1, limits.maxY - limits.minY);
      state.cardPosition = { x:(x - limits.minX) / xSpan, y:(y - limits.minY) / ySpan };
      saveState();
    }
    return { x, y, limits };
  }

  function placeFromState() {
    requestAnimationFrame(() => {
      const limits = cardLimits();
      const left = limits.minX + Math.max(0, Math.min(1, Number(state.cardPosition.x))) * (limits.maxX - limits.minX);
      const top = limits.minY + Math.max(0, Math.min(1, Number(state.cardPosition.y))) * (limits.maxY - limits.minY);
      clampCard(left, top, false);
      refreshHighlight();
    });
  }

  function resetPosition() {
    state.cardPosition = { x:.5, y:.12 };
    saveState();
    placeFromState();
    document.getElementById('dproTutorialResetPosition').focus({ preventScroll:true });
  }

  function pointerDown(event) {
    if (event.target.closest('button') && event.target.id !== 'dproTutorialHandle') return;
    const rect = card.getBoundingClientRect();
    dragging = { pointerId:event.pointerId, dx:event.clientX - rect.left, dy:event.clientY - rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    log('drag-start', { pointerType:event.pointerType || 'unknown' });
  }

  function pointerMove(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    clampCard(event.clientX - dragging.dx, event.clientY - dragging.dy, false);
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const rect = card.getBoundingClientRect();
    clampCard(rect.left, rect.top, true);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    log('drag-end', { pointerType:event.pointerType || 'unknown', left:Math.round(rect.left), top:Math.round(rect.top) });
    dragging = null;
  }

  function handleKey(event) {
    const arrows = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    if (event.key === 'Home') {
      event.preventDefault();
      resetPosition();
      document.getElementById('dproTutorialHandle').focus({ preventScroll:true });
      return;
    }
    if (!arrows[event.key]) return;
    event.preventDefault();
    const amount = event.shiftKey ? 1 : 10;
    const rect = card.getBoundingClientRect();
    const [dx,dy] = arrows[event.key];
    clampCard(rect.left + dx * amount, rect.top + dy * amount, true);
  }

  function refreshGeometry() {
    if (!card || card.hidden) return;
    const rect = card.getBoundingClientRect();
    clampCard(rect.left, rect.top, true);
    refreshHighlight();
  }

  function reducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  function expose() {
    window.__DPRO_TUTORIAL_DIAGNOSTICS__ = diagnostics;
    window.DPRO_ESTATE_TUTORIAL = Object.freeze({
      tutorialId:TUTORIAL_ID,
      version:SCHEMA_VERSION,
      stepCount:TOTAL,
      steps:STEPS,
      getState:() => JSON.parse(JSON.stringify(state)),
      start:launch,
      pause,
      replay,
      resetPosition,
      storageKey:STORAGE_KEY
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}());
