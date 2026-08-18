const fs = require('node:fs');
const vm = require('node:vm');

function elementStub() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    classList: { toggle() {} },
    querySelector() { return elementStub(); },
    addEventListener() {},
    focus() {},
    append() {},
    remove() {},
    select() {}
  };
}

const context = {
  console,
  setTimeout,
  document: {
    querySelector: () => elementStub(),
    createElement: () => elementStub(),
    body: { append() {} },
    execCommand: () => true
  },
  navigator: { clipboard: { writeText: async () => {} } },
  chrome: {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [] },
    scripting: { executeScript: async () => [] }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/popup.js`, 'utf8'), context);

const cases = [
  {
    input: '田中さん、来週火曜までに見積書のたたき台を作成してください。鈴木さんは金曜までに数字を確認願います。私は月曜に顧客へ連絡します。',
    expected: [
      ['田中さん', '来週火曜', '見積書のたたき台を作成'],
      ['鈴木さん', '金曜まで', '数字を確認'],
      ['自分', '月曜', '顧客へ連絡']
    ]
  },
  {
    input: '資料の最終確認をお願いします。今週中に共有してください。',
    expected: [
      ['担当未定', '期限未定', '資料の最終確認'],
      ['担当未定', '今週中', '共有を実施']
    ]
  }
];

for (const testCase of cases) {
  const actual = context.summarizeLocally(testCase.input);
  if (actual.length !== testCase.expected.length) {
    throw new Error(`件数が一致しません。expected=${testCase.expected.length}, actual=${actual.length}`);
  }
  testCase.expected.forEach(([assignee, deadline, task], index) => {
    const item = actual[index];
    if (item.assignee !== assignee || item.deadline !== deadline || item.task !== task) {
      throw new Error(`期待値と一致しません。expected=${JSON.stringify([assignee, deadline, task])}, actual=${JSON.stringify([item.assignee, item.deadline, item.task])}`);
    }
    if (item.task.length < 2 || item.task.length > 30) {
      throw new Error(`タスク文字数が範囲外です: ${item.task}`);
    }
  });
}

const apiTasks = context.normalizeApiTasks({
  tasks: [
    { assignee: '佐藤さん', deadline: '8月20日', task: '契約書確認' },
    { assignee: '', deadline: '', task: '資料を共有' }
  ]
});

if (apiTasks.length !== 2 || apiTasks[0].task !== '契約書確認' || apiTasks[1].assignee !== '担当未定' || apiTasks[1].deadline !== '期限未定') {
  throw new Error(`API応答の変換結果が不正です: ${JSON.stringify(apiTasks)}`);
}

let invalidPayloadRejected = false;
try {
  context.normalizeApiTasks({ result: [] });
} catch (_) {
  invalidPayloadRejected = true;
}
if (!invalidPayloadRejected) throw new Error('不正なAPI応答を拒否できませんでした。');

console.log('parser and API adapter smoke tests: passed');
