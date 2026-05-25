const state = {
  session: localStorage.getItem("session") || "",
  data: null,
  admin: null,
  view: "overview",
  error: "",
  secret: ""
};

const app = document.querySelector("#app");
const publicSiteOnly = Boolean(window.PUBLIC_SITE_ONLY);

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.session) headers.Authorization = `Bearer ${state.session}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data;
}

function money(value) {
  return Number(value || 0).toFixed(6);
}

function date(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function load() {
  if (!state.session) {
    if (!publicSiteOnly && (location.pathname === "/admin" || location.pathname === "/login" || location.hash === "#login")) {
      renderAuth("login");
      return;
    }
    renderLanding();
    return;
  }
  try {
    state.data = await api("/api/me");
    if (state.data.user.role === "admin") {
      state.admin = await api("/api/admin");
    }
    renderApp();
  } catch {
    localStorage.removeItem("session");
    state.session = "";
    renderLanding();
  }
}

function renderLanding() {
  const primaryCta = publicSiteOnly
    ? `<a class="button primary" href="#docs">获取接入方案</a>`
    : `<button id="hero-login">进入控制台</button>`;
  const navCta = publicSiteOnly
    ? `<a class="button nav-cta" href="#docs">查看方案</a>`
    : `<button id="open-login">登录控制台</button>`;
  app.innerHTML = `
    <main class="landing">
      <nav class="site-nav">
        <a class="site-logo" href="/">API Relay<span>Pro</span></a>
        <div class="site-links">
          <a href="#models">模型</a>
          <a href="#gateway">网关</a>
          <a href="#pricing">计费</a>
          <a href="#docs">接入</a>
        </div>
        ${navCta}
      </nav>

      <section class="hero">
        <canvas id="hero-canvas" aria-hidden="true"></canvas>
        <div class="hero-copy">
          <div class="announcement">企业级 LLM API Gateway · 国内团队可快速交付演示</div>
          <h1>一个 API Key，连接全球主流大模型</h1>
          <p>为 AI 产品、BD 演示和企业客户提供统一中转、模型路由、余额计费、限流风控和请求审计。客户不用理解复杂供应商，你只交付一个稳定入口。</p>
          <div class="hero-actions">
            ${primaryCta}
            <a class="button ghost" href="#docs">查看接入方式</a>
          </div>
          <div class="hero-stats">
            <span><strong>500+</strong> Models</span>
            <span><strong>99.9%</strong> Gateway SLA</span>
            <span><strong>1 Key</strong> Unified Access</span>
          </div>
        </div>
        <div class="hero-terminal">
          <div class="terminal-bar"><span></span><span></span><span></span></div>
          <pre><code>curl /v1/chat/completions
  -H "Authorization: Bearer atr_..."
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [...]
  }'</code></pre>
          <div class="terminal-metrics">
            <div><b>28ms</b><small>网关鉴权</small></div>
            <div><b>¥0.004</b><small>请求成本</small></div>
            <div><b>200</b><small>上游状态</small></div>
          </div>
        </div>
      </section>

      <section class="logo-strip">
        <span>OpenAI-compatible</span>
        <span>Claude</span>
        <span>Gemini</span>
        <span>DeepSeek</span>
        <span>Qwen</span>
        <span>OpenRouter</span>
      </section>

      <section class="section" id="models">
        <div class="section-head">
          <p>Unified Model Access</p>
          <h2>销售给客户的是稳定入口，不是复杂供应商列表</h2>
        </div>
        <div class="feature-grid">
          ${feature("统一 Key", "客户只需要保存一个 API Token，后台可按模型、成本和健康度自动切换供应商。")}
          ${feature("模型白名单", "按客户、套餐或项目开放模型权限，避免高成本模型被误用。")}
          ${feature("OpenAI 兼容", "保留主流 SDK 调用习惯，降低客户迁移和技术沟通成本。")}
        </div>
      </section>

      <section class="band" id="gateway">
        <div>
          <p class="eyebrow">Gateway Control Plane</p>
          <h2>把鉴权、限流、余额、日志和风控放在同一个入口</h2>
          <p>适合对外销售 API 能力、给企业做私有中转、给渠道客户开额度，也适合 BD 现场演示“开账号、发 Token、调用成功、看到用量”的完整闭环。</p>
        </div>
        <div class="ops-grid">
          <div>API Token 管理</div>
          <div>余额预扣与结算</div>
          <div>请求日志审计</div>
          <div>RPM/IP 限流</div>
          <div>上游健康检查</div>
          <div>管理员充值</div>
        </div>
      </section>

      <section class="section" id="pricing">
        <div class="section-head">
          <p>Commercial Ready MVP</p>
          <h2>先跑通销售闭环，再升级生产组件</h2>
        </div>
        <div class="pricing-layout">
          <div class="price-card">
            <h3>团队试用</h3>
            <strong>¥0</strong>
            <p>用于内部演示、客户 PoC 和小范围试点。</p>
            <ul>
              <li>本地账本和用量日志</li>
              <li>API Token 创建/禁用</li>
              <li>OpenAI-compatible 代理</li>
            </ul>
          </div>
          <div class="price-card featured">
            <h3>商业上线</h3>
            <strong>定制</strong>
            <p>适合公开销售、渠道分发和企业客户接入。</p>
            <ul>
              <li>PostgreSQL + Redis</li>
              <li>支付与发票</li>
              <li>KMS 密钥管理和 WAF</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="docs-section" id="docs">
        <div>
          <p class="eyebrow">Developer Experience</p>
          <h2>客户接入只需要替换 Base URL 和 Token</h2>
        </div>
        <pre><code>POST http://localhost:8000/v1/chat/completions
Authorization: Bearer atr_your_customer_token
Content-Type: application/json</code></pre>
      </section>

      <footer class="site-footer">
        <span>API Relay Pro</span>
        <span>LLM Gateway for sales, PoC and enterprise API delivery.</span>
      </footer>
    </main>
  `;
  if (!publicSiteOnly) {
    document.querySelector("#open-login").onclick = () => renderAuth("login");
    document.querySelector("#hero-login").onclick = () => renderAuth("login");
  }
  initHeroCanvas();
}

function feature(title, body) {
  return `<article class="feature"><h3>${title}</h3><p>${body}</p></article>`;
}

function initHeroCanvas() {
  const canvas = document.querySelector("#hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const nodes = Array.from({ length: 56 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.0012, vy: (Math.random() - 0.5) * 0.0012 }));
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  };
  resize();
  addEventListener("resize", resize);
  const draw = () => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, w, h);
    for (const node of nodes) {
      node.x += node.vx;
      node.y += node.vy;
      if (node.x < 0 || node.x > 1) node.vx *= -1;
      if (node.y < 0 || node.y > 1) node.vy *= -1;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = (a.x - b.x) * w;
        const dy = (a.y - b.y) * h;
        const dist = Math.hypot(dx, dy);
        if (dist < 150 * devicePixelRatio) {
          ctx.strokeStyle = `rgba(72, 198, 168, ${1 - dist / (150 * devicePixelRatio)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }
    }
    for (const node of nodes) {
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(node.x * w, node.y * h, 2.2 * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  };
  draw();
}

function renderAuth(mode = "login") {
  app.innerHTML = `
    <main class="auth">
      <section class="auth-card">
        <h1>API Token Relay</h1>
        <p class="subtle">登录控制台，管理中转 Token、余额和请求日志。</p>
        <form class="form" id="auth-form">
          <label>邮箱 <input name="email" type="email" autocomplete="email" required /></label>
          <label>密码 <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
          <button>${mode === "login" ? "登录" : "注册"}</button>
          <button class="secondary" type="button" id="switch-mode">${mode === "login" ? "创建新账号" : "已有账号，去登录"}</button>
          <button class="secondary" type="button" id="back-home">返回官网</button>
          <div class="error">${escapeHtml(state.error)}</div>
        </form>
      </section>
    </main>
  `;
  document.querySelector("#switch-mode").onclick = () => {
    state.error = "";
    renderAuth(mode === "login" ? "register" : "login");
  };
  document.querySelector("#back-home").onclick = () => {
    state.error = "";
    history.pushState(null, "", "/");
    renderLanding();
  };
  document.querySelector("#auth-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const data = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form))
      });
      state.session = data.session;
      localStorage.setItem("session", state.session);
      state.error = "";
      history.pushState(null, "", "/admin");
      await load();
    } catch (error) {
      state.error = error.message;
      renderAuth(mode);
    }
  };
}

function renderApp() {
  const user = state.data.user;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">API Token<br />Relay</div>
        <nav class="nav">
          ${navButton("overview", "总览")}
          ${navButton("tokens", "Token")}
          ${navButton("logs", "日志")}
          ${user.role === "admin" ? navButton("admin", "管理") : ""}
        </nav>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1>${title()}</h1>
            <div class="subtle">${escapeHtml(user.email)} · ${user.role === "admin" ? "管理员" : "用户"}</div>
          </div>
          <button class="secondary" id="logout">退出</button>
        </div>
        ${view()}
      </main>
    </div>
  `;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      state.view = button.dataset.view;
      renderApp();
    };
  });
  document.querySelector("#logout").onclick = () => {
      localStorage.removeItem("session");
      state.session = "";
      state.data = null;
    renderLanding();
  };
  bindView();
}

function navButton(id, label) {
  return `<button class="${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`;
}

function title() {
  return ({ overview: "运营总览", tokens: "API Token", logs: "请求日志", admin: "管理后台" })[state.view] || "控制台";
}

function view() {
  if (state.view === "tokens") return tokensView();
  if (state.view === "logs") return logsView();
  if (state.view === "admin") return adminView();
  return overviewView();
}

function overviewView() {
  const { user, tokens, logs, upstreamConfigured, pricing } = state.data;
  const totalCost = logs.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const okCount = logs.filter((item) => item.statusCode < 400).length;
  return `
    <section class="grid metrics">
      ${metric("余额", `${money(user.balance)} credits`)}
      ${metric("Token 数", tokens.length)}
      ${metric("最近成功率", logs.length ? `${Math.round(okCount / logs.length * 100)}%` : "100%")}
      ${metric("累计消耗", `${money(totalCost)} credits`)}
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>中转接口</h2>
      <p class="subtle">上游状态：<span class="badge ${upstreamConfigured ? "" : "warn"}">${upstreamConfigured ? "已配置" : "未配置 OPENAI_API_KEY"}</span></p>
      <p><code>POST http://localhost:8000/v1/chat/completions</code></p>
      <p><code>POST http://localhost:8000/v1/responses</code></p>
      <p class="subtle">当前价格：输入 ${pricing.prompt} / token，输出 ${pricing.completion} / token。</p>
    </section>
  `;
}

function metric(titleText, value) {
  return `<div class="panel"><div class="metric-title">${titleText}</div><div class="metric-value">${value}</div></div>`;
}

function tokensView() {
  const rows = state.data.tokens.map((token) => `
    <tr>
      <td>${escapeHtml(token.name)}</td>
      <td><code>${escapeHtml(token.prefix)}...</code></td>
      <td><span class="badge ${token.status === "active" ? "" : "warn"}">${token.status}</span></td>
      <td>${token.rpm}</td>
      <td>${money(token.dailyCredits)}</td>
      <td>${date(token.lastUsedAt)}</td>
      <td><button class="danger" data-revoke="${token.id}" ${token.status !== "active" ? "disabled" : ""}>禁用</button></td>
    </tr>
  `).join("");
  return `
    <section class="panel">
      <form class="toolbar" id="token-form">
        <label>名称 <input name="name" value="Production key" /></label>
        <label>每分钟请求 <input name="rpm" type="number" min="1" max="3000" value="60" /></label>
        <label>每日额度 <input name="dailyCredits" type="number" min="1" value="20" /></label>
        <button>创建 Token</button>
      </form>
      ${state.secret ? `<div class="secret"><strong>请立即复制，之后不会再次显示</strong><code>${escapeHtml(state.secret)}</code></div>` : ""}
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>名称</th><th>前缀</th><th>状态</th><th>RPM</th><th>每日额度</th><th>最后使用</th><th>操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">还没有 Token</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function logsView() {
  const rows = state.data.logs.map((item) => `
    <tr>
      <td>${date(item.createdAt)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${item.statusCode}</td>
      <td>${item.promptTokens}/${item.completionTokens}</td>
      <td>${money(item.cost)}</td>
      <td>${item.latencyMs}ms</td>
      <td><code>${escapeHtml(item.id)}</code></td>
    </tr>
  `).join("");
  return `
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>模型</th><th>状态</th><th>Tokens</th><th>费用</th><th>延迟</th><th>请求 ID</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">还没有请求日志</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function adminView() {
  if (!state.admin) return `<section class="panel">无权限</section>`;
  const rows = state.admin.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.role}</td>
      <td>${money(user.balance)}</td>
      <td>${date(user.createdAt)}</td>
      <td>
        <form class="row topup-form" data-user="${user.id}">
          <input name="amount" type="number" min="0.01" step="0.01" value="10" style="width:110px" />
          <button>充值</button>
        </form>
      </td>
    </tr>
  `).join("");
  return `
    <section class="panel">
      <div class="grid metrics" style="margin-bottom:16px">
        ${metric("用户", state.admin.users.length)}
        ${metric("Token", state.admin.tokens.length)}
        ${metric("请求", state.admin.requests.length)}
        ${metric("流水", state.admin.ledger.length)}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>邮箱</th><th>角色</th><th>余额</th><th>创建时间</th><th>充值</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function bindView() {
  const tokenForm = document.querySelector("#token-form");
  if (tokenForm) {
    tokenForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const data = await api("/api/tokens", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      state.secret = data.secret;
      await load();
    };
  }

  document.querySelectorAll("[data-revoke]").forEach((button) => {
    button.onclick = async () => {
      await api(`/api/tokens/${button.dataset.revoke}`, { method: "DELETE" });
      state.secret = "";
      await load();
    };
  });

  document.querySelectorAll(".topup-form").forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const amount = new FormData(form).get("amount");
      await api("/api/admin/topup", { method: "POST", body: JSON.stringify({ userId: form.dataset.user, amount }) });
      await load();
    };
  });
}

load();
