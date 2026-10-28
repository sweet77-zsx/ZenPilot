# -*- coding: utf-8 -*-
"""
禅道 API 客户端核心模块 (ZenTao Client Core)
封装企业云禅道及标准开源版/企业版/旗舰版禅道系统的 API 调用。
"""

import os
import re
import json
import time
import requests
import configparser
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

class ZentaoClient:
    def __init__(self, base_url, account, password):
        self.base_url = base_url.rstrip('/')
        self.account = account
        self.password = password
        self.session = requests.Session()
        
        # 挂载自动重试与长连接连接池保护
        retries = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["GET", "POST", "HEAD"]
        )
        adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=20)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest"
        })
        self.realname = ""
        self.user_info = {}
        self._account_to_uid = {}
        self._uid_to_account = {}
        self.login()

    def _req(self, method, url, **kwargs):
        """
        统一 HTTP 请求封装，带断线重连、Keep-Alive 闲置超时自动恢复与重试机制。
        解决批量处理长间隔休眠（如 5s）时远端关闭 TCP 连接导致的 RemoteDisconnected / ConnectionError 问题。
        """
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 15

        last_exc = None
        for attempt in range(3):
            try:
                if method.upper() == 'GET':
                    return self.session.get(url, **kwargs)
                else:
                    return self.session.post(url, **kwargs)
            except (requests.exceptions.ConnectionError, requests.exceptions.ChunkedEncodingError, requests.exceptions.Timeout) as e:
                last_exc = e
                # 远端 Keep-Alive 闲置超时主动断开连接，关闭旧连接池以便重开干净的 TCP 握手
                try:
                    self.session.close()
                except Exception:
                    pass
                time.sleep(0.5)
            except Exception as e:
                raise e

        if last_exc:
            raise last_exc

    def login(self):
        """登录禅道并保存会话"""
        # 1. 获取 SessionID
        try:
            sess_url = f"{self.base_url}/api-getSessionID.json"
            r_sess = self._req('GET', sess_url, timeout=10)
            if r_sess.status_code == 200:
                data = r_sess.json()
                raw_data = data.get('data')
                if raw_data:
                    session_obj = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
                    if 'sessionID' in session_obj:
                        self.session.cookies.set('zentaosid', session_obj['sessionID'])
        except Exception:
            pass

        # 2. 调用 user-login.json 登录
        login_url = f"{self.base_url}/user-login.json"
        res = self._req('POST', login_url, data={"account": self.account, "password": self.password}, timeout=10)
        if res.status_code == 200:
            res_data = res.json()
            if res_data.get("status") == "success":
                self.user_info = res_data.get("user", {})
                # 自动将用户输入的 account 校准为禅道系统官方标准的 account (避免大小写输入差异)
                official_acc = self.user_info.get("account")
                if official_acc:
                    self.account = official_acc
                self.realname = self.user_info.get("realname", self.account)
                token = self.user_info.get("token")
                if token:
                    self.session.headers.update({"Token": token})
                return True
            else:
                reason = res_data.get("message") or res_data.get("reason") or res.text
                raise RuntimeError(f"登录失败: {reason}")
        else:
            raise RuntimeError(f"HTTP 请求异常: 状态码 {res.status_code}")

    def _parse_data(self, response):
        """解析禅道统一返回的 data 字段"""
        try:
            res_json = response.json()
            raw = res_json.get('data', '{}')
            if isinstance(raw, str):
                return json.loads(raw)
            return raw
        except Exception:
            return {}

    def get_my_tasks(self, view_type="assignedTo", fetch_all=True):
        """获取我的任务列表 (assignedTo, openedBy, finishedBy, closedBy, all)"""
        # 禅道原生接口并不支持 my-task-all，当请求 all 时合并全部4个维度的关联任务
        if view_type == 'all':
            task_dict = {}
            for vt in ['finishedBy', 'assignedTo', 'openedBy', 'closedBy']:
                for t in self.get_my_tasks(view_type=vt, fetch_all=fetch_all):
                    tid = str(t.get('id', ''))
                    if tid and tid not in task_dict:
                        task_dict[tid] = t
            return list(task_dict.values())

        url = f"{self.base_url}/my-task-{view_type}-id_desc-0-1000-1.json"
        res = self._req('GET', url, timeout=15)
        data = self._parse_data(res)
        raw_tasks = data.get('tasks', [])
        tasks = list(raw_tasks.values()) if isinstance(raw_tasks, dict) else list(raw_tasks)
        users = data.get('users', {}) or {}

        pager = data.get('pager')
        if fetch_all and pager and isinstance(pager, dict):
            page_total = pager.get('pageTotal', 1)
            rec_per_page = pager.get('recPerPage', 1000)
            if page_total > 1:
                all_tasks = list(tasks)
                for page_id in range(2, page_total + 1):
                    p_url = f"{self.base_url}/my-task-{view_type}-id_desc-0-{rec_per_page}-{page_id}.json"
                    p_res = self._req('GET', p_url, timeout=15)
                    p_data = self._parse_data(p_res)
                    p_tasks = p_data.get('tasks', [])
                    if isinstance(p_tasks, dict):
                        p_tasks = list(p_tasks.values())
                    all_tasks.extend(p_tasks)
                    p_users = p_data.get('users', {}) or {}
                    if isinstance(p_users, dict):
                        users.update(p_users)
                tasks = all_tasks

        # 按 task id 去重
        task_dict = {}
        for t in tasks:
            if isinstance(t, dict) and t.get('id'):
                task_dict[str(t['id'])] = t
        tasks = list(task_dict.values())

        # 补全真实姓名显示
        for t in tasks:
            if isinstance(t, dict):
                fb = t.get('finishedBy', '')
                if fb and not t.get('finishedByRealname'):
                    t['finishedByRealname'] = users.get(fb, fb)
                assigned = t.get('assignedTo', '')
                if assigned and not t.get('assignedToRealname'):
                    t['assignedToRealname'] = users.get(assigned, assigned)

        return tasks

    def get_all_projects(self):
        """实时查询所有项目列表"""
        url = f"{self.base_url}/project-all.json"
        res = self._req('GET', url, timeout=10)
        data = self._parse_data(res)
        projs = data.get('projects', {})
        proj_list = []
        if isinstance(projs, dict):
            for pid, pname in projs.items():
                if pid and pname:
                    proj_list.append({"id": str(pid), "name": str(pname)})
        elif isinstance(projs, list):
            for p in projs:
                if isinstance(p, dict):
                    proj_list.append({"id": str(p.get('id')), "name": str(p.get('name'))})
        
        # 按 ID 倒序排列，最新创建的项目排在前面
        try:
            proj_list.sort(key=lambda x: int(x['id']), reverse=True)
        except Exception:
            pass
        return proj_list

    def get_uid_by_account(self, account):
        """根据用户 account 查找其在禅道中的数字 UID"""
        if not account:
            return None
        # 如果本身就是纯数字
        if str(account).isdigit():
            return int(account)
        # 如果是当前登录用户
        if self.account and str(account).lower() == self.account.lower():
            if self.user_info.get('id'):
                return int(self.user_info['id'])
        # 查字典
        if not self._account_to_uid:
            self.get_all_users()
        uid = self._account_to_uid.get(account)
        if not uid:
            # 大小写不敏感匹配
            for acc, u in self._account_to_uid.items():
                if acc.lower() == str(account).lower():
                    return u
        return uid

    def get_user_tasks(self, account=None, view_type="assignedTo", fetch_all=True):
        """
        获取指定用户的任务列表。
        支持 view_type: assignedTo, finishedBy, openedBy, closedBy, all
        若 account 为空或等于当前登录账号，自动调用 get_my_tasks。
        若为其他用户，通过禅道原生 /user-task-{uid}-{view_type}.json 进行全量/分页抓取。
        """
        if not account or (self.account and str(account).lower() == self.account.lower()):
            return self.get_my_tasks(view_type=view_type, fetch_all=fetch_all)

        uid = self.get_uid_by_account(account)
        if not uid:
            print(f"Warning: Cannot resolve UID for user account '{account}'")
            return []

        # 禅道原生 user-task 不直接支持 'all'，当用户选择 'all' 时，合并抓取全部4个维度的关联任务并按 task id 去重
        if view_type == 'all':
            task_dict = {}
            for vt in ['finishedBy', 'assignedTo', 'openedBy', 'closedBy']:
                for t in self._fetch_user_tasks_by_type(uid, vt, fetch_all):
                    tid = str(t.get('id', ''))
                    if tid and tid not in task_dict:
                        task_dict[tid] = t
            return list(task_dict.values())
        else:
            return self._fetch_user_tasks_by_type(uid, view_type, fetch_all)

    def _fetch_user_tasks_by_type(self, uid, view_type, fetch_all=True):
        rec_per_page = 100
        url = f"{self.base_url}/user-task-{uid}-{view_type}-id_desc-{rec_per_page}-1.json"
        res = self._req('GET', url, timeout=15)
        data = self._parse_data(res)
        raw_tasks = data.get('tasks', [])
        tasks = list(raw_tasks.values()) if isinstance(raw_tasks, dict) else list(raw_tasks)
        users = data.get('users', {}) or {}

        # 严格按任务 ID 去重
        task_dict = {}
        for t in tasks:
            if isinstance(t, dict) and t.get('id'):
                task_dict[str(t['id'])] = t

        pager = data.get('pager')
        if fetch_all and pager and isinstance(pager, dict):
            page_total = int(pager.get('pageTotal', 1) or 1)
            # 安全防呆：每页 100 条，最多抓取前 10 页 (即最多 1000 条任务)
            max_pages = min(page_total, 10)
            if max_pages > 1:
                for page_id in range(2, max_pages + 1):
                    p_url = f"{self.base_url}/user-task-{uid}-{view_type}-id_desc-{rec_per_page}-{page_id}.json"
                    p_res = self._req('GET', p_url, timeout=10)
                    p_data = self._parse_data(p_res)
                    p_tasks = p_data.get('tasks', [])
                    if isinstance(p_tasks, dict):
                        p_tasks = list(p_tasks.values())
                    for t in p_tasks:
                        if isinstance(t, dict) and t.get('id'):
                            task_dict[str(t['id'])] = t
                    p_users = p_data.get('users', {}) or {}
                    if isinstance(p_users, dict):
                        users.update(p_users)

        tasks = list(task_dict.values())

        # 补全真实姓名
        for t in tasks:
            if isinstance(t, dict):
                fb = t.get('finishedBy', '')
                if fb and not t.get('finishedByRealname'):
                    t['finishedByRealname'] = users.get(fb, fb)
                assigned = t.get('assignedTo', '')
                if assigned and not t.get('assignedToRealname'):
                    t['assignedToRealname'] = users.get(assigned, assigned)
                opened = t.get('openedBy', '')
                if opened and not t.get('openedByRealname'):
                    t['openedByRealname'] = users.get(opened, opened)
                closed = t.get('closedBy', '')
                if closed and not t.get('closedByRealname'):
                    t['closedByRealname'] = users.get(closed, closed)

        return tasks

    def get_all_users(self):
        """
        获取系统中的所有用户列表，格式统一为:
        [{"account": "admin", "realname": "管理员", "id": 1}, {"account": "zhangsan", "realname": "张三", "id": 10}, ...]
        采用多重策略兜底，并解析精准的数字 UID 映射，兼容各类云禅道与标准私有化禅道版本。
        """
        user_map = {}  # account -> realname

        # 策略 1: 尝试调用组织/用户相关接口
        endpoints = [
            f"{self.base_url}/company-browse-0-0-id_desc-1000-1.json",
            f"{self.base_url}/company-browse.json",
            f"{self.base_url}/user-manage.json",
            f"{self.base_url}/api-getModel-user-getList.json",
            f"{self.base_url}/user-contacts.json"
        ]
        for url in endpoints:
            try:
                res = self._req('GET', url, timeout=8)
                data = self._parse_data(res)
                if isinstance(data, dict):
                    raw_users = data.get('users')
                    if isinstance(raw_users, list):
                        for u in raw_users:
                            if isinstance(u, dict) and u.get('account'):
                                acc = str(u.get('account')).strip()
                                rname = str(u.get('realname') or acc).strip()
                                if acc and acc != 'closed':
                                    user_map[acc] = rname
                    elif isinstance(raw_users, dict):
                        for acc, rname in raw_users.items():
                            acc_str = str(acc).strip()
                            if acc_str and acc_str != 'closed':
                                user_map[acc_str] = str(rname or acc_str).strip()
                if len(user_map) >= 2:
                    break
            except Exception:
                continue

        # 策略 2: 如果策略 1 未获取到足够用户，从常用任务接口中提取自带的 users 全局映射字典
        if len(user_map) < 2:
            try:
                fallback_urls = [
                    f"{self.base_url}/my-task-all-id_desc-0-100-1.json",
                    f"{self.base_url}/my-task-assignedTo-id_desc-0-100-1.json"
                ]
                for f_url in fallback_urls:
                    res = self._req('GET', f_url, timeout=8)
                    data = self._parse_data(res)
                    if isinstance(data, dict):
                        users_dict = data.get('users', {})
                        if isinstance(users_dict, dict):
                            for acc, rname in users_dict.items():
                                acc_str = str(acc).strip()
                                if acc_str and acc_str != 'closed':
                                    user_map[acc_str] = str(rname or acc_str).strip()
                    if user_map:
                        break
            except Exception:
                pass

        # 确保当前登录用户在列表中
        if self.account and self.account not in user_map:
            user_map[self.account] = self.realname or self.account

        # 策略 3: 解析 user-task 返回的 userList 下拉选框，精准提取每一个用户的数字 UID 与姓名
        try:
            my_uid = (self.user_info.get('id') if isinstance(self.user_info, dict) else None) or 157
            if self.account and self.user_info.get('id'):
                self._account_to_uid[self.account] = int(self.user_info['id'])
                self._uid_to_account[int(self.user_info['id'])] = self.account

            url = f"{self.base_url}/user-task-{my_uid}.json"
            res = self._req('GET', url, timeout=8)
            data = self._parse_data(res)
            user_list_str = data.get('userList', '')
            if user_list_str:
                pattern = re.compile(r"<option\s+value='(\d+)'(?:\s+selected='selected')?(?:\s+title='([^']*)')?(?:\s+data-keys='([^']*)')?>([^<]*)</option>")
                matches = pattern.findall(user_list_str)
                for uid_str, title, keys, text in matches:
                    uid_val = int(uid_str)
                    clean_text = text.strip()
                    if ':' in clean_text:
                        clean_text = clean_text.split(':', 1)[1].strip()
                    for acc, rname in user_map.items():
                        if rname == clean_text:
                            self._account_to_uid[acc] = uid_val
                            self._uid_to_account[uid_val] = acc
                            break
        except Exception as e:
            print(f"Resolve userList UID error: {e}")

        # 转换并按姓名/账号排序
        user_list = []
        for acc, rname in user_map.items():
            uid_val = self._account_to_uid.get(acc)
            user_list.append({
                "account": acc,
                "realname": rname,
                "id": uid_val
            })

        try:
            user_list.sort(key=lambda x: (x['realname'], x['account']))
        except Exception:
            pass

        return user_list

    def get_project_tasks(self, project_id, fetch_all=True):
        """获取指定项目下的所有任务 (包含未开始、进行中、已完成、已关闭的全量任务)"""
        url = f"{self.base_url}/project-task-{project_id}-all-0--id_desc-1000-1.json"
        res = self._req('GET', url, timeout=15)
        data = self._parse_data(res)
        raw_tasks = data.get('tasks', [])
        tasks = list(raw_tasks.values()) if isinstance(raw_tasks, dict) else list(raw_tasks)
        users = data.get('users', {}) or {}

        pager = data.get('pager')
        if fetch_all and pager and isinstance(pager, dict):
            page_total = pager.get('pageTotal', 1)
            rec_per_page = pager.get('recPerPage', 1000)
            if page_total > 1:
                for page_id in range(2, page_total + 1):
                    p_url = f"{self.base_url}/project-task-{project_id}-all-0--id_desc-{rec_per_page}-{page_id}.json"
                    p_res = self._req('GET', p_url, timeout=15)
                    p_data = self._parse_data(p_res)
                    p_tasks = p_data.get('tasks', [])
                    if isinstance(p_tasks, dict):
                        p_tasks = list(p_tasks.values())
                    tasks.extend(p_tasks)
                    # 合并 users 字典
                    p_users = p_data.get('users', {}) or {}
                    if isinstance(p_users, dict):
                        users.update(p_users)

        # 补全真实姓名显示
        for t in tasks:
            if isinstance(t, dict):
                fb = t.get('finishedBy', '')
                if fb and not t.get('finishedByRealname'):
                    t['finishedByRealname'] = users.get(fb, fb)
                assigned = t.get('assignedTo', '')
                if assigned and not t.get('assignedToRealname'):
                    t['assignedToRealname'] = users.get(assigned, assigned)

        return tasks

    def get_execution_tasks(self, execution_id, fetch_all=True):
        """获取指定执行/迭代下的所有任务 (全量包含已关闭)"""
        url = f"{self.base_url}/execution-task-{execution_id}-all-0--id_desc-1000-1.json"
        res = self._req('GET', url, timeout=15)
        data = self._parse_data(res)
        raw_tasks = data.get('tasks', [])
        tasks = list(raw_tasks.values()) if isinstance(raw_tasks, dict) else list(raw_tasks)
        users = data.get('users', {}) or {}

        pager = data.get('pager')
        if fetch_all and pager and isinstance(pager, dict):
            page_total = pager.get('pageTotal', 1)
            rec_per_page = pager.get('recPerPage', 1000)
            if page_total > 1:
                for page_id in range(2, page_total + 1):
                    p_url = f"{self.base_url}/execution-task-{execution_id}-all-0--id_desc-{rec_per_page}-{page_id}.json"
                    p_res = self._req('GET', p_url, timeout=15)
                    p_data = self._parse_data(p_res)
                    p_tasks = p_data.get('tasks', [])
                    if isinstance(p_tasks, dict):
                        p_tasks = list(p_tasks.values())
                    tasks.extend(p_tasks)
                    p_users = p_data.get('users', {}) or {}
                    if isinstance(p_users, dict):
                        users.update(p_users)

        for t in tasks:
            if isinstance(t, dict):
                fb = t.get('finishedBy', '')
                if fb and not t.get('finishedByRealname'):
                    t['finishedByRealname'] = users.get(fb, fb)
                assigned = t.get('assignedTo', '')
                if assigned and not t.get('assignedToRealname'):
                    t['assignedToRealname'] = users.get(assigned, assigned)

        return tasks

    def get_task_detail(self, task_id):
        """获取指定任务的详细数据"""
        url = f"{self.base_url}/task-view-{task_id}.json"
        res = self._req('GET', url, timeout=10)
        data = self._parse_data(res)
        return data.get('task', {})

    def start_task(self, task_id, consumed=0.0, left=1.0):
        """启动任务 (wait -> doing)"""
        url = f"{self.base_url}/task-start-{task_id}.json"
        payload = {
            "consumed": consumed,
            "left": left,
            "realStarted": ""
        }
        res = self._req('POST', url, data=payload, timeout=10)
        return "success" in res.text or res.status_code == 200

    def finish_task(self, task_id, current_consumed=1.0, assigned_to=None, comment=""):
        """完成任务并报工"""
        task = self.get_task_detail(task_id)
        if not task:
            return False, f"未找到任务 #{task_id}"

        already_consumed = float(task.get('consumed', 0.0) or 0.0)
        total_consumed = already_consumed + float(current_consumed)

        finish_url = f"{self.base_url}/task-finish-{task_id}.json"
        payload = {
            "consumed": total_consumed,
            "currentConsumed": float(current_consumed),
            "assignedTo": assigned_to or task.get('openedBy', self.account),
            "comment": comment
        }
        res = self._req('POST', finish_url, data=payload, timeout=10)
        if "success" in res.text or res.status_code == 200:
            return True, "完成成功"
        else:
            return False, res.text

    def assign_task(self, task_id, assigned_to="closed", project_id=None, comment=""):
        """指派任务 (支持修改为 closed 或指定用户)"""
        task = self.get_task_detail(task_id)
        if not task:
            return False, f"未找到任务 #{task_id}"
        if not project_id:
            project_id = task.get('project', 0)

        # 确保 status 符合禅道正则 /wait|doing|done|pause|cancel|closed/，绝不可为空字符串
        current_status = str(task.get('status') or 'wait').strip()
        if current_status not in ['wait', 'doing', 'done', 'pause', 'cancel', 'closed']:
            current_status = 'wait'
        target_status = "closed" if assigned_to == "closed" else current_status
        current_left = str(task.get('left', '0') or '0')

        url = f"{self.base_url}/task-assignTo-{project_id}-{task_id}.json"
        payload = {
            "assignedTo": assigned_to,
            "status": target_status,
            "left": current_left,
            "comment": comment
        }
        res = self._req('POST', url, data=payload, timeout=10)
        data = self._parse_data(res)
        locate_url = str(data.get('locate', '')) if isinstance(data, dict) else ''

        # 检查是否被禅道权限拦截重定向
        if "user-deny" in res.text or "user-deny" in locate_url:
            return False, f"禅道权限不足：当前账号【{self.account}】无权指派该任务"

        if isinstance(data, dict):
            if data.get('result') == 'fail':
                msg = data.get('message') or '指派失败'
                if isinstance(msg, dict):
                    msg = "; ".join(f"{k}: {v}" for k, v in msg.items())
                # 若 assignTo 接口因权限或状态拒绝，自动使用 edit_task_fields 兜底修改指派人
                ok_edit, _ = self.edit_task_fields(task_id, {"assignedTo": assigned_to})
                if ok_edit:
                    return True, "指派修改成功"
                return False, str(msg)
            if 'locate' in data and "user-deny" not in locate_url:
                return True, "指派修改成功"

        if "user-deny" in res.text:
            return False, f"禅道权限不足：当前账号【{self.account}】无权指派该任务"

        if "locate" in res.text and "user-deny" not in res.text:
            return True, "指派修改成功"

        # 兜底通过 edit_task_fields 保证修改成功
        ok_edit, _ = self.edit_task_fields(task_id, {"assignedTo": assigned_to})
        if ok_edit:
            return True, "指派修改成功"

        return res.status_code == 200, "提交完成"

    def create_task(self, project_id, name, desc="", task_type="devel", pri=3, estimate=2.0,
                    assigned_to=None, est_started="", deadline="", module_id="0", story_id="0"):
        """
        在指定禅道项目中创建新任务
        :param project_id: 项目ID (如 '178')
        :param name: 任务名称
        :param desc: 任务描述 (文本或 HTML)
        :param task_type: 任务类型 ('devel', 'test', 'design', 'ui', 'request', 'deploy', 'review', 'study', 'affair', 'misc')
        :param pri: 优先级 1-4
        :param estimate: 最初预计工时
        :param assigned_to: 指派人账号 (如 'dev_user'，若包含 '(#...)' 则自动提取真实账号)
        :param est_started: 预计开始日期 (YYYY-MM-DD)
        :param deadline: 截止日期 (YYYY-MM-DD)
        :param module_id: 所属模块ID，默认 '0'
        :param story_id: 相关需求ID，默认 '0'
        :return: (ok: bool, message: str, task_info: dict)
        """
        # 映射中文类型为禅道内置英文字典
        type_mapping = {
            '开发': 'devel',
            '测试': 'test',
            '设计': 'design',
            '界面': 'ui',
            '需求': 'request',
            '部署': 'deploy',
            '运维': 'deploy',
            '评审': 'review',
            '研究': 'study',
            '事务': 'affair',
            '其他': 'misc'
        }
        actual_type = type_mapping.get(task_type, task_type) if task_type else 'devel'

        # 清洗指派人，例如 "张开发(#dev_user)" -> "dev_user"
        clean_assigned = (assigned_to or self.account).strip()
        match_acc = re.search(r'\(#([a-zA-Z0-9_\-\.]+)\)', clean_assigned)
        if match_acc:
            clean_assigned = match_acc.group(1)
        elif '#' in clean_assigned:
            clean_assigned = clean_assigned.split('#')[-1].replace(')', '').strip()

        # 格式化描述
        html_desc = desc or ""
        if html_desc and not html_desc.strip().startswith('<p>'):
            paragraphs = [f"<p>{p.strip()}</p>" for p in html_desc.split('\n') if p.strip()]
            html_desc = "".join(paragraphs) if paragraphs else f"<p>{desc}</p>"

        url = f"{self.base_url}/task-create-{project_id}.json"
        payload = {
            "project": str(project_id),
            "type": actual_type,
            "module": str(module_id or "0"),
            "story": str(story_id or "0"),
            "assignedTo[]": clean_assigned,
            "name": name.strip(),
            "pri": str(pri or 3),
            "estimate": str(estimate or 2),
            "estStarted": str(est_started or ""),
            "deadline": str(deadline or ""),
            "desc": html_desc,
            "status": "wait"
        }

        try:
            res = self._req('POST', url, data=payload, timeout=15)
            try:
                res_json = res.json()
            except Exception:
                res_json = {}

            if res_json.get("result") == "success" or res_json.get("status") == "success" or "保存成功" in res.text:
                return True, "创建成功", {"name": name, "project": project_id, "assignedTo": clean_assigned}
            else:
                msg = res_json.get("message")
                if isinstance(msg, dict):
                    err_msgs = []
                    for k, v in msg.items():
                        if isinstance(v, list):
                            err_msgs.extend(v)
                        else:
                            err_msgs.append(str(v))
                    msg_str = "; ".join(err_msgs)
                else:
                    msg_str = str(msg or res.text[:200])
                return False, msg_str, {}
        except Exception as e:
            return False, f"网络请求异常: {str(e)}", {}

    def _get_task_edit_form_data(self, task_id):
        """
        从任务编辑页面 HTML 动态解析提取全量真实表单字段。
        完美自适应保留已关闭/已完成等各种特殊状态任务的闭环上下文
        （如 lastEditedDate, closedBy, closedDate, closedReason, finishedBy, finishedDate, story 等）。
        """
        url = f"{self.base_url}/task-edit-{task_id}.html"
        try:
            resp = self._req('GET', url, timeout=10)
            if resp.status_code != 200 or not resp.text:
                return None

            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(resp.text, 'html.parser')
                form = soup.find('form')
                if not form:
                    return None

                form_data = {}
                for el in form.find_all(['input', 'select', 'textarea']):
                    name = el.get('name')
                    if not name or el.has_attr('disabled'):
                        continue
                    
                    if el.name == 'select':
                        selected_opts = el.find_all('option', selected=True)
                        if el.has_attr('multiple') or name.endswith('[]'):
                            val = [opt.get('value') for opt in selected_opts if opt.get('value')]
                        else:
                            val = selected_opts[0].get('value') if selected_opts else ''
                    elif el.name == 'textarea':
                        val = el.text or ''
                    else:
                        val = el.get('value', '')

                    if name not in form_data:
                        form_data[name] = val
                return form_data
            except Exception:
                return None
        except Exception:
            return None

    def edit_task_fields(self, task_id, update_fields, comment=""):
        """
        通用任务字段编辑（严格字段保护与防误修改增强版）：
        1. 获取任务当前数据库真实详情 (Ground Truth)；
        2. 解析编辑页全量表单以保留特殊状态下底层必填的隐藏上下文 (如 lastEditedDate, tokens 等)；
        3. 【核心安全防护】：对于任何未在 update_fields 中声明的字段，若表单解析出空值或与真实详情不一致，
           必须强制回退为权威原值（如 finishedBy, assignedTo, mailto 等），严防篡改清空原有记录！
        4. 仅对 update_fields 中明确指定的字段赋予新值；
        5. 双通道提交 (.json 接口优先 + 原生 HTML 表单通道兜底)；
        6. 后置落盘比对，确保修改真正生效。
        """
        task = self.get_task_detail(task_id)
        if not task:
            return False, f"未找到任务 #{task_id}"

        # 1. 尝试动态抓取页面真实表单项作为基础上下文
        form_data = self._get_task_edit_form_data(task_id)
        payload = dict(form_data) if form_data else {}

        # 2. 权威原值守护列表：这些业务字段若未在 update_fields 中指定，严禁被表单空值清空
        critical_fields = [
            'finishedBy', 'finishedDate',
            'assignedTo', 'status',
            'closedBy', 'closedDate', 'closedReason',
            'canceledBy', 'canceledDate',
            'pri', 'estimate', 'consumed', 'left',
            'estStarted', 'realStarted', 'deadline',
            'project', 'execution', 'module', 'type', 'story'
        ]

        for cf in critical_fields:
            if cf not in update_fields:
                task_val = task.get(cf)
                # 若权威原任务有值，但表单中缺失或被解析为 ''，强制复原为原值
                if task_val not in (None, ''):
                    payload[cf] = str(task_val)

        # 3. 对抄送给 (mailto) 的保护：
        # 若未明确修改抄送人，严禁在 POST 中携带 mailto/mailto[]，防止被表单解析值或标量覆盖误清空；
        # 禅道在 POST 中未包含 mailto 时会完整保留原有全部抄送人列表。
        if 'mailto' not in update_fields and 'mailto[]' not in update_fields:
            payload.pop('mailto', None)
            payload.pop('mailto[]', None)
        else:
            target_mailto = update_fields.get('mailto[]', update_fields.get('mailto'))
            if isinstance(target_mailto, str):
                target_mailto = [m.strip() for m in target_mailto.replace(';', ',').split(',') if m.strip()]
            payload.pop('mailto', None)
            payload['mailto[]'] = target_mailto or []

        # 4. 基础字段保障：name 与 desc
        # 任务名称 name 为禅道必填项，若未修改则保持原名；
        # 任务描述 desc：若未明确在 update_fields 中指定修改描述，严禁在 POST 中回传 desc！
        # 因为回传富文本描述会触发禅道富文本编辑器对图片标签等做格式转换，产生虚假的“修改了任务描述”历史记录。
        if 'name' not in update_fields:
            payload['name'] = str(task.get('name', payload.get('name', '')))

        if 'desc' not in update_fields:
            payload.pop('desc', None)
            payload.pop('labels[]', None)
            payload.pop('files[]', None)

        # 5. 覆盖待修改的目标字段
        for k, v in update_fields.items():
            if k not in ('mailto', 'mailto[]'):
                payload[k] = str(v)

        if comment:
            payload["comment"] = str(comment).strip()
        else:
            payload.pop("comment", None)

        # 4. 双通道智能提交：优先提交到 .json，若未生效则 fallback 到 .html 表单
        edit_json_url = f"{self.base_url}/task-edit-{task_id}.json"
        res = self._req('POST', edit_json_url, data=payload, timeout=12)
        data = self._parse_data(res)
        locate_url = str(data.get('locate', '')) if isinstance(data, dict) else ''

        # 权限拦截判断
        if "user-deny" in res.text or "user-deny" in locate_url:
            status_tip = "（该任务当前为【已关闭(closed)】归档状态）" if task.get('status') == 'closed' else ""
            return False, f"禅道权限不足：当前账号【{self.account}】未被系统授予【编辑任务】权限{status_tip}"

        # 业务报错提取 (如总计消耗校验等)
        if isinstance(data, dict) and data.get('result') == 'fail':
            msg = data.get('message') or '修改被拒绝'
            if isinstance(msg, dict):
                msg = "; ".join(f"{k}: {v}" for k, v in msg.items())
            return False, str(msg)

        # 5. 后置读取比对，验证是否真正成功落盘
        latest_task = self.get_task_detail(task_id) or {}
        check_passed = True
        failed_reason = ""

        if "project" in update_fields:
            if str(latest_task.get('project')) != str(update_fields['project']):
                check_passed = False
                failed_reason = f"禅道未保存项目变更(当前仍为项目#{latest_task.get('project')})"
        if "assignedTo" in update_fields:
            if str(latest_task.get('assignedTo')) != str(update_fields['assignedTo']):
                check_passed = False
                failed_reason = f"禅道未保存指派人变更(当前仍为{latest_task.get('assignedTo')})"
        if "finishedBy" in update_fields:
            if str(latest_task.get('finishedBy') or '').strip() != str(update_fields['finishedBy'] or '').strip():
                check_passed = False
                failed_reason = f"禅道未保存实际完成人变更(当前仍为{latest_task.get('finishedBy')})"
        if "name" in update_fields:
            if str(latest_task.get('name')) != str(update_fields['name']):
                check_passed = False
                failed_reason = "禅道未保存任务名称变更"

        # 若 .json 接口未能成功落盘，启用 HTML 表单通道进行重试提交
        if not check_passed:
            edit_html_url = f"{self.base_url}/task-edit-{task_id}.html"
            res_html = self.session.post(edit_html_url, data=payload, headers={'Referer': edit_html_url}, timeout=12)
            if "user-deny" in res_html.text:
                return False, f"禅道权限不足：当前账号【{self.account}】无权编辑此任务"
            # 重新读取比对
            latest_task = self.get_task_detail(task_id) or {}
            check_passed = True
            if "project" in update_fields and str(latest_task.get('project')) != str(update_fields['project']):
                check_passed = False
            if "assignedTo" in update_fields and str(latest_task.get('assignedTo')) != str(update_fields['assignedTo']):
                check_passed = False
            if "finishedBy" in update_fields and str(latest_task.get('finishedBy') or '').strip() != str(update_fields['finishedBy'] or '').strip():
                check_passed = False
            if "name" in update_fields and str(latest_task.get('name')) != str(update_fields['name']):
                check_passed = False

        if check_passed:
            return True, "修改成功"
        return False, failed_reason or "修改未生效，请检查任务状态与字段限制"

    def batch_auto_finish_my_tasks_stream(self, target_task_ids=None, interval_seconds=1.0, comment=""):
        """
        一键批量完成“我的未完成任务” (流式实时输出处理进度)
        """
        try:
            interval_val = float(interval_seconds) if interval_seconds is not None else 1.0
            if interval_val < 0:
                interval_val = 0.0
        except (ValueError, TypeError):
            interval_val = 1.0

        custom_comment = str(comment or '').strip()
        final_comment = custom_comment

        if target_task_ids:
            target_ids_set = {str(tid) for tid in target_task_ids}
            my_tasks = self.get_my_tasks(view_type="assignedTo", fetch_all=True)
            tasks_map = {str(t.get('id')): t for t in my_tasks}
            tasks_to_process = []
            for tid in target_task_ids:
                s_tid = str(tid)
                if s_tid in tasks_map:
                    tasks_to_process.append(tasks_map[s_tid])
                else:
                    t = self.get_task_detail(s_tid)
                    if t:
                        tasks_to_process.append(t)
        else:
            my_tasks = self.get_my_tasks(view_type="assignedTo", fetch_all=True)
            tasks_to_process = [t for t in my_tasks if t.get('status') in ['wait', 'doing', 'pause']]

        total = len(tasks_to_process)
        yield {
            "type": "start",
            "total": total,
            "message": f"准备开始批量处理 {total} 个任务..."
        }

        results = {
            "total": total,
            "success": [],
            "skipped": [],
            "failed": []
        }

        for idx, t in enumerate(tasks_to_process):
            t_id = str(t.get('id'))
            t_name = t.get('name', '')
            status = t.get('status', '')
            cur_num = idx + 1

            try:
                est_raw = t.get('estimate')
                try:
                    estimate_val = float(est_raw) if est_raw not in [None, ''] else 0.0
                except ValueError:
                    estimate_val = 0.0

                if estimate_val <= 0:
                    results["skipped"].append({
                        "id": t_id,
                        "name": t_name,
                        "reason": "缺少预计消耗时间(未填写或为0)"
                    })
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": t_id, "name": t_name},
                        "status": "skipped",
                        "message": f"任务#{t_id} 缺少预计工时已跳过"
                    }
                    continue

                if status == 'wait':
                    self.start_task(t_id, consumed=0, left=estimate_val)
                    if interval_val > 0:
                        time.sleep(interval_val)

                ok, msg = self.finish_task(
                    task_id=t_id,
                    current_consumed=estimate_val,
                    assigned_to=t.get('openedBy', self.account),
                    comment=final_comment
                )

                if ok:
                    results["success"].append({
                        "id": t_id,
                        "name": t_name,
                        "consumed": estimate_val
                    })
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": t_id, "name": t_name},
                        "status": "success",
                        "message": f"任务#{t_id} 流转并报工完成"
                    }
                else:
                    results["failed"].append({
                        "id": t_id,
                        "name": t_name,
                        "reason": msg
                    })
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": t_id, "name": t_name},
                        "status": "failed",
                        "message": f"任务#{t_id} 完成失败: {msg}"
                    }

                if interval_val > 0 and idx < total - 1:
                    time.sleep(interval_val)

            except Exception as e:
                results["failed"].append({
                    "id": t_id,
                    "name": t_name,
                    "reason": f"执行异常: {str(e)}"
                })
                yield {
                    "type": "progress",
                    "current": cur_num,
                    "total": total,
                    "task": {"id": t_id, "name": t_name},
                    "status": "failed",
                    "message": f"任务#{t_id} 执行异常: {str(e)}"
                }

        yield {
            "type": "done",
            "success": True,
            "data": results,
            "message": f"处理完成！成功 {len(results['success'])} 个，跳过 {len(results['skipped'])} 个，失败 {len(results['failed'])} 个"
        }

    def batch_auto_finish_my_tasks(self, target_task_ids=None, interval_seconds=1.0, comment=""):
        """一键批量完成“我的未完成任务” (兼容同步调用)"""
        last_res = None
        for ev in self.batch_auto_finish_my_tasks_stream(target_task_ids, interval_seconds, comment):
            if ev.get("type") == "done":
                last_res = ev.get("data")
        return last_res or {"total": 0, "success": [], "skipped": [], "failed": []}

    def batch_update_field_stream(self, task_ids, field, value, comment="", name_mode="direct", replace_from="", sync_desc=False):
        """
        根据配置化的字段名称批量修改 (流式实时输出处理进度)
        """
        actual_comment = str(comment or '').strip()
        total = len(task_ids)
        yield {
            "type": "start",
            "total": total,
            "message": f"准备修改 {total} 条任务..."
        }

        results = {
            "total": total,
            "modified_count": 0,
            "unmodified_count": 0,
            "modified": [],
            "unmodified": [],
            "unmodified_names": [],
            "success": [],
            "failed": []
        }

        for idx, tid in enumerate(task_ids):
            cur_num = idx + 1
            try:
                t = self.get_task_detail(tid)
                if not t:
                    err_item = {"id": tid, "name": f"任务#{tid}", "reason": "未找到任务"}
                    results["unmodified"].append(err_item)
                    results["failed"].append(err_item)
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": f"任务#{tid}"},
                        "status": "failed",
                        "message": f"任务#{tid} 不存在"
                    }
                    continue

                t_name = t.get('name', '')
                project_id = t.get('project', 0)
                ok = False
                msg = ""
                final_name = t_name

                # 特殊字段及无变更跳过处理
                if field == "name":
                    target_name = t_name
                    if name_mode == "prefix":
                        target_name = f"{value}{t_name}" if value else t_name
                    elif name_mode == "suffix":
                        target_name = f"{t_name}{value}" if value else t_name
                    elif name_mode == "replace":
                        from_kw = str(replace_from or '')
                        to_kw = "" if value is None else str(value)
                        target_name = t_name.replace(from_kw, to_kw) if from_kw else t_name
                    else:
                        target_name = str(value).strip()

                    if not target_name:
                        err_item = {"id": tid, "name": t_name, "reason": "新任务名称不能为空"}
                        results["unmodified"].append(err_item)
                        results["failed"].append(err_item)
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "failed",
                            "message": f"任务#{tid} 新名称不能为空"
                        }
                        continue

                    old_desc = str(t.get('desc', '') or '').strip()
                    name_changed = (target_name != t_name)
                    desc_changed = sync_desc and (old_desc != target_name)

                    if not name_changed and not desc_changed:
                        if name_mode == "replace" and str(replace_from) not in t_name:
                            reason = f"未包含待替换字符「{replace_from}」，未做修改"
                        else:
                            reason = "新旧名称一致，未做修改"
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": reason})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} {reason}"
                        }
                        continue

                    update_dict = {"name": target_name}
                    if sync_desc:
                        update_dict["desc"] = target_name

                    ok, msg = self.edit_task_fields(tid, update_dict, comment=actual_comment)
                    final_name = target_name
                elif field == "assignedTo":
                    target_assigned = str(value or '').strip()
                    if target_assigned and not target_assigned.isascii():
                        try:
                            for u in self.get_all_users():
                                if u.get('realname') == target_assigned:
                                    target_assigned = u.get('account')
                                    break
                        except Exception:
                            pass
                    old_assigned = str(t.get('assignedTo') or '').strip()
                    if old_assigned == target_assigned:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "指派人已是目标用户，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 指派人已是目标用户"
                        }
                        continue
                    ok, msg = self.assign_task(tid, assigned_to=target_assigned, project_id=project_id, comment=actual_comment)
                elif field == "finishedBy":
                    target_finished = str(value or '').strip()
                    # 若传入的是中文真实姓名，自动在用户列表中反查账号
                    if target_finished and not target_finished.isascii():
                        try:
                            for u in self.get_all_users():
                                if u.get('realname') == target_finished:
                                    target_finished = u.get('account')
                                    break
                        except Exception:
                            pass
                    old_finished = str(t.get('finishedBy') or '').strip()
                    if old_finished == target_finished:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "实际完成人已是目标用户，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 实际完成人已是目标用户"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {"finishedBy": target_finished}, comment=actual_comment)
                elif field == "status" and value == "doing":
                    old_status = str(t.get('status') or '').strip()
                    if old_status == "doing":
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "状态已为进行中，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 状态已为进行中"
                        }
                        continue
                    ok = self.start_task(tid)
                    msg = "启动成功" if ok else "启动失败"
                elif field == "status" and value == "done":
                    old_status = str(t.get('status') or '').strip()
                    if old_status == "done":
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "状态已为已完成，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 状态已为已完成"
                        }
                        continue
                    est = float(t.get('estimate') or 1.0)
                    ok, msg = self.finish_task(tid, current_consumed=est, comment=actual_comment)
                elif field == "status" and value == "closed":
                    old_status = str(t.get('status') or '').strip()
                    if old_status == "closed":
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "状态已为已关闭，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 状态已为已关闭"
                        }
                        continue
                    ok, msg = self.assign_task(tid, assigned_to="closed", project_id=project_id, comment=actual_comment)
                elif field == "project":
                    old_proj = str(t.get('project') or '').strip()
                    target_proj = str(value or '').strip()
                    if old_proj == target_proj:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "所属项目未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 所属项目未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value}, comment=actual_comment)
                elif field == "execution":
                    old_exec = str(t.get('execution') or '').strip()
                    target_exec = str(value or '').strip()
                    if old_exec == target_exec:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "所属迭代未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 所属迭代未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value}, comment=actual_comment)
                elif field == "pri":
                    old_pri = str(t.get('pri') or '').strip()
                    target_pri = str(value or '').strip()
                    if old_pri == target_pri:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "优先级未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 优先级未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value}, comment=actual_comment)
                elif field == "estimate":
                    old_est = str(t.get('estimate') or '').strip()
                    target_est = str(value or '').strip()
                    try:
                        is_same = (float(old_est) == float(target_est))
                    except Exception:
                        is_same = (old_est == target_est)
                    if is_same:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "预计工时未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 预计工时未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value}, comment=actual_comment)
                elif field == "deadline":
                    old_ddl = str(t.get('deadline') or '').strip()
                    target_ddl = str(value or '').strip()
                    if old_ddl == target_ddl:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "截止日期未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 截止日期未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value}, comment=actual_comment)
                else:
                    old_val = str(t.get(field) or '').strip()
                    target_val = str(value or '').strip()
                    if old_val == target_val:
                        results["unmodified"].append({"id": tid, "name": t_name, "reason": "字段值未变动，未做修改"})
                        yield {
                            "type": "progress",
                            "current": cur_num,
                            "total": total,
                            "task": {"id": tid, "name": t_name},
                            "status": "skipped",
                            "message": f"任务#{tid} 字段值未变动"
                        }
                        continue
                    ok, msg = self.edit_task_fields(tid, {field: value})

                if ok:
                    results["modified"].append({"id": tid, "name": final_name})
                    results["success"].append({"id": tid, "name": final_name})
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": final_name},
                        "status": "success",
                        "message": f"任务#{tid} 修改成功"
                    }
                else:
                    results["unmodified"].append({"id": tid, "name": t_name, "reason": f"修改失败: {msg}"})
                    results["failed"].append({"id": tid, "name": t_name, "reason": msg})
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": t_name},
                        "status": "failed",
                        "message": f"任务#{tid} 未修改: {msg}"
                    }
            except Exception as e:
                results["unmodified"].append({"id": tid, "name": f"任务#{tid}", "reason": f"执行异常: {str(e)}"})
                results["failed"].append({"id": tid, "name": f"任务#{tid}", "reason": str(e)})
                yield {
                    "type": "progress",
                    "current": cur_num,
                    "total": total,
                    "task": {"id": tid, "name": f"任务#{tid}"},
                    "status": "failed",
                    "message": f"任务#{tid} 异常: {str(e)}"
                }

        results["modified_count"] = len(results["modified"])
        results["unmodified_count"] = len(results["unmodified"])
        results["unmodified_names"] = [item["name"] for item in results["unmodified"]]

        yield {
            "type": "done",
            "success": True,
            "data": results,
            "modified_count": results["modified_count"],
            "unmodified_count": results["unmodified_count"],
            "unmodified_names": results["unmodified_names"],
            "message": f"修改完成！实际修改 {results['modified_count']} 条，未修改 {results['unmodified_count']} 条"
        }

    def batch_update_field(self, task_ids, field, value, comment="", name_mode="direct", replace_from="", sync_desc=False):
        """根据配置化的字段名称批量修改 (兼容同步调用)"""
        last_res = None
        for ev in self.batch_update_field_stream(task_ids, field, value, comment, name_mode, replace_from, sync_desc):
            if ev.get("type") == "done":
                last_res = ev.get("data")
        return last_res or {
            "total": len(task_ids),
            "modified_count": 0,
            "unmodified_count": 0,
            "modified": [],
            "unmodified": [],
            "unmodified_names": [],
            "success": [],
            "failed": []
        }

    def batch_rename_tasks_stream(self, task_list, sync_desc=False, comment="批量重命名任务"):
        """
        批量个性化修改任务名称 (流式实时输出处理进度)
        """
        total = len(task_list)
        yield {
            "type": "start",
            "total": total,
            "message": f"准备批量重命名 {total} 条任务..."
        }

        results = {
            "total": total,
            "modified_count": 0,
            "unmodified_count": 0,
            "modified": [],
            "unmodified": [],
            "unmodified_names": [],
            "success": [],
            "failed": []
        }
        for idx, item in enumerate(task_list):
            cur_num = idx + 1
            tid = item.get('id')
            new_name = str(item.get('name', '')).strip()
            if not tid or not new_name:
                err_item = {"id": tid, "name": f"任务#{tid}", "reason": "任务ID或新名称为空"}
                results["unmodified"].append(err_item)
                results["failed"].append(err_item)
                yield {
                    "type": "progress",
                    "current": cur_num,
                    "total": total,
                    "task": {"id": tid, "name": f"任务#{tid}"},
                    "status": "failed",
                    "message": f"任务#{tid} ID或新名称为空"
                }
                continue
            try:
                t = self.get_task_detail(tid)
                if not t:
                    err_item = {"id": tid, "name": f"任务#{tid}", "reason": "未找到任务"}
                    results["unmodified"].append(err_item)
                    results["failed"].append(err_item)
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": f"任务#{tid}"},
                        "status": "failed",
                        "message": f"任务#{tid} 不存在"
                    }
                    continue

                old_name = str(t.get('name', '')).strip()
                old_desc = str(t.get('desc', '') or '').strip()

                name_changed = (old_name != new_name)
                desc_changed = sync_desc and (old_desc != new_name)

                if not name_changed and not desc_changed:
                    results["unmodified"].append({
                        "id": tid,
                        "name": old_name,
                        "reason": "新旧名称一致，未做修改"
                    })
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": old_name},
                        "status": "skipped",
                        "message": f"任务#{tid} 新旧名称一致"
                    }
                    continue

                update_dict = {"name": new_name}
                if sync_desc:
                    update_dict["desc"] = new_name
                ok, msg = self.edit_task_fields(tid, update_dict)
                if ok:
                    results["modified"].append({"id": tid, "name": new_name})
                    results["success"].append({"id": tid, "name": new_name})
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": new_name},
                        "status": "success",
                        "message": f"任务#{tid} 重命名成功"
                    }
                else:
                    results["unmodified"].append({"id": tid, "name": old_name, "reason": f"修改失败: {msg}"})
                    results["failed"].append({"id": tid, "name": old_name, "reason": msg})
                    yield {
                        "type": "progress",
                        "current": cur_num,
                        "total": total,
                        "task": {"id": tid, "name": old_name},
                        "status": "failed",
                        "message": f"任务#{tid} 重命名失败: {msg}"
                    }
            except Exception as e:
                results["unmodified"].append({"id": tid, "name": f"任务#{tid}", "reason": f"执行异常: {str(e)}"})
                results["failed"].append({"id": tid, "name": f"任务#{tid}", "reason": str(e)})
                yield {
                    "type": "progress",
                    "current": cur_num,
                    "total": total,
                    "task": {"id": tid, "name": f"任务#{tid}"},
                    "status": "failed",
                    "message": f"任务#{tid} 异常: {str(e)}"
                }

        results["modified_count"] = len(results["modified"])
        results["unmodified_count"] = len(results["unmodified"])
        results["unmodified_names"] = [item["name"] for item in results["unmodified"]]

        yield {
            "type": "done",
            "success": True,
            "data": results,
            "modified_count": results["modified_count"],
            "unmodified_count": results["unmodified_count"],
            "unmodified_names": results["unmodified_names"],
            "message": f"修改完成！实际修改 {results['modified_count']} 条，未修改 {results['unmodified_count']} 条"
        }

    def batch_rename_tasks(self, task_list, sync_desc=False, comment="批量重命名任务"):
        """批量个性化修改任务名称 (兼容同步调用)"""
        last_res = None
        for ev in self.batch_rename_tasks_stream(task_list, sync_desc, comment):
            if ev.get("type") == "done":
                last_res = ev.get("data")
        return last_res or {
            "total": len(task_list),
            "modified_count": 0,
            "unmodified_count": 0,
            "modified": [],
            "unmodified": [],
            "unmodified_names": [],
            "success": [],
            "failed": []
        }

