/*!
 * CodiPOP 임베드 위젯 로더
 *
 * 고객사가 상품 상세 템플릿에 붙이는 것은 아래 한 줄이 전부다.
 *
 *   <script src="https://codipop-backend.onrender.com/widget.js"
 *           data-codipop-key="pk_..." defer></script>
 *
 * 이 파일이 하는 일은 세 가지뿐이다.
 *   1) 페이지에서 상품 정보를 찾는다
 *   2) '착용해 보기' 버튼을 넣는다
 *   3) 누르면 iframe 오버레이를 띄운다
 *
 * 피팅 UI 는 전부 iframe(/widget/fitting.html) 안에 있다. 몰 페이지에는 버튼과
 * 오버레이만 들어가므로 **몰 CSS 와 절대 충돌하지 않는다.** 임대몰(카페24·고도몰)의
 * 스킨이 어떤 CSS 를 쓰는지 우리가 알 수 없기 때문에 이 격리가 필수다.
 *
 * 클래스명에 `codipop-` 접두사를 붙이고, 오버레이는 z-index 최상단에 둔다.
 */
(function () {
  'use strict';

  if (window.__codipopWidgetLoaded) return;
  window.__codipopWidgetLoaded = true;

  // --- 스크립트 태그에서 설정 읽기 ---
  var self =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (/widget\.js|codipop\.js/.test(all[i].src || '')) return all[i];
      }
      return null;
    })();

  if (!self) {
    console.error('[CodiPOP] 스크립트 태그를 찾지 못했습니다.');
    return;
  }

  var API_ORIGIN = (function () {
    try {
      return new URL(self.src, location.href).origin;
    } catch (e) {
      return 'https://codipop-backend.onrender.com';
    }
  })();

  var KEY = self.getAttribute('data-codipop-key') || self.getAttribute('data-key') || '';
  var BUTTON_TEXT = self.getAttribute('data-codipop-text') || '착용해 보기';
  // 자동 삽입을 끄고 window.CodiPOP.open() 으로만 열고 싶은 몰을 위한 스위치
  var AUTO = self.getAttribute('data-codipop-auto') !== 'false';

  if (!KEY) {
    console.error('[CodiPOP] data-codipop-key 가 없습니다. 발급받은 공개 키를 넣어 주세요.');
    return;
  }

  // --- 상품 정보 수집 ---
  //
  // 몰마다 마크업이 달라서 "무조건 이 셀렉터" 같은 건 통하지 않는다.
  // data 속성을 1순위로 읽고, 없으면 OG 메타 → 페이지 구조 순으로 추론한다.
  // 추론이 실패해도 피팅 자체는 되어야 하므로 이미지만 필수로 본다.

  function attr(el, name) {
    if (!el) return '';
    var v = el.getAttribute('data-codipop-' + name);
    return v ? v.trim() : '';
  }

  function meta(property) {
    var el =
      document.querySelector('meta[property="' + property + '"]') ||
      document.querySelector('meta[name="' + property + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function absoluteUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return '';
    }
  }

  /** 컨테이너 안에서 가장 큰 이미지를 상품 이미지로 본다 (썸네일·아이콘 회피). */
  function biggestImage(root) {
    var imgs = (root || document).querySelectorAll('img');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.src || /^data:/.test(img.src)) continue;
      var area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
      // 로고·아이콘 제외
      if (area < 10000) continue;
      if (area > bestArea) {
        bestArea = area;
        best = img;
      }
    }
    return best ? best.src : '';
  }

  /** 가격 문자열에서 숫자만 뽑는다. "39,000원" → 39000 */
  function parsePrice(text) {
    if (!text) return 0;
    var digits = String(text).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits.slice(0, 10), 10) : 0;
  }

  function collectProduct(host) {
    var image =
      absoluteUrl(attr(host, 'image')) ||
      absoluteUrl(biggestImage(host && host.parentElement)) ||
      absoluteUrl(meta('og:image')) ||
      absoluteUrl(biggestImage(document));

    return {
      id: attr(host, 'product') || attr(host, 'id') || location.pathname,
      name: attr(host, 'name') || meta('og:title') || document.title || '',
      price: parsePrice(attr(host, 'price')),
      image: image,
      category: attr(host, 'category') || '',
      sizes: attr(host, 'sizes') || '',
      buyUrl: absoluteUrl(attr(host, 'buy')) || location.href,
    };
  }

  // --- 오버레이 ---

  var overlay = null;
  var frame = null;
  var lastBodyOverflow = '';

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'codipop-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'CodiPOP 가상 피팅');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000', // 몰 헤더·플로팅 배너보다 확실히 위
      'background:rgba(15,17,21,0.72)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:0',
      'opacity:0',
      'transition:opacity .18s ease',
    ].join(';');

    frame = document.createElement('iframe');
    frame.title = 'CodiPOP 가상 피팅';
    frame.allow = 'clipboard-write; web-share';
    frame.style.cssText = [
      'width:100%',
      'max-width:480px',
      'height:100%',
      'max-height:100%',
      'border:0',
      'background:#fff',
      'box-shadow:0 24px 60px rgba(0,0,0,.35)',
    ].join(';');

    overlay.appendChild(frame);

    // 바깥 클릭으로 닫기 (iframe 내부 클릭은 여기까지 오지 않는다)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    document.body.appendChild(overlay);
  }

  function open(product) {
    if (!overlay) buildOverlay();

    var params = new URLSearchParams({
      key: KEY,
      product: product.id || '',
      name: product.name || '',
      price: String(product.price || 0),
      image: product.image || '',
      buy: product.buyUrl || '',
      category: product.category || '',
      sizes: product.sizes || '',
      origin: location.origin,
    });

    frame.src = API_ORIGIN + '/widget/fitting.html?' + params.toString();
    overlay.style.display = 'flex';
    // 스크롤 잠금 — 오버레이 뒤에서 몰 페이지가 움직이면 조작이 어긋난다
    lastBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
    });
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    document.removeEventListener('keydown', onKeydown);
    setTimeout(function () {
      overlay.style.display = 'none';
      frame.src = 'about:blank'; // 카메라·메모리 정리
      document.body.style.overflow = lastBodyOverflow;
    }, 180);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  // --- iframe 과의 통신 ---
  //
  // 구매 이동은 반드시 **부모 창**에서 해야 한다. iframe 안에서 이동하면
  // 몰 페이지는 그대로인 채 프레임만 바뀌어 장바구니 흐름이 깨진다.
  window.addEventListener('message', function (event) {
    if (event.origin !== API_ORIGIN) return; // 다른 출처의 메시지는 무시
    var data = event.data;
    if (!data || data.source !== 'codipop') return;

    if (data.type === 'close') {
      close();
    } else if (data.type === 'buy' && data.url) {
      var url = absoluteUrl(data.url);
      if (url) {
        close();
        location.href = url;
      }
    }
  });

  // --- 버튼 삽입 ---

  function makeButton(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'codipop-button';
    btn.textContent = BUTTON_TEXT;
    btn.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'gap:6px',
      'width:100%',
      'padding:14px 18px',
      'margin:8px 0',
      'border:0',
      'border-radius:10px',
      'background:#111318',
      'color:#fff',
      'font:600 15px/1.2 inherit',
      'cursor:pointer',
      '-webkit-appearance:none',
    ].join(';');

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      open(collectProduct(host));
    });
    return btn;
  }

  function mount() {
    if (!AUTO) return;

    // 1순위: 몰이 직접 위치를 지정한 경우
    var slots = document.querySelectorAll('[data-codipop-button]');
    if (slots.length) {
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].__codipopMounted) continue;
        slots[i].__codipopMounted = true;
        slots[i].appendChild(makeButton(slots[i]));
      }
      return;
    }

    // 2순위: 상품 정보만 표시된 경우 그 요소 뒤에 붙인다
    var hosts = document.querySelectorAll('[data-codipop-product]');
    for (var j = 0; j < hosts.length; j++) {
      if (hosts[j].__codipopMounted) continue;
      hosts[j].__codipopMounted = true;
      var btn = makeButton(hosts[j]);
      hosts[j].appendChild(btn);
    }

    if (!slots.length && !hosts.length) {
      console.warn(
        '[CodiPOP] 버튼을 넣을 위치를 찾지 못했습니다. ' +
          '상품 상세의 구매 버튼 근처에 <div data-codipop-button data-codipop-product="상품ID"></div> 를 넣어 주세요.',
      );
    }
  }

  // --- 공개 API ---
  // 몰이 자기 버튼을 쓰고 싶을 때: CodiPOP.open({ id, name, price, image, buyUrl })
  window.CodiPOP = {
    open: function (product) {
      open(
        Object.assign(
          { id: '', name: document.title, price: 0, image: '', buyUrl: location.href },
          product || {},
        ),
      );
    },
    close: close,
    mount: mount,
    key: KEY,
    apiOrigin: API_ORIGIN,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
