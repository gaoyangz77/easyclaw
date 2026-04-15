# DlxAI 部署指南

将官网（静态站）和后端（cloud-api）部署到 Linux 服务器。

## 服务器要求

两种部署方式，脚本自动检测：

| 方式 | 要求 | 推荐场景 |
|------|------|----------|
| **Docker**（推荐） | Docker + Docker Compose | 干净服务器，一键搞定 |
| **裸机** | Node 20+ / PostgreSQL / PM2 | 已有环境，不想装 Docker |

两种方式都需要 **Nginx**（可选，但推荐用来反代 + HTTPS）。

---

## 一、服务器环境准备

### Docker 方式（推荐）

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录 SSH 使 docker 组生效

# Nginx（可选但推荐）
sudo apt install -y nginx
```

### 裸机方式

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createuser --superuser $USER 2>/dev/null || true
createdb dlxai_credits

# Nginx
sudo apt install -y nginx

# PM2
sudo npm i -g pm2
pm2 startup  # 开机自启，按提示执行输出的命令
```

---

## 二、本地打包

在你的开发机上执行：

```bash
cd /d/work/dlxiaclaw
bash deploy/pack.sh
```

打包完成后 `deploy/` 目录结构：

```
deploy/
├── cloud-api/          # 后端 API
│   ├── dist/           # 编译后的 JS
│   ├── package.json
│   └── schema.sql      # 数据库建表语句
├── website/            # 官网静态文件
│   ├── index.html
│   ├── en/
│   ├── docs/
│   └── _astro/
├── deploy.sh           # 服务器部署脚本
└── README.md           # 本文档
```

---

## 三、上传到服务器

```bash
scp -r deploy/ root@你的服务器IP:/tmp/dlxai-deploy/
```

---

## 四、在服务器上部署

### 4.1 编辑配置

```bash
ssh root@你的服务器IP
cd /tmp/dlxai-deploy
cp .env.example .env
vim .env
```

填写配置：

```bash
DB_PASSWORD=dlxai2026                # 数据库密码
OPENROUTER_KEY=sk-or-v1-xxx         # 你的 OpenRouter API Key
ADMIN_KEY=你的管理密钥               # 发版用的密钥，随便设一个长字符串
DOMAIN=dlxai.app                     # 你的域名
```

### 4.2 执行部署

```bash
bash deploy.sh
```

脚本会自动检测环境并执行：

**Docker 模式：**
1. 启动 PostgreSQL 容器（自动建表）
2. 启动 cloud-api 容器
3. 配置 Nginx 反代

**裸机模式：**
1. 复制文件到 `/opt/dlxai/`
2. 安装 npm 依赖
3. 初始化数据库
4. PM2 启动 cloud-api
5. 配置 Nginx 反代

### 4.3 验证

```bash
# 健康检查
curl http://localhost:3100/health
# 返回 {"ok":true} 表示后端正常

# 通过 Nginx 访问
curl http://你的域名/health
curl http://你的域名/api/credits/balance  # 应返回 401（未认证，正常）

# 官网
curl -s http://你的域名/ | head -5  # 应返回 HTML
```

---

## 五、启用 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名 -d www.你的域名
```

Certbot 会自动修改 Nginx 配置并设置自动续期。

---

## 六、日常运维

### 查看 API 日志

```bash
pm2 logs dlxai-api
pm2 logs dlxai-api --lines 100  # 最近 100 行
```

### 重启 API

```bash
pm2 restart dlxai-api
```

### 更新代码

在开发机上：
```bash
bash deploy/pack.sh
scp -r deploy/cloud-api/ deploy/website/ root@服务器:/tmp/dlxai-update/
```

在服务器上（Docker）：
```bash
cp -r /tmp/dlxai-update/cloud-api/* /opt/dlxai/cloud-api/
cp -r /tmp/dlxai-update/website/* /opt/dlxai/website/
cd /opt/dlxai && docker compose restart cloud-api
```

在服务器上（裸机）：
```bash
cp -r /tmp/dlxai-update/cloud-api/* /opt/dlxai/cloud-api/
cp -r /tmp/dlxai-update/website/* /opt/dlxai/website/
cd /opt/dlxai/cloud-api && npm install --omit=dev
pm2 restart dlxai-api
```

### 发布新版本（推送更新给客户端）

```bash
curl -X POST https://你的域名/api/releases \
  -H "X-Admin-Key: 你的管理密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.1",
    "downloadUrl": "https://你的域名/releases/DlxAI-1.0.1-win.exe",
    "notes": "修复了一些问题"
  }'
```

所有在线的桌面客户端会通过 SSE 实时收到更新通知。

### 查看数据库

```bash
psql dlxai_credits

-- 用户数
SELECT COUNT(*) FROM users;

-- 最近注册
SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10;

-- 积分消耗排行
SELECT user_id, SUM(ABS(delta)) as total FROM credit_ledger WHERE reason='consumption' GROUP BY user_id ORDER BY total DESC LIMIT 10;

-- 已发布版本
SELECT * FROM app_releases ORDER BY published_at DESC;
```

---

## 目录结构（部署后）

```
/opt/dlxai/
├── cloud-api/
│   ├── dist/           # Node.js API
│   ├── node_modules/
│   ├── package.json
│   ├── schema.sql
│   └── .env            # 环境变量（自动生成）
└── website/            # Nginx 直接托管的静态文件
    ├── index.html
    ├── en/
    ├── docs/
    └── _astro/
```

---

## 常见问题

**Q: deploy.sh 报错 "permission denied"**
```bash
chmod +x deploy.sh
```

**Q: Nginx 报错 "sites-available not found"**
CentOS/RHEL 没有 sites-available 目录，改为：
```bash
sudo vim /etc/nginx/conf.d/dlxai.conf  # 把 Nginx 配置写到这里
sudo nginx -t && sudo systemctl reload nginx
```

**Q: PM2 重启后 .env 没加载**
PM2 用 `--env-path` 可能不支持旧版本，改用 ecosystem 文件：
```bash
cat > /opt/dlxai/cloud-api/ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [{
    name: "dlxai-api",
    script: "dist/index.js",
    env_file: ".env",
    max_memory_restart: "300M",
  }]
};
EOF
cd /opt/dlxai/cloud-api
pm2 start ecosystem.config.cjs
pm2 save
```

**Q: 数据库连接失败**
检查 PostgreSQL 是否允许本地连接：
```bash
sudo vim /etc/postgresql/*/main/pg_hba.conf
# 确保有这行: local all all trust (或 md5)
sudo systemctl restart postgresql
```
