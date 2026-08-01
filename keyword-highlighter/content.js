/* キーワード・ハイライター - コンテンツスクリプト
   ページ内のテキストから登録キーワードを探して色付けします。
   Gmailのような動的なページにも MutationObserver で追従します。 */

(() => {
  const MARK_CLASS = "kwhl-mark";
  let keywords = []; // [{ word, color }]
  let enabled = true;
  let scanTimer = null;

  // ---------- ハイライト処理 ----------
  function clearHighlights(root = document.body) {
    root.querySelectorAll(`.${MARK_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function shouldSkip(node) {
    const p = node.parentElement;
    if (!p) return true;
    const tag = p.tagName;
    return (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "NOSCRIPT" ||
      tag === "TEXTAREA" ||
      tag === "INPUT" ||
      p.isContentEditable ||
      p.classList.contains(MARK_CLASS)
    );
  }

  function highlight(root = document.body) {
    if (!enabled || keywords.length === 0 || !root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      for (const kw of keywords) {
        if (kw.word && node.nodeValue.includes(kw.word)) {
          targets.push(node);
          break;
        }
      }
    }

    for (const textNode of targets) {
      let text = textNode.nodeValue;
      const frag = document.createDocumentFragment();
      let cursor = 0;

      while (cursor < text.length) {
        // 最も手前で見つかるキーワードを探す
        let best = null;
        for (const kw of keywords) {
          if (!kw.word) continue;
          const idx = text.indexOf(kw.word, cursor);
          if (idx !== -1 && (best === null || idx < best.idx)) {
            best = { idx, kw };
          }
        }
        if (!best) {
          frag.appendChild(document.createTextNode(text.slice(cursor)));
          break;
        }
        if (best.idx > cursor) {
          frag.appendChild(
            document.createTextNode(text.slice(cursor, best.idx))
          );
        }
        const mark = document.createElement("mark");
        mark.className = MARK_CLASS;
        mark.style.backgroundColor = best.kw.color;
        mark.textContent = best.kw.word;
        frag.appendChild(mark);
        cursor = best.idx + best.kw.word.length;
      }

      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // 連続更新をまとめて処理（Gmail対策）
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => highlight(document.body), 600);
  }

  // ---------- 動的ページへの追従 ----------
  const observer = new MutationObserver((mutations) => {
    if (!enabled || keywords.length === 0) return;
    for (const m of mutations) {
      // 自分のハイライト挿入で再発火しないように
      if (
        m.target.classList &&
        m.target.classList.contains(MARK_CLASS)
      ) {
        continue;
      }
      if (m.addedNodes.length > 0) {
        scheduleScan();
        return;
      }
    }
  });

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ---------- 設定の読み込みと反映 ----------
  function loadAndRun() {
    KHStore.load().then(({ state }) => {
      keywords = state.keywords;
      enabled = state.enabled;
      clearHighlights();
      if (enabled) highlight(document.body);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KHStore.STORAGE_KEY]) loadAndRun();
  });

  // ---------- 起動 ----------
  loadAndRun();
  startObserver();
})();
