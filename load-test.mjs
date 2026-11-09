// 生产环境压测脚本：club.whysss.cn
// 用法: node load-test.mjs <scenario> [concurrency]
// scenario: page | lookup | register | smoke
import fs from 'node:fs';
import https from 'node:https';

const BASE = process.env.LOAD_TEST_BASE || 'https://club.whysss.cn';
const SQL_FILE = process.env.LOAD_TEST_STUDENTS || process.cwd() + '/students-1200-test-data.sql';
const CLUB_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

// ---- 解析学生数据 ----
function parseStudents() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const rows = [...sql.matchAll(/^\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)(?:,|;)$/gm)];
  return rows.map((m) => ({ name: m[1], idCard: m[2], className: m[3] }));
}

// ---- 单个请求 ----
const agent = new https.Agent({ keepAlive: process.env.LOAD_TEST_KEEPALIVE === '1', maxSockets: Infinity });

function request(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'club.whysss.cn',
        port: 443,
        path,
        method,
        agent,
        headers: {
          'User-Agent': 'load-test',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: true,
            status: res.statusCode,
            durationMs: 0,
            body: data,
          });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); });
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, durationMs: 0, error: err.code || err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- 并发执行 ----
async function runConcurrent(name, total, buildJob, windowSize = 1200) {
  const started = Date.now();
  const results = [];
  let index = 0;

  async function worker() {
    while (index < total) {
      const i = index++;
      const jobStart = Date.now();
      const res = await buildJob(i);
      res.durationMs = Date.now() - jobStart;
      results.push(res);
    }
  }

  const workers = [];
  const window = Math.min(windowSize, total);
  for (let w = 0; w < window; w++) workers.push(worker());
  await Promise.all(workers);

  const totalMs = Date.now() - started;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p = (q) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))];

  const count = (pred) => results.filter(pred).length;
  const statusCounts = {};
  for (const r of results) {
    const key = r.status ? String(r.status) : (r.error || 'network-error');
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }
  const systemErrors = count((r) => r.status >= 500 || !r.ok);

  console.log(`\n===== 场景: ${name} =====`);
  console.log(`总请求: ${total}  并发窗口: ${window}`);
  console.log(`总耗时: ${totalMs}ms`);
  console.log(`成功(2xx): ${count((r) => r.status >= 200 && r.status < 300)}`);
  console.log(`业务拒绝(4xx): ${count((r) => r.status >= 400 && r.status < 500)}`);
  console.log(`系统错误(5xx/网络): ${systemErrors}`);
  console.log(`状态码分布: ${JSON.stringify(statusCounts)}`);
  console.log(`耗时: P50=${p(0.5)}ms  P95=${p(0.95)}ms  P99=${p(0.99)}ms  Max=${durations[durations.length - 1]}ms`);
  console.log(`QPS: ${Math.round(total / (totalMs / 1000))}`);
  return results;
}

// ---- 场景定义 ----
const students = parseStudents();
const scenario = process.argv[2] || 'smoke';
const concurrency = Number(process.argv[3] || 1200);
const windowSize = Number(process.argv[4] || concurrency);

async function main() {
  if (scenario === 'page' || scenario === 'smoke') {
    await runConcurrent('加载报名页 GET /register', concurrency, () => request('GET', '/register'), windowSize);
  }
  if (scenario === 'lookup' || scenario === 'smoke') {
    await runConcurrent(
      '身份证查询 POST /api/students/lookup',
      concurrency,
      (i) => request('POST', '/api/students/lookup', { idCard: students[i % students.length].idCard }),
      windowSize
    );
  }
  if (scenario === 'register' || scenario === 'smoke') {
    await runConcurrent(
      '报名提交 POST /api/register',
      concurrency,
      (i) => {
        const s = students[i % students.length];
        return request('POST', '/api/register', {
          name: s.name,
          idCard: s.idCard,
          className: s.className,
          clubId: String(CLUB_IDS[i % CLUB_IDS.length]),
        });
      },
      windowSize
    );
  }
  if (scenario === 'smoke' && concurrency === 1200) {
    console.log('\n提示: smoke 场景会同时跑三个场景，如只想跑单一场景用 page|lookup|register');
  }
}

main().catch((err) => {
  console.error('压测失败:', err);
  process.exit(1);
});
