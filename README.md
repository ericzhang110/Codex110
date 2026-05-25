# API Token Relay

一个可运行的 API Token 中转站 MVP：控制台、用户登录、API Key 管理、余额、请求日志、限流，以及 OpenAI-compatible 代理接口。

## 启动

```bash
cp .env.example .env
# 编辑 .env，至少设置 APP_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD / OPENAI_API_KEY
npm run dev
```

如果当前环境没有 `npm`，也可以直接运行：

```bash
node server.mjs
```

打开：

```text
http://localhost:8000
```

默认管理员账号来自 `.env`：

```text
ADMIN_EMAIL
ADMIN_PASSWORD
```

## 中转调用

在控制台创建 API Token 后：

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer atr_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

## 生产化前必须补强

- PostgreSQL 替换本地 JSON 存储
- Redis 替换内存限流
- KMS/Vault 管理上游密钥
- 支付接入和账本对账
- 内容安全审核
- 管理员 2FA
- 完整审计日志和告警

## 长期部署

当前推荐用 Render Web Service 部署完整后台版本。项目已包含 `render.yaml`，并支持：

- `/` 客户展示官网
- `/admin` 管理后台入口
- `/healthz` 健康检查
- `DATA_DIR=/var/data` 持久化数据目录

早期试运行可以用 Render 持久化磁盘保存 `db.json`。正式商业化后建议迁移到 PostgreSQL + Redis。
