/* magezi annotation layer.
 *
 * Adds the comment button, the selection bubble, the rail and the save path to
 * any view that loads it. The view supplies nothing but `data-id` attributes.
 *
 * Annotations are anchored to (block, quote) with `offset` as a hint only, so a
 * comment survives edits elsewhere in the same block. If the quote is gone the
 * entry is left alone and shown as detached rather than silently re-anchored.
 */
(function () {
  'use strict';

  var API = '/__magezi/annotations';
  var doc = document.querySelector('[data-magezi-doc]') || document.body;
  var rows = [];
  var pending = null;
  var focused = null;

  /* ---------- utilities ---------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function nextId() {
    var max = 0;
    rows.forEach(function (r) {
      var m = /^a(\d+)$/.exec(r.id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'a' + (max + 1);
  }

  function blockOf(node) {
    while (node && node !== doc) {
      if (node.nodeType === 1 && node.hasAttribute('data-id')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function textOffset(block, range) {
    var probe = document.createRange();
    probe.selectNodeContents(block);
    try {
      probe.setEnd(range.startContainer, range.startOffset);
    } catch (e) {
      return 0;
    }
    return probe.toString().length;
  }

  /* ---------- persistence -------------------------------------------- */

  var toast = el('div', 'mz-saving');

  function flash(msg, isError) {
    toast.textContent = msg;
    toast.className = 'mz-saving mz-show' + (isError ? ' mz-err' : '');
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { toast.className = 'mz-saving'; }, isError ? 4000 : 1400);
  }

  function load() {
    return fetch(API, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) { rows = Array.isArray(data) ? data : []; })
      .catch(function () { rows = []; });
  }

  function save() {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows)
    }).then(function (r) {
      if (!r.ok) throw new Error('save failed');
      flash('Saved');
    }).catch(function () {
      flash('Could not save — is the magezi server still running?', true);
    });
  }

  /* ---------- highlights ---------------------------------------------- */

  function clearHighlights() {
    doc.querySelectorAll('mark.mz-hl').forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function highlight(row) {
    var block = doc.querySelector('[data-id="' + CSS.escape(row.block) + '"]');
    if (!block || !row.quote) return false;

    var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var nodes = [], full = '', node;
    while ((node = walker.nextNode())) {
      nodes.push({ node: node, start: full.length });
      full += node.nodeValue;
    }

    // Prefer the occurrence nearest the recorded offset; the offset is a hint,
    // not a guarantee, so a shifted-but-present quote still lands correctly.
    var at = -1, from = 0, best = Infinity, hint = row.offset || 0, i;
    while ((i = full.indexOf(row.quote, from)) !== -1) {
      if (Math.abs(i - hint) < best) { best = Math.abs(i - hint); at = i; }
      from = i + 1;
    }
    if (at === -1) return false;

    var end = at + row.quote.length;
    var startNode = null, startOff = 0, endNode = null, endOff = 0;
    nodes.forEach(function (entry) {
      var s = entry.start, e = s + entry.node.nodeValue.length;
      if (startNode === null && at >= s && at < e) { startNode = entry.node; startOff = at - s; }
      if (endNode === null && end > s && end <= e) { endNode = entry.node; endOff = end - s; }
    });
    if (!startNode || !endNode) return false;

    var range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);

    var mark = el('mark', 'mz-hl mz-' + (row.status || 'open'));
    mark.setAttribute('data-mz-for', row.id);
    try {
      range.surroundContents(mark);
    } catch (e) {
      // The quote straddles element boundaries; leave it unhighlighted rather
      // than restructuring the view's markup underneath it.
      return false;
    }
    mark.addEventListener('click', function (ev) { ev.stopPropagation(); focus(row.id); });
    return true;
  }

  function paint() {
    clearHighlights();
    rows.forEach(function (row) {
      if (row.status === 'orphaned') return;
      row.detached = !highlight(row);
    });
    renderRail();
  }

  /* ---------- selection bubble + composer ------------------------------ */

  var bubble = el('button', 'mz-bubble');
  bubble.innerHTML = '<span>&#128172;</span> Comment';
  bubble.style.display = 'none';

  var composer = el('div', 'mz-composer');
  composer.style.display = 'none';
  var cite = el('div', 'mz-quote');
  var input = el('textarea');
  input.placeholder = 'What should change here?';
  var actions = el('div', 'mz-row');
  var cancel = el('button', 'mz-btn', 'Cancel');
  var confirm = el('button', 'mz-btn mz-primary', 'Comment');
  actions.appendChild(cancel);
  actions.appendChild(confirm);
  composer.appendChild(cite);
  composer.appendChild(input);
  composer.appendChild(actions);

  function hideBubble() { bubble.style.display = 'none'; }

  function closeComposer() {
    composer.style.display = 'none';
    input.value = '';
    pending = null;
  }

  document.addEventListener('mouseup', function (ev) {
    if (composer.contains(ev.target) || ev.target === bubble) return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hideBubble();
      var range = sel.getRangeAt(0);
      if (!doc.contains(range.commonAncestorContainer)) return hideBubble();
      var block = blockOf(range.commonAncestorContainer);
      if (!block) return hideBubble();
      var quote = sel.toString().trim();
      if (!quote) return hideBubble();

      pending = { block: block.getAttribute('data-id'), quote: quote, offset: textOffset(block, range) };
      var box = range.getBoundingClientRect();
      bubble.style.display = 'flex';
      bubble.style.left = (box.left + box.width / 2 + window.scrollX) + 'px';
      bubble.style.top = (box.top + window.scrollY - 8) + 'px';
    }, 0);
  });

  bubble.addEventListener('click', function () {
    if (!pending) return;
    hideBubble();
    var box = bubble.getBoundingClientRect();
    composer.style.display = 'block';
    composer.style.left = Math.min(box.left + window.scrollX, window.innerWidth - 320) + 'px';
    composer.style.top = (box.top + window.scrollY + 6) + 'px';
    cite.textContent = pending.quote;
    input.focus();
  });

  cancel.addEventListener('click', closeComposer);

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeComposer();
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) confirm.click();
  });

  confirm.addEventListener('click', function () {
    var body = input.value.trim();
    if (!body || !pending) return;
    rows.push({
      id: nextId(),
      block: pending.block,
      offset: pending.offset,
      quote: pending.quote,
      body: body,
      author: 'human',
      status: 'open',
      ts: new Date().toISOString(),
      replies: []
    });
    closeComposer();
    window.getSelection().removeAllRanges();
    save().then(paint);
  });

  /* ---------- rail ------------------------------------------------------ */

  var toggle = el('button', 'mz-toggle');
  var count = el('span', 'mz-count', '0');
  toggle.appendChild(document.createTextNode('Comments'));
  toggle.appendChild(count);

  var rail = el('aside', 'mz-rail');
  var head = el('div', 'mz-rail-head');
  var title = el('h2', null, 'Comments');
  var close = el('button', 'mz-close', '×');
  head.appendChild(title);
  head.appendChild(close);
  var body = el('div', 'mz-rail-body');
  rail.appendChild(head);
  rail.appendChild(body);

  function openRail(open) {
    rail.classList.toggle('mz-open', open);
    document.body.classList.toggle('mz-rail-open', open);
  }
  toggle.addEventListener('click', function () { openRail(!rail.classList.contains('mz-open')); });
  close.addEventListener('click', function () { openRail(false); });

  function focus(id) {
    focused = id;
    openRail(true);
    doc.querySelectorAll('mark.mz-hl').forEach(function (m) {
      m.classList.toggle('mz-focus', m.getAttribute('data-mz-for') === id);
    });
    var card = body.querySelector('[data-mz-card="' + id + '"]');
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var mark = doc.querySelector('mark.mz-hl[data-mz-for="' + id + '"]');
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function renderRail() {
    body.textContent = '';
    var open = rows.filter(function (r) { return r.status === 'open'; }).length;
    count.textContent = String(open);

    if (!rows.length) {
      body.appendChild(el('div', 'mz-empty', 'Select any text in the view to leave a comment.'));
      return;
    }

    rows.forEach(function (row) {
      var card = el('div', 'mz-card mz-' + (row.status || 'open'));
      card.setAttribute('data-mz-card', row.id);

      var meta = el('div', 'mz-meta');
      meta.appendChild(el('span', 'mz-block', row.block));
      if (row.detached && row.status !== 'orphaned') meta.appendChild(el('span', null, 'detached'));
      meta.appendChild(el('span', 'mz-status', row.status || 'open'));
      card.appendChild(meta);

      if (row.quote) card.appendChild(el('div', 'mz-cite', row.quote));
      card.appendChild(el('div', 'mz-body', row.body));

      (row.replies || []).forEach(function (reply) {
        var box = el('div', 'mz-reply');
        box.appendChild(el('b', null, reply.author || 'agent'));
        box.appendChild(document.createTextNode(reply.body || ''));
        card.appendChild(box);
      });

      var del = el('button', 'mz-del', 'Delete');
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        rows = rows.filter(function (r) { return r.id !== row.id; });
        save().then(paint);
      });
      card.appendChild(del);

      card.addEventListener('click', function () { focus(row.id); });
      body.appendChild(card);
    });
  }

  /* ---------- boot ------------------------------------------------------ */

  document.addEventListener('click', function (ev) {
    if (!composer.contains(ev.target) && ev.target !== bubble) hideBubble();
  });

  var host = el('div', 'mz-root');
  [bubble, composer, toggle, rail, toast].forEach(function (n) { host.appendChild(n); });
  document.body.appendChild(host);

  load().then(paint);
})();
