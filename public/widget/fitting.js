// fitting.js — iframe 안에서 도는 피팅 화면.
//
// 부모(몰 페이지)와는 postMessage 로만 통신한다. 특히 **구매 이동은 부모가 해야 한다** —
// iframe 안에서 location 을 바꾸면 몰 페이지는 그대로인 채 프레임만 이동해
// 장바구니·결제 흐름이 깨진다.
//
// 상품 이미지는 여기서 내려받지 않고 URL 그대로 서버에 넘긴다.
// 몰 CDN 은 대개 CORS 를 열어두지 않아 브라우저에서는 읽을 수 없기 때문이다.

(function () {
  'use strict';

  var API_ORIGIN = location.origin;
  var TRY_ON_API = API_ORIGIN + '/try-on';
  var EVENTS_API = API_ORIGIN + '/events';

  var params = new URLSearchParams(location.search);
  var CTX = {
    key: params.get('key') || '',
    productId: params.get('product') || '',
    productName: params.get('name') || '',
    productPrice: Number(params.get('price') || 0) || 0,
    productImage: params.get('image') || '',
    buyUrl: params.get('buy') || '',
    category: params.get('category') || '',
    productSize: params.get('sizes') || '',
  };

  // 세션 ID — 방문자 1명을 세는 단위. 리포트의 "1인당 평균 피팅"이 여기서 나온다.
  var SESSION_ID = (function () {
    var KEY = 'codipop_session';
    try {
      var saved = sessionStorage.getItem(KEY);
      if (saved) return saved;
      var fresh = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(KEY, fresh);
      return fresh;
    } catch (e) {
      return 's_' + Date.now().toString(36);
    }
  })();

  var BODY_KEY = 'codipop_body_size';

  var state = {
    personFile: null,
    personPreviewUrl: '',
    resultUrl: '',
    fittingEventId: null,
    showBefore: false,
    timer: null,
  };

  var el = function (id) { return document.getElementById(id); };

  // --- 부모와의 통신 ---
  function post(type, payload) {
    // targetOrigin 을 '*' 로 두는 이유: 부모 origin 은 몰마다 다르고, 여기서 보내는 값은
    // 닫기 신호와 상품 URL 뿐이라 비밀이 아니다. 부모 쪽에서는 우리 origin 을 검사한다.
    parent.postMessage(Object.assign({ source: 'codipop', type: type }, payload || {}), '*');
  }

  function close() { post('close'); }

  // --- 이벤트 수집 ---
  function sendEvent(type, extra) {
    var payload = Object.assign(
      {
        type: type,
        apiKey: CTX.key,
        sessionId: SESSION_ID,
        productId: CTX.productId,
        productName: CTX.productName,
      },
      extra || {},
    );
    var body = JSON.stringify(payload);
    try {
      // 구매 클릭 직후 페이지가 이동하므로 sendBeacon 이 아니면 요청이 취소된다.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(EVENTS_API, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) { /* 아래 fetch 로 폴백 */ }
    fetch(EVENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
    }).catch(function () { /* 수집 실패가 사용자 흐름을 막지 않는다 */ });
  }

  // --- 몸 사이즈 저장/복원 ---
  function loadBodySize() {
    try {
      var raw = localStorage.getItem(BODY_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return window.CodiPopSize.isValidBodySize(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveBodySize(body) {
    try { localStorage.setItem(BODY_KEY, JSON.stringify(body)); } catch (e) { /* 무시 */ }
  }

  function readBodyInput() {
    var body = {
      heightCm: Number(el('input-height').value),
      weightKg: Number(el('input-weight').value),
      usualSize: el('input-usual-size').value,
    };
    return window.CodiPopSize.isValidBodySize(body) ? body : null;
  }

  // --- 화면 전환 ---
  function show(stepId) {
    ['step-input', 'step-loading', 'step-result', 'step-error'].forEach(function (id) {
      el(id).classList.toggle('hidden', id !== stepId);
    });
    document.querySelector('.wrap').scrollTop = 0;
  }

  // --- 초기화 ---
  function boot() {
    if (!CTX.key) {
      showError('API 키가 없습니다. 스크립트 태그의 data-codipop-key 를 확인해 주세요.');
      return;
    }

    el('product-name').textContent = CTX.productName || '선택한 상품';
    el('product-price').textContent = CTX.productPrice
      ? CTX.productPrice.toLocaleString('ko-KR') + '원'
      : '';
    if (CTX.productImage) el('product-image').src = CTX.productImage;

    // 몰 이름은 URL 이 아니라 서버 설정에서 가져온다.
    // (URL 로 받으면 아무나 남의 몰 이름을 띄울 수 있다)
    fetch(API_ORIGIN + '/widget/config?key=' + encodeURIComponent(CTX.key))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.success && data.tenant) {
          el('bar-mall').textContent = data.tenant.mallName + ' × CodiPOP';
        }
      })
      .catch(function () { /* 몰 이름 없이 진행 */ });

    var saved = loadBodySize();
    if (saved) {
      el('input-height').value = saved.heightCm;
      el('input-weight').value = saved.weightKg;
      el('input-usual-size').value = saved.usualSize;
    }

    sendEvent('widget_open');
    bindEvents();
  }

  function bindEvents() {
    el('btn-close').addEventListener('click', close);

    el('person-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) setPerson(file);
    });

    el('btn-sample').addEventListener('click', function () {
      fetch('./assets/sample-person.jpg')
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          setPerson(new File([blob], 'sample-person.jpg', { type: blob.type || 'image/jpeg' }));
        })
        .catch(function () { showError('체험용 사진을 불러오지 못했습니다.'); });
    });

    el('btn-start').addEventListener('click', startFitting);
    el('btn-retry').addEventListener('click', function () {
      sendEvent('retry', { fittingEventId: state.fittingEventId });
      show('step-input');
    });
    el('btn-error-back').addEventListener('click', function () { show('step-input'); });

    el('btn-before').addEventListener('click', function () {
      state.showBefore = !state.showBefore;
      applyBeforeToggle();
    });

    el('btn-buy').addEventListener('click', function () {
      sendEvent('buy_click', {
        fittingEventId: state.fittingEventId,
        productPrice: CTX.productPrice,
      });
      post('buy', { url: CTX.buyUrl });
    });

    el('btn-save').addEventListener('click', saveImage);
    el('btn-share').addEventListener('click', shareResult);
  }

  function setPerson(file) {
    state.personFile = file;
    if (state.personPreviewUrl) URL.revokeObjectURL(state.personPreviewUrl);
    state.personPreviewUrl = URL.createObjectURL(file);

    var preview = el('person-preview');
    preview.style.backgroundImage = 'url("' + state.personPreviewUrl + '")';
    preview.classList.remove('empty');
    el('btn-start').disabled = false;
  }

  // --- 피팅 ---
  async function startFitting() {
    if (!state.personFile) return;

    show('step-loading');
    var startedAt = Date.now();
    el('elapsed').textContent = '0.0초';
    clearInterval(state.timer);
    state.timer = setInterval(function () {
      el('elapsed').textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + '초';
    }, 100);

    try {
      var form = new FormData();
      form.append('person', state.personFile, state.personFile.name || 'person.jpg');
      // 옷은 파일이 아니라 URL 로 넘긴다. 서버가 받아온다.
      form.append('clothingUrl', CTX.productImage);
      form.append('clothing_count', '1');

      form.append('apiKey', CTX.key);
      form.append('productId', CTX.productId);
      form.append('productName', CTX.productName);
      form.append('sessionId', SESSION_ID);

      var body = readBodyInput() || loadBodySize();
      if (body) {
        saveBodySize(body);
        form.append('heightCm', String(body.heightCm));
        form.append('weightKg', String(body.weightKg));
        form.append('usualSize', body.usualSize);
      }

      sendEvent('fitting_start');

      var response = await fetch(TRY_ON_API, { method: 'POST', body: form });
      var data = await response.json().catch(function () { return {}; });
      clearInterval(state.timer);

      if (!response.ok || !data.success || !data.imageUrl) {
        throw new Error(data.message || '피팅 요청 실패 (' + response.status + ')');
      }

      state.resultUrl = data.imageUrl;
      state.fittingEventId = data.fittingEventId || null;
      el('result-before').src = state.personPreviewUrl;
      el('result-after').src = data.imageUrl;
      state.showBefore = false;
      applyBeforeToggle();

      renderSize();
      show('step-result');
      sendEvent('result_view', { fittingEventId: state.fittingEventId });
    } catch (error) {
      clearInterval(state.timer);
      showError((error && error.message) || '네트워크 또는 서버 오류입니다.');
    }
  }

  function applyBeforeToggle() {
    el('result-before').classList.toggle('hidden', !state.showBefore);
    el('result-after').classList.toggle('hidden', state.showBefore);
    el('btn-before').textContent = state.showBefore ? '피팅 결과 보기' : '원본 보기';
  }

  /** 사이즈 추천 — 입력이 없으면 표시하지 않는다 (빈 카드는 화면만 어지럽힌다). */
  function renderSize() {
    var body = readBodyInput() || loadBodySize();
    if (!body || !window.CodiPopSize) {
      el('size-result').classList.add('hidden');
      return;
    }

    var result = window.CodiPopSize.recommendClothingSize({
      heightCm: body.heightCm,
      weightKg: body.weightKg,
      usualSize: body.usualSize,
      category: CTX.category,
      productSize: CTX.productSize,
    });

    // 상품이 실제로 파는 사이즈에 맞춰 번역한다.
    // 국내 몰은 프리 사이즈가 흔해서, 그대로 두면 "L을 추천합니다"처럼
    // 그 상품에 없는 사이즈를 말하게 된다. (product-size.js 참조)
    var offered = window.CodiPopProductSize
      ? window.CodiPopProductSize.describeForProduct(result.recommendedSize, CTX.productSize)
      : null;

    if (offered) {
      el('size-value').textContent = offered.badge;
      el('size-reason').textContent = offered.headline + ' — ' + offered.detail;
    } else {
      el('size-value').textContent = result.recommendedSize;
      el('size-reason').textContent = window.CodiPopSize.formatSizeReason(result);
    }

    el('size-meta').textContent =
      body.heightCm + 'cm · ' + body.weightKg + 'kg · BMI ' + result.bmi +
      (offered
        ? ' · 판매 사이즈 ' + offered.offered
        : CTX.productSize ? ' · 상품 표기 ' + CTX.productSize : '');
    el('size-result').classList.remove('hidden');
  }

  function showError(message) {
    el('error-message').textContent = message;
    show('step-error');
  }

  // --- 저장 / 공유 ---

  /** 손가락으로 쓰는 기기인지. 저장 경로를 고르는 데만 쓴다. */
  function isTouchDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  /**
   * 결과 이미지 저장.
   *
   * 예전에는 a[download] 하나만 썼는데 **모바일에서 아무 일도 일어나지 않았습니다.**
   * 이 화면은 몰 페이지 안의 **교차 출처 iframe** 이고, 안드로이드 크롬은 그 안에서
   * 시작된 a[download] 다운로드를 조용히 무시합니다. 예외를 던지지 않으므로
   * catch 에 넣어 둔 대비책(새 탭 열기)까지 같이 죽어, 버튼이 완전히 먹통이 됐습니다.
   *
   * **a.click() 이 막혔는지는 코드로 알아낼 방법이 없습니다.** 그래서 실패를 감지해
   * 되돌리는 대신, 기기별로 되는 경로를 **처음부터 골라** 부릅니다.
   *
   *   모바일 → 공유 시트 (안드로이드·iOS 모두 시트 안에 '이미지 저장'이 있다)
   *   데스크톱 → a[download]
   *
   * 공유 시트는 iframe 에 allow="web-share" 가 있어야 열립니다 — codipop.js 에서
   * 이미 붙여 두었으니 지우지 마세요.
   */
  async function saveImage() {
    if (!state.resultUrl) return;
    sendEvent('save_image', { fittingEventId: state.fittingEventId });

    var name = 'codipop-' + (CTX.productId || 'fitting') + '.jpg';
    var blob;
    try {
      var res = await fetch(state.resultUrl);
      blob = await res.blob();
    } catch (e) {
      // 이미지를 못 가져오면 저장할 것 자체가 없다. 원본이라도 띄운다.
      window.open(state.resultUrl, '_blank', 'noopener');
      return;
    }

    // 1) 공유 시트에 파일을 실어 보낸다.
    try {
      var file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: CTX.productName || 'CodiPOP 피팅' });
        return;
      }
    } catch (e) {
      // 사용자가 시트를 닫은 것도 여기로 온다. 그때 다른 창을 또 띄우면 성가시다.
      if (e && e.name === 'AbortError') return;
    }

    // 2) 공유 시트를 못 쓰는 모바일 — 새 탭으로 띄우면 길게 눌러 저장할 수 있다.
    //    여기서 a[download] 를 시도하면 아무 일도 없이 끝난다.
    if (isTouchDevice()) {
      window.open(state.resultUrl, '_blank', 'noopener');
      return;
    }

    // 3) 데스크톱 — 정식 다운로드
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function shareResult() {
    if (!state.resultUrl) return;
    sendEvent('share', { fittingEventId: state.fittingEventId });
    var shareData = {
      title: CTX.productName || 'CodiPOP 피팅',
      text: 'CodiPOP 으로 입어봤어요',
      url: CTX.buyUrl || state.resultUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareData.url);
      alert('링크를 복사했어요.');
    } catch (e) {
      /* 사용자가 취소한 경우 포함 — 아무것도 하지 않는다 */
    }
  }

  boot();
})();
