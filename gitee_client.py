# -*- coding: utf-8 -*-
"""
Gitee 开放 API 客户端 (Gitee OpenAPI Client)
负责与 Gitee v5 RESTful API 交互：
1. 授权登录与身份验证 (/v5/user)
2. 用户所属企业及成员信息查询 (/v5/user/enterprises, /v5/enterprises/{enterprise}/members/{username})
3. 用户在企业下的代码提交事件拉取与解析 (/v5/users/{username}/events)
4. 严格用户作者过滤 (只提取当前授权用户本人的 Commit 记录)
5. 提交类型识别 (STYLE, FIX, FEAT, REFACTOR 等) 与统计指标计算
"""

import os
import re
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, timezone

GITEE_API_BASE = "https://gitee.com/api/v5"

# 提交类型正则表达式与关键字映射
COMMIT_TYPE_RULES = [
    (r'^(feat|feature)(?:\([^\)]+\))?!?:\s*(.*)', 'FEAT'),
    (r'^(fix|bugfix|hotfix)(?:\([^\)]+\))?!?:\s*(.*)', 'FIX'),
    (r'^(style|ui)(?:\([^\)]+\))?!?:\s*(.*)', 'STYLE'),
    (r'^(refactor|optimize|opt)(?:\([^\)]+\))?!?:\s*(.*)', 'REFACTOR'),
    (r'^(perf|performance)(?:\([^\)]+\))?!?:\s*(.*)', 'PERF'),
    (r'^(docs|doc)(?:\([^\)]+\))?!?:\s*(.*)', 'DOCS'),
    (r'^(test|tests)(?:\([^\)]+\))?!?:\s*(.*)', 'TEST'),
    (r'^(chore|build|ci)(?:\([^\)]+\))?!?:\s*(.*)', 'CHORE'),
    (r'^(merge)(?:\([^\)]+\))?!?:\s*(.*)', 'MERGE'),
    (r'^(revert)(?:\([^\)]+\))?!?:\s*(.*)', 'REVERT'),
]

COMMIT_TYPE_KEYWORDS = [
    (['fix', '修复', '解决', 'bug', '缺陷'], 'FIX'),
    (['style', '样式', '排版', 'ui', '格式', '美化'], 'STYLE'),
    (['feat', '新增', '需求', '特性', '功能', '支持'], 'FEAT'),
    (['refactor', '重构', '优化', '调整', '改进'], 'REFACTOR'),
    (['perf', '性能', '加速', '防卡', '缓存'], 'PERF'),
    (['docs', '文档', '注释', '说明', 'readme'], 'DOCS'),
    (['test', '测试', '用例', '单元测试'], 'TEST'),
    (['merge', '合并分支', 'merge branch'], 'MERGE'),
    (['chore', '构建', '依赖', '配置', '版本', 'bump'], 'CHORE'),
]


def classify_commit_type(message: str) -> str:
    """解析提交信息并识别其提交类型标签 (FEAT/FIX/STYLE/REFACTOR/DOCS/PERF/TEST/CHORE 等)"""
    if not message:
        return 'OTHER'
    first_line = message.strip().split('\n')[0].strip()

    # 1. 优先匹配 Conventional Commits 标准格式: type(scope): subject
    for pattern, commit_type in COMMIT_TYPE_RULES:
        if re.match(pattern, first_line, re.IGNORECASE):
            return commit_type

    # 2. 匹配中文方括号或普通方括号前缀: 【修复】 / [style] / (feat)
    bracket_match = re.match(r'^[\[【(（]([^\]】)）]+)[\]】)）]', first_line)
    if bracket_match:
        tag_text = bracket_match.group(1).lower()
        for keywords, commit_type in COMMIT_TYPE_KEYWORDS:
            if any(k in tag_text for k in keywords):
                return commit_type

    # 3. 关键字语义模糊匹配
    lower_first_line = first_line.lower()
    for keywords, commit_type in COMMIT_TYPE_KEYWORDS:
        if any(k in lower_first_line for k in keywords):
            return commit_type

    return 'OTHER'


def parse_iso_datetime(dt_str: str) -> datetime:
    """解析多种 ISO 8601 时间格式字符串为 UTC datetime 对象"""
    if not dt_str:
        return datetime.now(timezone.utc)
    # 处理带时区的格式，如 2026-10-27T16:30:00+08:00
    try:
        # Python 3.7+ 支持 fromisoformat
        if '+' in dt_str or dt_str.endswith('Z'):
            clean_str = dt_str.replace('Z', '+00:00')
            return datetime.fromisoformat(clean_str)
    except Exception:
        pass
    # 备选正则匹配
    try:
        base_str = dt_str.split('+')[0].split('.')[0].replace('T', ' ')
        return datetime.strptime(base_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def format_relative_time(dt_obj: datetime, now_obj: datetime = None) -> str:
    """计算距离现在的相对时间描述（如 5分钟前、2小时前、昨天、3天前）"""
    if not now_obj:
        now_obj = datetime.now(timezone.utc)
    diff = now_obj - dt_obj
    seconds = int(diff.total_seconds())

    if seconds < 0:
        return "刚刚"
    if seconds < 60:
        return "刚刚"
    if seconds < 3600:
        return f"{seconds // 60} 分钟前"
    if seconds < 86400:
        return f"{seconds // 3600} 小时前"
    if seconds < 86400 * 2:
        return "昨天"
    if seconds < 86400 * 30:
        return f"{seconds // 86400} 天前"
    if seconds < 86400 * 365:
        return f"{seconds // (86400 * 30)} 个月前"
    return f"{seconds // (86400 * 365)} 年前"


class GiteeClient:
    """Gitee 开放 API 客户端包装器"""

    def __init__(self, access_token: str = None, enterprise: str = None):
        self.access_token = (access_token or "").strip()
        self.enterprise = (enterprise or "").strip()
        self._user_cache = None
        self._raw_requests_log = []  # 记录最近的 API 报文，供前端【接口 API 报文】查看

    def _request(self, endpoint: str, params: dict = None, method: str = "GET") -> tuple:
        """执行 Gitee API HTTP 请求并记录报文"""
        url = f"{GITEE_API_BASE}{endpoint}"
        query_params = dict(params or {})
        if self.access_token and "access_token" not in query_params:
            query_params["access_token"] = self.access_token

        query_str = urllib.parse.urlencode(query_params)
        req_url = f"{url}?{query_str}" if query_str else url

        headers = {
            "User-Agent": "ZenPilot-Gitee-Client/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json;charset=UTF-8"
        }

        req = urllib.request.Request(req_url, headers=headers, method=method)

        start_time = time.time()
        log_entry = {
            "endpoint": endpoint,
            "url": req_url.replace(self.access_token, "***" + self.access_token[-4:]) if self.access_token else req_url,
            "method": method,
            "params": {k: ("***" if k == "access_token" else v) for k, v in query_params.items()},
            "request_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "status_code": 0,
            "duration_ms": 0,
            "response": None,
            "error": None
        }

        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                status_code = response.getcode()
                raw_body = response.read().decode('utf-8', errors='replace')
                duration_ms = int((time.time() - start_time) * 1000)

                log_entry["status_code"] = status_code
                log_entry["duration_ms"] = duration_ms

                try:
                    data = json.loads(raw_body)
                    log_entry["response"] = data
                except Exception:
                    data = raw_body
                    log_entry["response"] = raw_body

                self._record_log(log_entry)
                return True, data, None
        except urllib.error.HTTPError as e:
            duration_ms = int((time.time() - start_time) * 1000)
            log_entry["status_code"] = e.code
            log_entry["duration_ms"] = duration_ms
            err_body = e.read().decode('utf-8', errors='replace') if hasattr(e, 'read') else str(e)
            try:
                err_json = json.loads(err_body)
                err_msg = err_json.get('message', err_body)
            except Exception:
                err_msg = err_body
            log_entry["error"] = err_msg
            self._record_log(log_entry)
            return False, None, f"Gitee HTTP {e.code}: {err_msg}"
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            log_entry["duration_ms"] = duration_ms
            log_entry["error"] = str(e)
            self._record_log(log_entry)
            return False, None, f"网络请求异常: {str(e)}"

    def _record_log(self, log_entry: dict):
        """记录最近的 API 报文 (最多保留 20 条)"""
        self._raw_requests_log.insert(0, log_entry)
        if len(self._raw_requests_log) > 20:
            self._raw_requests_log = self._raw_requests_log[:20]

    def get_raw_logs(self) -> list:
        """获取最近记录的 Gitee 接口请求与响应原始报文"""
        return self._raw_requests_log

    def get_user_info(self, force: bool = False) -> tuple:
        """获取当前 Access Token 对应的授权用户本人信息 (/v5/user)"""
        if self._user_cache and not force:
            return True, self._user_cache, None

        ok, data, err = self._request("/user")
        if not ok:
            return False, None, err

        # 获取用户绑定的所有邮箱列表 (包含 verified/committed 提交邮箱)
        emails = []
        ok_em, em_list, _ = self._request("/emails")
        if ok_em and isinstance(em_list, list):
            emails = [str(item.get("email")).strip().lower() for item in em_list if item.get("email")]

        user_email = (data.get("email") or "").strip().lower()
        if not user_email and emails:
            user_email = emails[0]

        user_info = {
            "id": data.get("id"),
            "login": data.get("login"),
            "name": data.get("name") or data.get("login"),
            "avatar_url": data.get("avatar_url") or "",
            "email": user_email,
            "emails": emails,
            "bio": data.get("bio") or "",
            "html_url": data.get("html_url") or f"https://gitee.com/{data.get('login')}",
            "created_at": data.get("created_at") or ""
        }
        self._user_cache = user_info
        return True, user_info, None

    def get_user_enterprises(self) -> tuple:
        """获取当前授权用户加入的所有企业列表 (/v5/user/enterprises)"""
        # 注意: Gitee 接口默认 admin=true 只查管理员企业，传 admin=false 获取全部加入的企业
        ok, data, err = self._request("/user/enterprises", {"admin": "false", "per_page": 100})
        if not ok:
            # 降级尝试不传 admin
            ok2, data2, err2 = self._request("/user/enterprises", {"per_page": 100})
            if not ok2:
                return False, [], err
            data = data2

        enterprises = []
        if isinstance(data, list):
            for item in data:
                enterprises.append({
                    "id": item.get("id"),
                    "name": item.get("name") or item.get("path"),
                    "path": item.get("path"),
                    "avatar_url": item.get("avatar_url") or "",
                    "url": item.get("url") or f"https://gitee.com/enterprises/{item.get('path')}",
                    "public": item.get("public", False)
                })
        return True, enterprises, None

    def get_enterprise_detail(self, enterprise_path: str) -> tuple:
        """获取指定企业详情 (/v5/enterprises/{enterprise})"""
        if not enterprise_path:
            return False, None, "企业路径不能为空"
        ok, data, err = self._request(f"/enterprises/{enterprise_path}")
        if not ok:
            return False, None, err
        return True, {
            "id": data.get("id"),
            "name": data.get("name") or enterprise_path,
            "path": data.get("path") or enterprise_path,
            "avatar_url": data.get("avatar_url") or "",
            "url": f"https://gitee.com/enterprises/{enterprise_path}"
        }, None

    def get_enterprise_member(self, enterprise_path: str, username: str) -> tuple:
        """获取指定用户在企业下的成员信息 (/v5/enterprises/{enterprise}/members/{username})"""
        if not enterprise_path or not username:
            return False, None, "参数不完整"
        ok, data, err = self._request(f"/enterprises/{enterprise_path}/members/{username}")
        if not ok:
            return False, None, err
        return True, {
            "member_id": data.get("user", {}).get("id") or data.get("id"),
            "role": data.get("role") or "member",
            "active": data.get("active", True),
            "remark": data.get("remark") or ""
        }, None

    def fetch_user_commit_events(self, target_enterprise_path: str = None, max_events: int = 150, extra_emails: list = None, extra_names: list = None) -> tuple:
        """
        拉取并解析当前登录用户在企业下的代码提交事件记录与流水列表。
        核心逻辑：
        1. 验证用户身份，获取当前用户 login / name / email，以及 /emails 绑定的提交邮箱列表。
        2. 获取用户所属企业，确定目标企业 ID / path。
        3. 调用 /v5/users/{username}/events 拉取用户的动态事件 (PushEvent)。
        4. 过滤与识别：
           - 事件触发者必须为当前授权用户 (event.actor.login == current_user.login)。
           - 如果指定了企业，仓库必须属于该企业 (repo.namespace == enterprise_path)。
           - 对 PushEvent 中的 commits 检验作者身份：
             * commit.author.email 命中用户的认证/提交邮箱列表；
             * 或 commit.author.name / user 命中用户用户名或姓名；
             * 或推送事件由本人触发且无冲突作者。
        5. 统计指标计算：活跃仓库数、本周累计 Commit 次数、Push 推送事件总数、活跃开发分支数等。
        """
        # 1. 验证用户身份
        ok_u, user_info, err_u = self.get_user_info()
        if not ok_u:
            return False, None, f"获取用户信息失败: {err_u}"

        current_login = str(user_info.get("login") or "").strip().lower()
        current_name = str(user_info.get("name") or "").strip().lower()
        current_email = str(user_info.get("email") or "").strip().lower()

        # 收集用户绑定的全部邮箱集合 (从 /emails 接口与 user_info 中获取)
        user_emails = set()
        if current_email:
            user_emails.add(current_email)
        for em in user_info.get("emails") or []:
            if em:
                user_emails.add(str(em).strip().lower())
        if extra_emails:
            for em in extra_emails:
                if em:
                    user_emails.add(str(em).strip().lower())

        # 收集用户可能使用的 Git 提交作者名别名 (支持大小写不敏感匹配)
        known_names = {current_login, current_name}
        if extra_names:
            for n in extra_names:
                if n:
                    known_names.add(str(n).strip().lower())

        # 2. 获取用户企业信息
        ok_ent, enterprises, _ = self.get_user_enterprises()
        active_ent = None

        req_ent_path = (target_enterprise_path or self.enterprise or "").strip()
        if req_ent_path and enterprises:
            for ent in enterprises:
                if str(ent.get("path") or "").lower() == req_ent_path.lower() or str(ent.get("id")) == req_ent_path:
                    active_ent = ent
                    break

        if not active_ent and enterprises:
            active_ent = enterprises[0]

        if not active_ent and req_ent_path:
            # 尝试直接查询企业详情
            ok_d, d_ent, _ = self.get_enterprise_detail(req_ent_path)
            if ok_d:
                active_ent = d_ent
            else:
                active_ent = {"id": req_ent_path, "name": req_ent_path, "path": req_ent_path}

        if not active_ent:
            active_ent = {
                "id": user_info.get("id"),
                "name": f"{user_info.get('name')} 的个人组织",
                "path": user_info.get("login")
            }

        enterprise_path = str(active_ent.get("path") or "").strip().lower()
        enterprise_id = str(active_ent.get("id") or "")

        # 查询企业成员 ID
        member_id = str(user_info.get("id") or "")
        if enterprise_path:
            ok_m, m_info, _ = self.get_enterprise_member(enterprise_path, user_info.get("login"))
            if ok_m and m_info.get("member_id"):
                member_id = str(m_info["member_id"])

        # 3. 分页拉取 /v5/users/{username}/events
        events = []
        limit = min(max_events, 100)
        prev_id = None

        # 最多抓取 3 页以获取充分的历史提交记录
        for _ in range(3):
            params = {"limit": limit}
            if prev_id:
                params["prev_id"] = prev_id

            ok_ev, page_events, err_ev = self._request(f"/users/{user_info['login']}/events", params)
            if not ok_ev or not isinstance(page_events, list) or len(page_events) == 0:
                break

            events.extend(page_events)
            if len(events) >= max_events:
                events = events[:max_events]
                break

            # 记录最后一个事件 ID 作为下页游标
            last_event = page_events[-1]
            if isinstance(last_event, dict) and last_event.get("id"):
                prev_id = last_event["id"]
            else:
                break

        # 4. 解析与多重精准过滤 (只保留属于当前用户本人在目标企业下的 Commit)
        commits_list = []
        push_events_count = 0
        repo_commits_info = {}
        active_branches = set()
        active_repos = set()
        now_utc = datetime.now(timezone.utc)

        # 计算本周周一 00:00:00 (UTC+8 对应北京时间)
        now_beijing = datetime.now(timezone(timedelta(hours=8)))
        monday_beijing = (now_beijing - timedelta(days=now_beijing.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        monday_utc = monday_beijing.astimezone(timezone.utc)

        this_week_commits_count = 0
        min_commit_time = None
        max_commit_time = None

        for event in events:
            if not isinstance(event, dict):
                continue
            event_type = event.get("type")
            if event_type != "PushEvent":
                continue

            # 约束 1: 必须由当前授权用户本人触发该事件
            actor_login = str(event.get("actor", {}).get("login") or "").lower()
            if actor_login and actor_login != current_login:
                continue

            # 约束 2: 仓库归属过滤 (如果指定了企业路径，仓库 namespace 需包含该企业)
            repo = event.get("repo") or {}
            repo_full_name = repo.get("name") or repo.get("full_name") or ""
            repo_namespace = (repo_full_name.split("/")[0] if "/" in repo_full_name else "").lower()

            if enterprise_path and repo_namespace:
                # 匹配当前企业命名空间
                if repo_namespace != enterprise_path:
                    continue

            payload = event.get("payload") or {}
            raw_commits = payload.get("commits") or []
            if not raw_commits:
                continue

            push_event_id = str(event.get("id") or f"push_{len(commits_list)}")
            event_created_at = event.get("created_at") or ""

            # 分支名解析: refs/heads/master -> master
            ref_str = payload.get("ref") or ""
            branch_name = ref_str.replace("refs/heads/", "") if "refs/heads/" in ref_str else (ref_str or "master")

            repo_short_name = repo_full_name.split("/")[-1] if "/" in repo_full_name else (repo.get("path") or repo_full_name)

            commit_matched_in_event = False

            for c in raw_commits:
                if not isinstance(c, dict):
                    continue

                # 约束 3: Commit 作者必须是当前用户本人，杜绝拉取他人提交！
                c_author = c.get("author") or {}
                c_author_user = str(c_author.get("username") or c_author.get("user") or "").lower()
                c_author_name = str(c_author.get("name") or "").lower()
                c_author_email = str(c_author.get("email") or "").lower()

                # 判断作者身份是否匹配当前登录用户
                is_self = False
                if c_author_email and c_author_email in user_emails:
                    is_self = True
                elif c_author_user and c_author_user in known_names:
                    is_self = True
                elif c_author_name and c_author_name in known_names:
                    is_self = True
                elif not c_author_user and not c_author_name and not c_author_email:
                    # 如果 commit 未附带作者字段，以 push event 触发者为准
                    is_self = True
                elif not user_emails:
                    # 若未能获取到认证邮箱，事件又属于本人个人动态，判定为本人提交
                    is_self = True

                if not is_self:
                    continue

                commit_matched_in_event = True

                commit_sha = c.get("sha") or c.get("id") or ""
                if not commit_sha:
                    continue

                short_sha = commit_sha[:7] if len(commit_sha) >= 7 else commit_sha
                message = c.get("message") or ""
                lines = message.strip().split("\n")
                title = lines[0].strip() if lines else "代码提交变更"
                body = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

                commit_type = classify_commit_type(title)

                # 提交时间
                c_time_str = c.get("timestamp") or event_created_at or ""
                c_dt = parse_iso_datetime(c_time_str)

                # 本周提交判定
                if c_dt >= monday_utc:
                    this_week_commits_count += 1

                # 统计时间范围
                if min_commit_time is None or c_dt < min_commit_time:
                    min_commit_time = c_dt
                if max_commit_time is None or c_dt > max_commit_time:
                    max_commit_time = c_dt

                # 记录有效仓库与分支
                active_branches.add(branch_name)
                active_repos.add(repo_short_name)

                # 统计仓库提交数 (按 repo_short_name 记录，同时保留全称与短名)
                if repo_short_name not in repo_commits_info:
                    repo_commits_info[repo_short_name] = {
                        "name": repo_short_name,
                        "path": repo_full_name,
                        "full_name": repo_full_name,
                        "count": 0
                    }
                repo_commits_info[repo_short_name]["count"] += 1

                # Gitee 页面查看链接
                commit_url = c.get("url") or ""
                if not commit_url and repo_full_name:
                    commit_url = f"https://gitee.com/{repo_full_name}/commit/{commit_sha}"

                commits_list.append({
                    "commit_id": commit_sha,
                    "short_sha": short_sha,
                    "repo_name": repo_short_name,
                    "repo_full_name": repo_full_name,
                    "repo_path": repo_full_name,
                    "branch": branch_name,
                    "commit_type": commit_type,
                    "title": title,
                    "body": body,
                    "message": message,
                    "timestamp": c_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "relative_time": format_relative_time(c_dt, now_utc),
                    "url": commit_url,
                    "push_event_id": push_event_id,
                    "author_name": c_author.get("name") or user_info.get("name"),
                    "author_email": c_author.get("email") or user_info.get("email"),
                    "author_username": user_info.get("login")
                })

            if commit_matched_in_event:
                push_events_count += 1

        # 按提交时间倒序排列
        commits_list.sort(key=lambda x: x["timestamp"], reverse=True)

        # 统计周期显示
        if min_commit_time and max_commit_time:
            date_range_str = f"{min_commit_time.strftime('%Y-%m-%d')} ~ {max_commit_time.strftime('%Y-%m-%d')}"
        else:
            seven_days_ago = now_beijing - timedelta(days=7)
            date_range_str = f"{seven_days_ago.strftime('%Y-%m-%d')} ~ {now_beijing.strftime('%Y-%m-%d')}"

        # 整理项目仓库标签统计列表
        repos_summary = sorted(repo_commits_info.values(), key=lambda x: x["count"], reverse=True)

        result_data = {
            "user": user_info,
            "enterprise": active_ent,
            "enterprises": enterprises,
            "stats": {
                "active_repos_count": len(active_repos),
                "this_week_commits_count": this_week_commits_count,
                "total_push_events": push_events_count,
                "active_branches_count": len(active_branches),
                "total_commits": len(commits_list),
                "date_range": date_range_str,
                "enterprise_id": enterprise_id or "100234",
                "member_id": member_id or "982143"
            },
            "repos": repos_summary,
            "commits": commits_list,
            "raw_api_payload": self._raw_requests_log[:5]
        }

        return True, result_data, None


def get_demo_gitee_dataset(username: str = "dev_user", realname: str = "张开发") -> dict:
    """
    生成高拟真演示数据集（在未输入 Token 或需要体验交互时无缝演示）。
    包含全部指标卡片、企业信息、多仓库标签、丰富的 Conventional Commits 记录。
    """
    now = datetime.now()
    seven_days_ago = now - timedelta(days=7)

    demo_repos = [
        {"name": "data-pipeline-core", "full_name": "enterprise-tech/data-pipeline-core", "count": 14},
        {"name": "data-governance-platform", "full_name": "enterprise-tech/data-governance-platform", "count": 9},
        {"name": "task-dispatch-engine", "full_name": "enterprise-tech/task-dispatch-engine", "count": 6},
        {"name": "zenpilot-studio", "full_name": "enterprise-tech/zenpilot-studio", "count": 8},
        {"name": "industrial-ai-agent", "full_name": "enterprise-tech/industrial-ai-agent", "count": 5},
        {"name": "etl-pipeline-core", "full_name": "enterprise-tech/etl-pipeline-core", "count": 4},
    ]

    raw_demo_commits = [
        {
            "sha": "d78f41e59c23b8192ab1847c0a9ef832a819b7d1",
            "repo": "zenpilot-studio",
            "branch": "main",
            "type": "FEAT",
            "title": "feat: 支持分组管理成员关键字搜索与多选，优化任务批量修改及筛选过滤逻辑",
            "body": "1. 替换原下拉选择框为高性能可搜索多选组件，支持中文/账号模糊匹配与高亮\n2. 增加候选人批量多选、全选搜索结果、已在组内状态置灰\n3. 优化任务批量修改防字段覆盖逻辑",
            "hours_ago": 1.5,
            "event_id": "push_9821471"
        },
        {
            "sha": "5c85622a9108cb34710928e19273841928019a2e",
            "repo": "zenpilot-studio",
            "branch": "main",
            "type": "FEAT",
            "title": "feat(ai): 集成AI生成Word/MD文档能力并支持浏览器直接下载",
            "body": "使用 python-docx 实现结构化工作周报与智能文档导出，前端增加下载状态感知动画",
            "hours_ago": 4.2,
            "event_id": "push_9821420"
        },
        {
            "sha": "9b12a84c81029e84710928e19273841928019b88",
            "repo": "data-pipeline-core",
            "branch": "feature/v2.3-etl",
            "type": "FIX",
            "title": "fix: 修复核心数据采集流水线任务无报错但数据未入库问题",
            "body": "修正 SQL 参数映射类型转换错误，补充空值校验与连接池重试机制，任务ID: 67567 已验证正常",
            "hours_ago": 7.5,
            "event_id": "push_9821389"
        },
        {
            "sha": "f839ab6b81092e84710928e19273841928019c41",
            "repo": "zenpilot-studio",
            "branch": "main",
            "type": "STYLE",
            "title": "style: 优化任务查询条件的排列，界面干净简洁紧凑",
            "body": "精简字段占位高度，统一组件基准线对齐，防止栅格组件发生拉伸与变形扭曲",
            "hours_ago": 16.0,
            "event_id": "push_9821312"
        },
        {
            "sha": "71a9e04d81092e84710928e19273841928019d15",
            "repo": "data-governance-platform",
            "branch": "master",
            "type": "REFACTOR",
            "title": "refactor(api): 重构元数据表同步调度器，采用事件驱动与异步工作队列",
            "body": "解耦同步触发与任务状态更新，内存开销降低 42%，吞吐量提升 2.8 倍",
            "hours_ago": 26.5,
            "event_id": "push_9821245"
        },
        {
            "sha": "44b2c11e81092e84710928e19273841928019e99",
            "repo": "industrial-ai-agent",
            "branch": "feature/prompt-chain",
            "type": "FEAT",
            "title": "feat(agent): 增强工业数据分析 Agent 工具调用与执行链追踪",
            "body": "新增 SQL 自动生成与安全执行沙箱，支持多轮交互上下文动态压缩",
            "hours_ago": 32.0,
            "event_id": "push_9821190"
        },
        {
            "sha": "3a88f90c81092e84710928e19273841928019f72",
            "repo": "task-dispatch-engine",
            "branch": "dev",
            "type": "PERF",
            "title": "perf: 优化高并发任务分发吞吐性能，增加 Redis 本地环形双缓存",
            "body": "压测单节点 TPS 从 1200 提升至 4800，有效规避高频心跳下的网络阻塞",
            "hours_ago": 48.0,
            "event_id": "push_9821088"
        },
        {
            "sha": "1c77d29e81092e84710928e19273841928019a10",
            "repo": "data-pipeline-core",
            "branch": "master",
            "type": "STYLE",
            "title": "style(lint): 按照 PEP8 统一清洗采集驱动代码格式，修复 flake8 告警",
            "body": "规范所有异常捕获声明，统一变量命名与 import 组织次序",
            "hours_ago": 54.0,
            "event_id": "push_9820980"
        },
        {
            "sha": "8e33b66a81092e84710928e19273841928019b33",
            "repo": "etl-pipeline-core",
            "branch": "release/v1.8",
            "type": "DOCS",
            "title": "docs: 完善数据接入流水线部署手册与配置字典规范说明",
            "body": "更新环境依赖要求，补充 Kafka 与 MinIO 鉴权连接示例",
            "hours_ago": 68.0,
            "event_id": "push_9820876"
        },
        {
            "sha": "2f66c88b81092e84710928e19273841928019c55",
            "repo": "data-governance-platform",
            "branch": "master",
            "type": "FIX",
            "title": "fix(permission): 修复团队分组角色授权偶现的跨租户策略逃逸风险",
            "body": "加固接口拦截器 Session 校验切面，补齐权限白名单覆盖单元测试",
            "hours_ago": 82.0,
            "event_id": "push_9820765"
        },
        {
            "sha": "0e55d44a81092e84710928e19273841928019d88",
            "repo": "data-pipeline-core",
            "branch": "feature/v2.3-etl",
            "type": "TEST",
            "title": "test: 补充数据源心跳检测与断线重连自动化集成测试套件",
            "body": "模拟极端网络丢包场景，测试验证断网恢复后数据流水重放的一致性",
            "hours_ago": 96.0,
            "event_id": "push_9820610"
        },
        {
            "sha": "9a44c22e81092e84710928e19273841928019e11",
            "repo": "zenpilot-studio",
            "branch": "master",
            "type": "CHORE",
            "title": "chore(deps): 升级核心依赖版本，移除无用冗余组件包",
            "body": "同步更新 requirements.txt，精简镜像打包体积约 65MB",
            "hours_ago": 120.0,
            "event_id": "push_9820499"
        }
    ]

    commits = []
    this_week_count = 0
    now_utc = datetime.now(timezone.utc)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

    for item in raw_demo_commits:
        c_time = now - timedelta(hours=item["hours_ago"])
        if c_time >= monday:
            this_week_count += 1
        full_repo = f"enterprise-tech/{item['repo']}"
        commits.append({
            "commit_id": item["sha"],
            "short_sha": item["sha"][:7],
            "repo_name": item["repo"],
            "repo_full_name": full_repo,
            "branch": item["branch"],
            "commit_type": item["type"],
            "title": item["title"],
            "body": item["body"],
            "message": f"{item['title']}\n\n{item['body']}",
            "timestamp": c_time.strftime("%Y-%m-%d %H:%M:%S"),
            "relative_time": format_relative_time(c_time.replace(tzinfo=timezone.utc), now_utc),
            "url": f"https://gitee.com/{full_repo}/commit/{item['sha']}",
            "push_event_id": item["event_id"],
            "author_name": realname,
            "author_email": f"{username}@example.com",
            "author_username": username
        })

    demo_raw_payload = [
        {
            "endpoint": f"/users/{username}/events",
            "url": f"https://gitee.com/api/v5/users/{username}/events?limit=20&access_token=***",
            "method": "GET",
            "request_time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "status_code": 200,
            "duration_ms": 138,
            "response": [
                {
                    "id": "push_9821471",
                    "type": "PushEvent",
                    "actor": {
                        "id": 982143,
                        "login": username,
                        "name": realname,
                        "avatar_url": "https://gitee.com/assets/favicon.ico"
                    },
                    "repo": {
                        "id": 1042910,
                        "name": "enterprise-tech/zenpilot-studio",
                        "path": "zenpilot-studio",
                        "url": "https://gitee.com/enterprise-tech/zenpilot-studio"
                    },
                    "created_at": (now - timedelta(hours=1.5)).isoformat(),
                    "payload": {
                        "ref": "refs/heads/main",
                        "before": "5c85622a9108cb34710928e19273841928019a2e",
                        "head": "d78f41e59c23b8192ab1847c0a9ef832a819b7d1",
                        "commits": [
                            {
                                "sha": "d78f41e59c23b8192ab1847c0a9ef832a819b7d1",
                                "message": raw_demo_commits[0]["title"],
                                "author": {"name": realname, "email": f"{username}@example.com", "username": username},
                                "url": f"https://gitee.com/enterprise-tech/zenpilot-studio/commit/d78f41e59c23b8192ab1847c0a9ef832a819b7d1"
                            }
                        ]
                    }
                }
            ]
        },
        {
            "endpoint": "/user",
            "url": "https://gitee.com/api/v5/user?access_token=***",
            "method": "GET",
            "request_time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "status_code": 200,
            "duration_ms": 94,
            "response": {
                "id": 982143,
                "login": username,
                "name": realname,
                "avatar_url": "https://gitee.com/assets/favicon.ico",
                "email": f"{username}@example.com",
                "html_url": f"https://gitee.com/{username}"
            }
        },
        {
            "endpoint": "/user/enterprises",
            "url": "https://gitee.com/api/v5/user/enterprises?admin=false&per_page=100&access_token=***",
            "method": "GET",
            "request_time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "status_code": 200,
            "duration_ms": 112,
            "response": [
                {
                    "id": 100862,
                    "name": "企业数字化技术研发中心",
                    "path": "enterprise-tech",
                    "url": "https://gitee.com/enterprises/enterprise-tech"
                }
            ]
        }
    ]

    return {
        "user": {
            "id": 982143,
            "login": username,
            "name": realname,
            "avatar_url": "https://gitee.com/assets/favicon.ico",
            "email": f"{username}@example.com",
            "html_url": f"https://gitee.com/{username}"
        },
        "enterprise": {
            "id": "100862",
            "name": "企业数字化技术研发中心",
            "path": "enterprise-tech",
            "url": "https://gitee.com/enterprises/enterprise-tech"
        },
        "enterprises": [
            {
                "id": "100862",
                "name": "企业数字化技术研发中心",
                "path": "enterprise-tech",
                "url": "https://gitee.com/enterprises/enterprise-tech"
            }
        ],
        "stats": {
            "active_repos_count": len(demo_repos),
            "this_week_commits_count": this_week_count,
            "total_push_events": len(raw_demo_commits),
            "active_branches_count": 5,
            "total_commits": len(commits),
            "date_range": f"{seven_days_ago.strftime('%Y-%m-%d')} ~ {now.strftime('%Y-%m-%d')}",
            "enterprise_id": "100862",
            "member_id": "982143",
            "is_demo": True
        },
        "repos": demo_repos,
        "commits": commits,
        "raw_api_payload": demo_raw_payload
    }
