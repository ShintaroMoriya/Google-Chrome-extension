const MAX_INPUT_LENGTH = 12000;

const sourceText = document.querySelector('#sourceText');
const characterCount = document.querySelector('#characterCount');
const summarizeButton = document.querySelector('#summarizeButton');
const clearButton = document.querySelector('#clearButton');
const readPageButton = document.querySelector('#readPageButton');
const taskList = document.querySelector('#taskList');
const emptyState = document.querySelector('#emptyState');
const resultMeta = document.querySelector('#resultMeta');
const copyButton = document.querySelector('#copyButton');
const statusMessage = document.querySelector('#statusMessage');

let currentTasks = [];

function setStatus(message = '', isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function updateCharacterCount() {
  characterCount.textContent = `${sourceText.value.length.toLocaleString('ja-JP')} / ${MAX_INPUT_LENGTH.toLocaleString('ja-JP')}文字`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitIntoUnits(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split(/(?:\n+|(?<=[。！？!?])\s*)/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length >= 4);
}

const deadlinePatterns = [
  /(?:\d{1,2}月\d{1,2}日(?:\s*[（(]?[月火水木金土日][）)]?)?)/g,
  /(?:\d{1,2}\s*\/\s*\d{1,2}(?:\s*[（(]?[月火水木金土日][）)]?)?)/g,
  /(?:今週|来週|再来週)(?:の)?[月火水木金土日](?:曜日|曜)?/g,
  /(?:今月末|来月末|月末|今週中|来週中|本日中|今日中|明日中|明日|今日|至急|ASAP)/gi,
  /(?<![一-龠々〆ヵヶ])(?:[月火水木金土日](?:曜日|曜)?)(?:まで|中|午前|午後)?/g,
  /(?:\d{1,2}時(?:\d{1,2}分)?)(?:まで|頃)?/g
];

function deadlineParts(text) {
  let remaining = text;
  const parts = [];
  for (const pattern of deadlinePatterns) {
    const matches = remaining.match(pattern) || [];
    parts.push(...matches);
    remaining = remaining.replace(pattern, ' ');
  }
  return unique(parts.map((value) => value.replace(/\s+/g, '')));
}

function findDeadline(text) {
  return deadlineParts(text).join('・') || '期限未定';
}

function findAssignee(text) {
  const namedPeople = [...text.matchAll(/(?:^|[、,。\s])([一-龠々〆ヵヶ]{1,6}(?:さん|様|氏|部長|課長|主任|係長|リーダー))/g)]
    .map((match) => match[1]);
  const firstPerson = /(?:私|わたし|自分|こちら|当方)/.test(text) ? '自分' : '';
  const collective = /(?:皆さま|みなさま|各自|チーム|全員|関係者)/.test(text) ? '関係者' : '';
  return unique([...namedPeople, firstPerson, collective]).join('・') || '担当未定';
}

function stripContext(text) {
  let result = text
    .replace(/^\s*(?:なお|また|それでは|恐れ入りますが|お手数ですが|お世話になっております)[、,]?\s*/u, '');

  for (const pattern of deadlinePatterns) {
    result = result.replace(pattern, ' ');
  }

  result = result
    .replace(/(?:^|[、,。\s])(?:[一-龠々〆ヵヶ]{1,6}(?:さん|様|氏|部長|課長|主任|係長|リーダー)|私|わたし|自分|こちら|当方|皆さま|みなさま|各自|チーム|全員|関係者)(?:に|は|が|へ|の)?/g, ' ')
    .replace(/(?:までに|まで|中に|頃に|に|を目処に)\s*/g, ' ')
    .replace(/(?:を|は|が)?\s*(?:お願い(?:します|いたします|致します|できますでしょうか)?|ください|下さい|願います|いただけますでしょうか|していただけますか|してもらえますか|可能でしょうか)\s*/g, ' ')
    .replace(/(?:して)?(?:ください|下さい|下さいませ|いただく|頂く)\s*/g, ' ')
    .replace(/(?:して|します|いたします|致します|です|ます|。|！|!)+\s*$/g, '')
    .replace(/[「」『』"'（）()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  result = result
    .replace(/^(?:を|は|が|に|で|の|と)\s*/u, '')
    .replace(/して$/u, '')
    .trim();
  return result;
}

function shortenTask(task) {
  const clean = task.replace(/^[、,：:\-・\s]+|[、,：:\-・\s]+$/g, '').trim();
  if (!clean) return '';
  if (clean.length < 5) return `${clean}を実施`;
  if (clean.length <= 30) return clean;
  return `${clean.slice(0, 29)}…`;
}

function isActionUnit(unit) {
  return /(?:お願い|依頼|ください|下さい|願います|していただ|してもら|対応|確認|作成|提出|共有|連絡|返信|報告|準備|調整|送付|提出|更新|検討|実施|参加|レビュー|チェック|修正|対応済み|担当)/.test(unit);
}

function buildTask(unit) {
  const task = shortenTask(stripContext(unit));
  if (task.length < 5) return null;
  return {
    assignee: findAssignee(unit),
    deadline: findDeadline(unit),
    task,
    original: unit
  };
}

function summarizeLocally(text) {
  const units = splitIntoUnits(text);
  const candidates = units.filter(isActionUnit);
  const sourceUnits = candidates.length ? candidates : units;
  const tasks = sourceUnits.map(buildTask).filter(Boolean);
  const seen = new Set();

  return tasks.filter((task) => {
    const key = `${task.assignee}|${task.deadline}|${task.task}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeApiTasks(payload) {
  const rawTasks = Array.isArray(payload) ? payload : payload?.tasks;
  if (!Array.isArray(rawTasks)) throw new Error('APIの応答形式が正しくありません。');

  return rawTasks.map((item) => {
    const task = shortenTask(String(item?.task || '').trim());
    if (!task) return null;
    return {
      assignee: String(item?.assignee || '担当未定').trim() || '担当未定',
      deadline: String(item?.deadline || '期限未定').trim() || '期限未定',
      task,
      original: ''
    };
  }).filter(Boolean).slice(0, 12);
}

async function summarizeWithConfiguredProvider(text) {
  const { summarizerMode = 'local', apiEndpoint = '' } = await chrome.storage.local.get({
    summarizerMode: 'local',
    apiEndpoint: ''
  });

  if (summarizerMode !== 'api' || !apiEndpoint) return summarizeLocally(text);

  let endpoint;
  try {
    endpoint = new URL(apiEndpoint);
  } catch (_) {
    throw new Error('APIエンドポイントのURLを確認してください。');
  }
  if (endpoint.protocol !== 'https:') {
    throw new Error('APIエンドポイントにはHTTPS URLを指定してください。');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, outputLanguage: 'ja', maxTasks: 12, taskLength: { min: 5, max: 30 } })
  });
  if (!response.ok) throw new Error(`APIの呼び出しに失敗しました（${response.status}）。`);
  return normalizeApiTasks(await response.json());
}

function renderTasks(tasks) {
  currentTasks = tasks;
  taskList.innerHTML = '';
  emptyState.hidden = tasks.length > 0;
  copyButton.disabled = tasks.length === 0;

  if (!tasks.length) {
    resultMeta.textContent = '依頼・作業に当たる文を見つけられませんでした。';
    return;
  }

  resultMeta.textContent = `${tasks.length}件を整理しました。内容を確認してからコピーできます。`;
  taskList.innerHTML = tasks.map((task) => {
    const assigneeClass = task.assignee === '担当未定' ? ' unknown' : '';
    const deadlineClass = task.deadline === '期限未定' ? ' unknown' : ' deadline';
    return `<li class="task-item">
      <span class="task-marker" aria-hidden="true"></span>
      <div class="task-content">
        <p class="task-main">${escapeHtml(task.task)}</p>
        <div class="task-meta">
          <span class="tag${assigneeClass}">${escapeHtml(task.assignee)}</span>
          <span class="tag${deadlineClass}">${escapeHtml(task.deadline)}</span>
        </div>
      </div>
    </li>`;
  }).join('');
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    const temporary = document.createElement('textarea');
    temporary.value = value;
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand('copy');
    temporary.remove();
    return copied;
  }
}

function serializeTasks(tasks) {
  return tasks.map((task) => `・${task.assignee}｜${task.deadline}｜${task.task}`).join('\n');
}

async function persistInput() {
  await chrome.storage.local.set({ latestSourceText: sourceText.value });
}

async function summarize() {
  const text = sourceText.value.trim();
  if (!text) {
    setStatus('まずは依頼文を貼り付けてください。', true);
    sourceText.focus();
    return;
  }

  summarizeButton.disabled = true;
  summarizeButton.querySelector('span').textContent = '整理しています…';
  setStatus('');
  try {
    const tasks = await summarizeWithConfiguredProvider(text);
    renderTasks(tasks);
    await persistInput();
    if (!tasks.length) setStatus('文章の言い回しを少し具体的にして、もう一度お試しください。', true);
  } catch (error) {
    renderTasks([]);
    setStatus(error?.message || '整理中にエラーが発生しました。', true);
  } finally {
    summarizeButton.disabled = false;
    summarizeButton.querySelector('span').textContent = 'タスクを整理する';
  }
}

async function readVisiblePage() {
  setStatus('ページ本文を読み込んでいます…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection()?.toString().trim();
        if (selection) return selection;
        const root = document.querySelector('main, article, [role="main"]') || document.body;
        return root?.innerText?.trim() || '';
      }
    });
    if (!result) throw new Error('本文が見つかりませんでした。');
    sourceText.value = result.slice(0, MAX_INPUT_LENGTH);
    updateCharacterCount();
    await persistInput();
    setStatus('ページ本文を入力欄に取得しました。');
  } catch (_) {
    setStatus('このページからは取得できません。文章を直接貼り付けてください。', true);
  }
}

sourceText.addEventListener('input', () => {
  updateCharacterCount();
  setStatus('');
});

sourceText.addEventListener('paste', () => window.setTimeout(updateCharacterCount, 0));
summarizeButton.addEventListener('click', summarize);
readPageButton.addEventListener('click', readVisiblePage);

clearButton.addEventListener('click', async () => {
  sourceText.value = '';
  renderTasks([]);
  updateCharacterCount();
  await chrome.storage.local.remove('latestSourceText');
  setStatus('入力内容をクリアしました。');
  sourceText.focus();
});

copyButton.addEventListener('click', async () => {
  if (!currentTasks.length) return;
  const didCopy = await copyText(serializeTasks(currentTasks));
  if (didCopy) {
    const original = copyButton.innerHTML;
    copyButton.textContent = 'コピーしました';
    setStatus('箇条書きをコピーしました。メールやチャットに貼り付けられます。');
    window.setTimeout(() => { copyButton.innerHTML = original; }, 1600);
  } else {
    setStatus('コピーに失敗しました。ブラウザの権限を確認してください。', true);
  }
});

(async function initialize() {
  const { latestSourceText = '' } = await chrome.storage.local.get('latestSourceText');
  sourceText.value = latestSourceText.slice(0, MAX_INPUT_LENGTH);
  updateCharacterCount();
})();
