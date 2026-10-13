/**
 * 菜单管家 (Menu Manager)
 * 接管魔法棒菜单（#options > .options-content）：隐藏任意项 / 上下排序。
 * - 条目以元素 id 识别（重复 id 自动加 #2/#3 后缀，各自独立管理）
 * - 只动内联 style.display，不碰酒馆自己的 displayNone 类（ST 自控项保持原状）
 * - 排序语义：只摆放用户显式排过序的条目；未列出的保持原位，
 *   尊重酒馆按上下文动态调整的位置；一旦手动调序，全表固定
 * - 操作即存；MutationObserver 应对晚到的扩展条目，带收敛保护
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const KEY = 'menu-manager';

function getCfg() {
    extension_settings[KEY] = extension_settings[KEY] || {};
    const c = extension_settings[KEY];
    c.order = Array.isArray(c.order) ? c.order : [];
    c.hidden = Array.isArray(c.hidden) ? c.hidden : [];
    return c;
}

function saveCfg() {
    saveSettingsDebounced();
}

function hostEl() {
    return document.querySelector('#options .options-content');
}

function items() {
    const host = hostEl();
    return host ? [...host.querySelectorAll(':scope > a')] : [];
}

function genId(el) {
    const icon = [...(el.querySelector('i')?.classList || [])]
        .filter(c => c.startsWith('fa-') && !['fa-lg', 'fa-solid', 'fa-regular'].includes(c))
        .join('-') || 'noicon';
    return `mm-${icon}-${(el.textContent || '').trim().slice(0, 12)}`;
}

/** 重复 id 去重：第 2 个及以后分配 #2/#3 后缀（dataset 持久，重载后仍稳定） */
function dedupe(all) {
    const seen = new Map();
    for (const el of all) {
        if (el.dataset.mmUid) continue;
        const base = el.id || (el.dataset.mmId ||= genId(el));
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        if (n > 1) el.dataset.mmUid = `${base}#${n}`;
    }
}

function itemId(el) {
    return el.dataset.mmUid || el.id || (el.dataset.mmId ||= genId(el));
}

function itemLabel(el) {
    return (el.textContent || '').trim() || el.id || itemId(el);
}

/** 酒馆按上下文自行隐藏的条目（class displayNone 或计算样式为 none 且非我们所藏） */
function isContextHidden(el, cfg) {
    if (el.classList.contains('displayNone')) return true;
    return getComputedStyle(el).display === 'none' && !cfg.hidden.includes(itemId(el));
}

// ==================== 应用 ====================

let applying = false;

function apply() {
    const host = hostEl();
    if (!host || applying) return;
    const cfg = getCfg();
    const all = items();
    dedupe(all);

    applying = true;
    try {
        // 部分排序：只把 cfg.order 里列出的条目依次摆好；未列出的不动。
        // 写入前逐位校验，已就位就跳过——零 DOM 变更即零 MutationObserver 回响（防死循环）。
        let anchor = null;
        for (const id of cfg.order) {
            const el = all.find(e => itemId(e) === id);
            if (!el) continue;
            const posOk = anchor
                ? anchor.nextElementSibling === el
                : host.firstElementChild === el;
            if (!posOk) {
                if (anchor) anchor.after(el);
                else host.prepend(el);
            }
            anchor = el;
        }
        for (const el of all) {
            // 用 !important 类隐藏，不用内联 style：
            // 酒馆每次打开菜单会用 jQuery .show()/.hide() 重设内联样式，
            // 内联 display:none 会被冲掉，!important 类则稳赢
            const hide = cfg.hidden.includes(itemId(el));
            if (el.classList.contains('mm-hidden-item') !== hide) {
                el.classList.toggle('mm-hidden-item', hide);
            }
        }
    } finally {
        applying = false;
    }
}

let observer = null;
function ensureObserver() {
    const host = hostEl();
    if (!host || observer) return;
    observer = new MutationObserver(() => apply());
    observer.observe(host, { childList: true });
}

// ==================== 设置面板 ====================

function renderPanel(root) {
    const cfg = getCfg();
    root.innerHTML = `
        <div class="mm-hint">☰ 拖动（或 ↑↓）调整顺序，👁 隐藏/显示，改动即存即生效。触屏直接拖 ☰ 即可。
        标有「上下文隐藏」的项是酒馆按当前情景自行藏起来的（如群聊专属项），没列出位置的新条目自动排在原位。
        注意：一旦手动调序，整张菜单的位置将被固定；点「重置为默认」可还给酒馆自控。</div>
        <div id="mm-list"></div>
        <button class="mm-reset" id="mm-reset">重置为默认</button>`;
    const listEl = root.querySelector('#mm-list');

    function currentOrderIds() {
        const all = items();
        dedupe(all);
        return all.map(itemId);
    }

    function paint() {
        // 重渲染前记录滚动位置，避免跳回面板顶部
        const scroller = (() => {
            let n = listEl.parentElement;
            while (n) {
                if (n.scrollHeight > n.clientHeight + 4
                    && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
                n = n.parentElement;
            }
            return null;
        })();
        const savedTop = scroller ? scroller.scrollTop : 0;

        const ordered = items();
        dedupe(ordered);
        listEl.innerHTML = '';
        ordered.forEach((el) => {
            const id = itemId(el);
            const ctxHidden = isContextHidden(el, cfg);
            const row = document.createElement('div');
            row.className = 'mm-setting-row'
                + (cfg.hidden.includes(id) ? ' hidden-item' : '')
                + (ctxHidden ? ' ctx-hidden' : '');
            row.dataset.mmRowId = id;
            row.innerHTML = `
                <span class="mm-drag fa-solid fa-bars" title="拖动排序"></span>
                <span class="mm-label">${itemLabel(el)}${ctxHidden ? ' <span class="mm-ctx-tag">（上下文隐藏）</span>' : ''}</span>
                <button class="mm-btn" data-act="up" title="上移">↑</button>
                <button class="mm-btn" data-act="down" title="下移">↓</button>
                <button class="mm-btn mm-eye" data-act="toggle" title="隐藏/显示">${cfg.hidden.includes(id) ? '🚫' : '👁'}</button>`;
            row.querySelector('[data-act=up]').onclick = () => move(id, -1);
            row.querySelector('[data-act=down]').onclick = () => move(id, +1);
            row.querySelector('[data-act=toggle]').onclick = () => {
                const i = cfg.hidden.indexOf(id);
                if (i >= 0) cfg.hidden.splice(i, 1); else cfg.hidden.push(id);
                saveCfg(); apply(); paint();
            };
            listEl.appendChild(row);
        });

        if (scroller) requestAnimationFrame(() => { scroller.scrollTop = savedTop; });

        if (window.jQuery && jQuery.fn && jQuery.fn.sortable) {
            // 酒馆自带 jQuery UI + touch-punch：桌面/触屏通吃的拖动排序
            jQuery(listEl).sortable({
                handle: '.mm-drag',
                update: () => {
                    // 拖动结果已在 DOM 里，直接固化全表顺序，不再重渲染（避免跳动）
                    cfg.order = [...listEl.children].map(r => r.dataset.mmRowId);
                    saveCfg();
                    apply();
                },
            });
        } else {
            // 兜底：纯 HTML5 拖拽（仅桌面端可用）
            listEl.querySelectorAll('.mm-setting-row').forEach(row => {
                const id = row.dataset.mmRowId;
                const handle = row.querySelector('.mm-drag');
                handle.draggable = true;
                handle.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/mm-id', id);
                    e.dataTransfer.effectAllowed = 'move';
                    row.classList.add('dragging');
                });
                handle.addEventListener('dragend', () => row.classList.remove('dragging'));
                row.addEventListener('dragover', (e) => {
                    if (![...e.dataTransfer.types].includes('text/mm-id')) return;
                    e.preventDefault();
                    row.classList.add('drag-over');
                });
                row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    row.classList.remove('drag-over');
                    const srcId = e.dataTransfer.getData('text/mm-id');
                    if (!srcId || srcId === id) return;
                    const ids = currentOrderIds();
                    const from = ids.indexOf(srcId);
                    const to = ids.indexOf(id);
                    if (from < 0 || to < 0) return;
                    ids.splice(from, 1);
                    ids.splice(to, 0, srcId);
                    cfg.order = ids;
                    saveCfg(); apply(); paint();
                });
            });
        }
    }

    function move(id, dir) {
        // 手动调序 = 把当前完整顺序固化为用户顺序（全表接管）
        const ids = currentOrderIds();
        const i = ids.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        cfg.order = ids;
        saveCfg(); apply(); paint();
    }

    root.querySelector('#mm-reset').onclick = () => {
        cfg.order = [];
        cfg.hidden = [];
        saveCfg(); apply(); paint();
    };

    paint();
}

function injectSettings() {
    const container = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!container || document.getElementById('mm-drawer')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mm-drawer';
    wrap.className = 'inline-drawer';
    wrap.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>菜单管家 (Menu Manager)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content"><div id="mm-settings-root"></div></div>`;
    container.appendChild(wrap);
    renderPanel(wrap.querySelector('#mm-settings-root'));
    wrap.querySelector('.inline-drawer-toggle').addEventListener('click', () => {
        setTimeout(() => renderPanel(wrap.querySelector('#mm-settings-root')), 50);
    });
}

// ==================== 启动 ====================

export function init() {
    try {
        const boot = () => {
            if (!hostEl()) return setTimeout(boot, 1000);
            apply();
            ensureObserver();
            injectSettings();
        };
        boot();
        eventSource.on(event_types.APP_READY, () => { apply(); ensureObserver(); });
        console.info('[MenuManager] 菜单管家已加载');
    } catch (e) {
        console.error('[MenuManager] 初始化失败:', e);
    }
}
