# -*- coding: utf-8 -*-
"""
禅道自动化 Web 控制台服务端 (ZenTao Automation Web Console Server)
基于 Flask 提供轻量高效的 RESTful API 与前端单页托管。
"""

import os
import sys
import re
import uuid
import io
import json
import time
import threading
import concurrent.futures
from datetime import timedelta, datetime
import urllib.parse
from flask import Flask, render_template, request, jsonify, session, send_file, send_from_directory, Response, stream_with_context
from zentao_client import ZentaoClient
from weekly_report import generate_weekly_report_data, export_weekly_report_excel
from ai_agent import chat_with_deepseek_agent, DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL
from ai_document import DOCS_DIR, markdown_to_docx, sanitize_filename

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.environ.get('SECRET_KEY', 'zentao-studio-multiuser-isolated-secret-2026')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

# 默认禅道系统访问地址 (仅作为输入框默认提示地址，不存储任何默认账号)
DEFAULT_ZENTAO_URL = os.environ.get('ZENTAO_URL', 'https://bkgtsoft.chandao.com')

# 多用户独立客户端连接池：{ session_id: { 'client': ZentaoClient实例, 'last_seen': timestamp, 'account': str } }
_clients_pool = {}
_clients_lock = threading.Lock()

def get_session_id():
    """获取或分配当前浏览器专属的唯一 Session ID"""
    session.permanent = True
    sid = session.get('session_id')
    if not sid:
        sid = uuid.uuid4().hex
        session['session_id'] = sid
    return sid

def cleanup_stale_clients(max_idle_seconds=86400 * 7):
    """清理长期未活跃的客户端实例（如 7 天以上无请求）以释放系统资源"""
    now = time.time()
    with _clients_lock:
        stale_sids = [sid for sid, item in _clients_pool.items() if now - item.get('last_seen', now) > max_idle_seconds]
        for sid in stale_sids:
            try:
                _clients_pool[sid]['client'].session.close()
            except Exception:
                pass
            _clients_pool.pop(sid, None)

def get_client():
    """
    获取当前用户专属的 ZentaoClient 实例。
    每个浏览器 Session 完全隔离，拥有专属的 Cookie、Token 与会话，绝不相互挤占。
    不使用任何默认账号，未登录时严格返回未登录提示。
    """
    sid = get_session_id()

    # 1. 检查当前会话是否主动退出了登录
    if session.get('is_logged_out', False):
        return None, "您已退出登录，请重新登录"

    now = time.time()

    # 2. 从多用户池中检索当前 Session 的客户端实例
    with _clients_lock:
        if sid in _clients_pool:
            item = _clients_pool[sid]
            item['last_seen'] = now
            return item['client'], None

    # 3. 检查当前用户的 Session 中是否保存了该用户专属的凭据 (用户自身勾选记住登录后保存在加密 Cookie 中)
    saved_creds = session.get('zentao_creds')
    if saved_creds and isinstance(saved_creds, dict):
        try:
            client = ZentaoClient(
                base_url=saved_creds['url'],
                account=saved_creds['account'],
                password=saved_creds['password']
            )
            with _clients_lock:
                _clients_pool[sid] = {'client': client, 'last_seen': now, 'account': client.account}
            return client, None
        except Exception as e:
            session.pop('zentao_creds', None)
            return None, f"登录凭据已失效: {str(e)}"

    # 严格返回未登录，绝不默认加载任何人的账号
    return None, "尚未登录，请先登录禅道账号"


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/status', methods=['GET'])
def api_status():
    """获取当前用户专属连接状态与登录信息 (绝不默认展示他人账号)"""
    client, err = get_client()
    if err or not client:
        return jsonify({
            "connected": False,
            "error": err or "未登录",
            "default_url": DEFAULT_ZENTAO_URL
        }), 200

    return jsonify({
        "connected": True,
        "account": client.account,
        "realname": client.realname,
        "base_url": client.base_url,
        "default_url": DEFAULT_ZENTAO_URL
    })


@app.route('/api/login', methods=['POST'])
def api_login():
    """
    用户登录 / 切换账号：
    仅更新当前浏览器会话的 ZentaoClient 实例，绝不影响其他在线同事的会话。
    """
    sid = get_session_id()
    data = request.get_json() or {}
    url = (data.get('url') or '').strip().rstrip('/')
    account = (data.get('account') or '').strip()
    password = (data.get('password') or '').strip()
    remember = data.get('remember', False)

    if not url or not account or not password:
        return jsonify({"success": False, "message": "禅道地址、账号和密码均不能为空"}), 400

    try:
        new_client = ZentaoClient(base_url=url, account=account, password=password)

        # 仅将新客户端绑定到当前 session_id，关闭原有旧连接
        with _clients_lock:
            old_item = _clients_pool.pop(sid, None)
            if old_item and 'client' in old_item:
                try:
                    old_item['client'].session.close()
                except Exception:
                    pass
            _clients_pool[sid] = {
                'client': new_client,
                'last_seen': time.time(),
                'account': new_client.account
            }

        # 更新当前 Session 的独立状态
        session['is_logged_out'] = False
        session['account'] = account
        if remember:
            session['zentao_creds'] = {
                'url': url,
                'account': account,
                'password': password
            }
        else:
            session.pop('zentao_creds', None)

        cleanup_stale_clients()

        return jsonify({
            "success": True,
            "realname": new_client.realname,
            "account": new_client.account,
            "base_url": new_client.base_url
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route('/api/logout', methods=['POST'])
def api_logout():
    """仅退出当前浏览器的登录账号，其他用户不受任何影响"""
    sid = get_session_id()
    with _clients_lock:
        old_item = _clients_pool.pop(sid, None)
        if old_item and 'client' in old_item:
            try:
                old_item['client'].session.close()
            except Exception:
                pass

    session['is_logged_out'] = True
    session.pop('zentao_creds', None)
    return jsonify({"success": True, "message": "已成功退出当前登录"})


@app.route('/api/projects', methods=['GET'])
def api_projects():
    """获取所有项目列表供前端下拉选择"""
    client, err = get_client()
    if err or not client:
        return jsonify({"success": False, "message": err or "请先登录"}), 400
    try:
        projs = client.get_all_projects()
        return jsonify({"success": True, "projects": projs, "total": len(projs)})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/users', methods=['GET'])
def api_users():
    """获取所有用户列表供前端搜索与下拉选择"""
    client, err = get_client()
    if err or not client:
        return jsonify({"success": False, "message": err or "请先登录"}), 400
    try:
        users = client.get_all_users()
        return jsonify({"success": True, "users": users, "total": len(users)})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/my-active-tasks', methods=['GET'])
def api_my_active_tasks():
    """获取当前用户指派给我的未完成任务 (用于模块1)"""
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400
    try:
        tasks = client.get_my_tasks(view_type="assignedTo", fetch_all=True)
        active = [t for t in tasks if t.get('status') in ['wait', 'doing', 'pause']]
        return jsonify({"success": True, "tasks": active, "total": len(active)})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/batch-finish', methods=['POST'])
def api_batch_finish():
    """
    模块 1 核心接口：
    一键将未完成任务先切为进行中，再塞入预计消耗时间点击已完成；
    若没有预计消耗时间则跳过该任务，执行完毕后统一返回统计与明细。
    """
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    data = request.get_json() or {}
    target_ids = data.get('task_ids') # 可选，若为空则处理全部未完成任务
    try:
        interval_seconds = float(data.get('interval_seconds', 1.0))
        if interval_seconds < 0:
            interval_seconds = 0.0
    except (TypeError, ValueError):
        interval_seconds = 1.0
    comment = str(data.get('comment') or '').strip()

    # 如果请求要求流式进度 (默认启用)
    if data.get('stream', True):
        def generate():
            try:
                for event in client.batch_auto_finish_my_tasks_stream(
                    target_task_ids=target_ids,
                    interval_seconds=interval_seconds,
                    comment=comment
                ):
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as e:
                yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"

        return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        })

    try:
        results = client.batch_auto_finish_my_tasks(
            target_task_ids=target_ids,
            interval_seconds=interval_seconds,
            comment=comment
        )
        return jsonify({
            "success": True,
            "data": results,
            "message": f"处理完成！成功 {len(results['success'])} 个，跳过 {len(results['skipped'])} 个，失败 {len(results['failed'])} 个"
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/tasks/query', methods=['POST'])
def api_query_tasks():
    """模块 2 核心接口：自定义多条件查询任务"""
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    params = request.get_json() or {}
    view_type = params.get('view_type', 'assignedTo') # assignedTo, openedBy, finishedBy, closedBy, all
    target_account = (params.get('target_account') or '').strip()
    target_realname = (params.get('target_realname') or '').strip()
    project_id = params.get('project_id')
    project_ids_raw = params.get('project_ids')
    target_project_ids = set()
    if isinstance(project_ids_raw, list):
        for pid in project_ids_raw:
            if str(pid).strip():
                target_project_ids.add(str(pid).strip())
    elif project_ids_raw:
        for pid in str(project_ids_raw).split(','):
            if pid.strip():
                target_project_ids.add(pid.strip())
    if project_id and str(project_id).strip():
        target_project_ids.add(str(project_id).strip())

    execution_id = params.get('execution_id')
    status_filter = params.get('status') # wait, doing, done, closed 等
    year_filter = params.get('year') # 2026 等
    unassigned_only = params.get('unassigned_only', False)
    keyword = params.get('keyword', '').strip().lower()

    current_acc = str(getattr(client, 'account', '') or '').strip()
    current_realname = str(getattr(client, 'realname', '') or current_acc).strip()

    # 支持目标用户多选
    target_accounts_raw = params.get('target_accounts') or []
    target_accounts = []
    if isinstance(target_accounts_raw, list):
        for acc in target_accounts_raw:
            if str(acc).strip():
                target_accounts.append(str(acc).strip())
    elif target_accounts_raw:
        for acc in str(target_accounts_raw).split(','):
            if acc.strip():
                target_accounts.append(acc.strip())

    target_account = (params.get('target_account') or '').strip()
    if not target_accounts:
        if target_account:
            target_accounts.append(target_account)
        elif current_acc:
            target_accounts.append(current_acc)

    effective_account = target_accounts[0] if target_accounts else current_acc

    # 建立多选用户的账号与真实姓名映射
    account_to_realname = {}
    for acc in target_accounts:
        if acc.lower() == current_acc.lower():
            account_to_realname[acc.lower()] = current_realname
        else:
            account_to_realname[acc.lower()] = ""

    target_realnames_raw = params.get('target_realnames') or []
    if isinstance(target_realnames_raw, list):
        for idx, rname in enumerate(target_realnames_raw):
            if idx < len(target_accounts) and rname:
                account_to_realname[target_accounts[idx].lower()] = str(rname).strip()

    # 若未全部解析出真实姓名，从用户列表补充
    if any(not r for r in account_to_realname.values()):
        try:
            for u in client.get_all_users():
                u_acc = str(u.get('account', '')).strip().lower()
                if u_acc in account_to_realname and not account_to_realname[u_acc]:
                    account_to_realname[u_acc] = str(u.get('realname', '')).strip()
        except Exception:
            pass

    target_accounts_set = {acc.lower() for acc in target_accounts}
    target_realnames_set = {r for r in account_to_realname.values() if r}

    try:
        if target_accounts:
            tasks = []
            seen_raw_tids = set()

            def fetch_single_user_tasks(acc):
                try:
                    return acc, client.get_user_tasks(account=acc, view_type=view_type, fetch_all=True)
                except Exception as e:
                    app.logger.warning(f"Failed to fetch tasks for user {acc}: {e}")
                    return acc, []

            workers = min(8, len(target_accounts))
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_single_user_tasks, target_accounts))

            for acc, u_tasks in results:
                for ut in u_tasks:
                    ut_id = str(ut.get('id', '')).strip()
                    if ut_id and ut_id not in seen_raw_tids:
                        seen_raw_tids.add(ut_id)
                        tasks.append(ut)
        elif execution_id:
            tasks = client.get_execution_tasks(int(execution_id))
        else:
            tasks = client.get_user_tasks(account=effective_account, view_type=view_type, fetch_all=True)

        # 2. 条件过滤
        def is_match_user(val, realname_val=None):
            if not val and not realname_val:
                return False
            # 1. 忽略大小写比对英文账号
            if val and str(val).strip().lower() in target_accounts_set:
                return True
            # 2. 比对中文真实姓名
            if val and str(val).strip() in target_realnames_set:
                return True
            if realname_val and str(realname_val).strip() in target_realnames_set:
                return True
            return False

        matched = []
        seen_ids = set()
        for t in tasks:
            tid = str(t.get('id', '')).strip()
            if tid and tid in seen_ids:
                continue

            # 所属项目多选过滤
            if target_project_ids:
                p_val = str(t.get('project') or '').strip()
                if p_val not in target_project_ids:
                    continue

            # 任务归属范围过滤 (按指定用户进行过滤)
            if view_type == 'finishedBy' and not is_match_user(t.get('finishedBy'), t.get('finishedByRealname')):
                continue
            elif view_type == 'assignedTo' and not is_match_user(t.get('assignedTo'), t.get('assignedToRealname')):
                continue
            elif view_type == 'openedBy' and not is_match_user(t.get('openedBy'), t.get('openedByRealname')):
                continue
            elif view_type == 'closedBy' and not is_match_user(t.get('closedBy'), t.get('closedByRealname')):
                continue
            elif view_type == 'all' and not (
                is_match_user(t.get('assignedTo'), t.get('assignedToRealname')) or
                is_match_user(t.get('finishedBy'), t.get('finishedByRealname')) or
                is_match_user(t.get('openedBy'), t.get('openedByRealname')) or
                is_match_user(t.get('closedBy'), t.get('closedByRealname'))
            ):
                continue

            # 状态过滤
            if status_filter and status_filter != 'all' and t.get('status') != status_filter:
                continue

            # 年份过滤 (智能匹配任务的预计开始、创建日期或实际完成日期)
            if year_filter:
                y_str = str(year_filter).strip()
                est = str(t.get('estStarted') or '')
                opened = str(t.get('openedDate') or '')
                finished = str(t.get('finishedDate') or '')
                # 如果任务没有任何日期信息，或者所有日期均不以该年份开头，则跳过
                dates_str = f"{est} {opened} {finished}".strip()
                if y_str not in dates_str:
                    continue

            # 未指派过滤
            if unassigned_only:
                assigned = t.get('assignedTo')
                if assigned != '' and assigned is not None and assigned != 'closed':
                    continue

            # 关键词过滤 (支持按任务ID或名称模糊搜索)
            if keyword:
                tname = str(t.get('name', '')).lower()
                if keyword not in tid and keyword not in tname:
                    continue

            if tid:
                seen_ids.add(tid)
            matched.append(t)

        return jsonify({
            "success": True,
            "tasks": matched,
            "total": len(matched)
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/project-tasks/query', methods=['POST'])
def api_query_project_tasks():
    """
    独立功能模块：直接根据项目分类，查询所选项目底下的所有任务 (包含所有人员的全量任务)
    """
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    params = request.get_json() or {}
    project_id = params.get('project_id')
    project_ids_raw = params.get('project_ids')
    target_project_ids = []
    if isinstance(project_ids_raw, list):
        for pid in project_ids_raw:
            if str(pid).strip() and str(pid).strip() not in target_project_ids:
                target_project_ids.append(str(pid).strip())
    elif project_ids_raw:
        for pid in str(project_ids_raw).split(','):
            if pid.strip() and pid.strip() not in target_project_ids:
                target_project_ids.append(pid.strip())
    if project_id and str(project_id).strip() and str(project_id).strip() not in target_project_ids:
        target_project_ids.append(str(project_id).strip())

    if not target_project_ids:
        return jsonify({"success": False, "message": "请至少选择一个所属项目进行查询！"}), 400

    status_filter = params.get('status') # wait, doing, done, closed 等
    year_filter = params.get('year') # 2026 等
    keyword = params.get('keyword', '').strip().lower()

    # 完成人过滤 (支持多选)
    finished_by_raw = params.get('finished_by') or params.get('finished_by_list') or []
    target_finished_by = []
    if isinstance(finished_by_raw, list):
        for u in finished_by_raw:
            u_clean = str(u).strip().lower()
            if u_clean and u_clean not in target_finished_by:
                target_finished_by.append(u_clean)
    elif finished_by_raw:
        for u in str(finished_by_raw).split(','):
            u_clean = u.strip().lower()
            if u_clean and u_clean not in target_finished_by:
                target_finished_by.append(u_clean)

    try:
        # 获取项目映射字典
        proj_map = {}
        try:
            for p in client.get_all_projects():
                p_id = str(p.get('id', '')).strip()
                p_name = p.get('name', '').strip()
                if p_id:
                    proj_map[p_id] = p_name
        except Exception as p_e:
            app.logger.warning(f"Failed to get_all_projects: {p_e}")

        tasks = []
        seen_tids = set()

        def fetch_single_project_tasks(pid):
            try:
                return pid, client.get_project_tasks(int(pid), fetch_all=True)
            except Exception as pe:
                app.logger.warning(f"Failed to get tasks for project {pid}: {pe}")
                return pid, []

        workers = min(8, len(target_project_ids))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            p_results = list(executor.map(fetch_single_project_tasks, target_project_ids))

        for pid, p_tasks in p_results:
            for pt in p_tasks:
                pt_id = str(pt.get('id', '')).strip()
                if pt_id and pt_id not in seen_tids:
                    seen_tids.add(pt_id)
                    tasks.append(pt)

        matched = []
        for t in tasks:
            # 状态过滤
            if status_filter and status_filter != 'all' and t.get('status') != status_filter:
                continue

            # 完成人过滤 (可多选，选中的任意一人匹配即可)
            if target_finished_by:
                t_finished = str(t.get('finishedBy') or '').strip().lower()
                if not t_finished or t_finished not in target_finished_by:
                    continue

            # 预计开始年份过滤：要求预计开始时间字段 (estStarted) 需要大于等于设置年份的1月1号 (如 >= 2026-01-01)
            if year_filter:
                y_str = str(year_filter).strip()
                if y_str:
                    year_match = re.search(r'\d{4}', y_str)
                    target_year = year_match.group(0) if year_match else y_str
                    threshold_date = f"{target_year}-01-01"

                    est = str(t.get('estStarted') or '').strip()
                    if not est or est.startswith('0000'):
                        continue
                    est_date = est[:10]
                    if est_date < threshold_date:
                        continue

            # 关键字过滤 (支持匹配 ID、任务名称)
            if keyword:
                tid = str(t.get('id', '')).lower()
                tname = str(t.get('name', '')).lower()
                if keyword not in tid and keyword not in tname:
                    continue

            # 补充项目中文名与人员中文名
            pid_str = str(t.get('project') or '')
            projectName = proj_map.get(pid_str, f"[{pid_str}]" if pid_str else "")
            assignedTo = t.get('assignedTo', '')
            assignedToRealname = t.get('assignedToRealname', '') or assignedTo
            finishedBy = t.get('finishedBy', '')
            finishedByRealname = t.get('finishedByRealname', '') or finishedBy
            openedBy = t.get('openedBy', '')
            openedByRealname = t.get('openedByRealname', '') or openedBy

            t['projectName'] = projectName
            t['assignedToRealname'] = assignedToRealname
            t['finishedByRealname'] = finishedByRealname
            t['openedByRealname'] = openedByRealname

            matched.append(t)

        return jsonify({
            "success": True,
            "tasks": matched,
            "total": len(matched),
            "project_ids": target_project_ids
        })
    except Exception as e:
        app.logger.error(f"api_query_project_tasks error: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/tasks/batch-update', methods=['POST'])
def api_batch_update():
    """
    模块 2 核心接口：
    根据配置化下拉选择的字段，一键批量修改选中的任务。
    """
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    data = request.get_json() or {}
    task_ids = data.get('task_ids', [])
    field = data.get('field') # name, assignedTo, status, project, execution, estimate, pri, deadline 等
    value = data.get('value')
    comment = str(data.get('comment') or '').strip()
    name_mode = data.get('name_mode', 'direct') # direct, prefix, suffix, replace
    replace_from = data.get('replace_from', '')
    sync_desc = bool(data.get('sync_desc', False)) # 是否将任务描述同步改成任务名称

    if not task_ids:
        return jsonify({"success": False, "message": "请先勾选需要修改的任务"}), 400
    if not field:
        return jsonify({"success": False, "message": "请选择需要修改的字段"}), 400

    if data.get('stream', True):
        def generate():
            try:
                for event in client.batch_update_field_stream(
                    task_ids=task_ids,
                    field=field,
                    value=value,
                    comment=comment,
                    name_mode=name_mode,
                    replace_from=replace_from,
                    sync_desc=sync_desc
                ):
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as e:
                yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"

        return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        })

    try:
        results = client.batch_update_field(
            task_ids=task_ids,
            field=field,
            value=value,
            comment=comment,
            name_mode=name_mode,
            replace_from=replace_from,
            sync_desc=sync_desc
        )
        return jsonify({
            "success": True,
            "data": results,
            "modified_count": results["modified_count"],
            "unmodified_count": results["unmodified_count"],
            "unmodified_names": results["unmodified_names"],
            "message": f"批量修改完成：实际修改 {results['modified_count']} 条，未修改 {results['unmodified_count']} 条"
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/tasks/batch-rename', methods=['POST'])
def api_batch_rename():
    """
    行内直接修改：
    支持批量提交多个任务自定义的新名称。
    """
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    data = request.get_json() or {}
    task_list = data.get('tasks', []) # [{"id": 123, "name": "新名称"}, ...]
    sync_desc = bool(data.get('sync_desc', False)) # 是否将任务描述同步改成任务名称
    if not task_list:
        return jsonify({"success": False, "message": "待提交的任务修改列表为空"}), 400

    if data.get('stream', True):
        def generate():
            try:
                for event in client.batch_rename_tasks_stream(task_list=task_list, sync_desc=sync_desc):
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as e:
                yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"

        return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        })

    try:
        results = client.batch_rename_tasks(task_list=task_list, sync_desc=sync_desc)
        return jsonify({
            "success": True,
            "data": results,
            "modified_count": results["modified_count"],
            "unmodified_count": results["unmodified_count"],
            "unmodified_names": results["unmodified_names"],
            "message": f"批量修改完成：实际修改 {results['modified_count']} 条，未修改 {results['unmodified_count']} 条"
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/weekly-report/generate', methods=['POST'])
def api_generate_weekly_report():
    """
    根据本周登录人完成的任务生成对应的结构化周报数据
    """
    client, err = get_client()
    if err:
        return jsonify({"success": False, "message": err}), 400

    data = request.get_json() or {}
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    reporter = data.get('reporter')
    department = data.get('department', '应用组')

    try:
        report_data = generate_weekly_report_data(
            client=client,
            start_date=start_date,
            end_date=end_date,
            reporter=reporter,
            department=department
        )
        return jsonify({
            "success": True,
            "data": report_data,
            "message": "周报生成成功！"
        })
    except Exception as e:
        return jsonify({"success": False, "message": f"生成周报异常: {str(e)}"}), 500


@app.route('/api/weekly-report/export', methods=['POST'])
def api_export_weekly_report():
    """
    导出周报 Excel 文件 (.xlsx)
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"success": False, "message": "导出的周报内容不能为空"}), 400

    try:
        reporter = str(data.get('reporter') or '周报').strip()
        report_date = str(data.get('report_date') or '').replace('-', '')
        excel_stream = export_weekly_report_excel(data)

        filename = f"应用组工作周报_{reporter}_{report_date}.xlsx" if report_date else f"应用组工作周报_{reporter}.xlsx"
        encoded_filename = urllib.parse.quote(filename)

        response = send_file(
            excel_stream,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename
        )
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        return response
    except Exception as e:
        return jsonify({"success": False, "message": f"导出周报异常: {str(e)}"}), 500


# ==================== 模块 4：AI Agent 桌宠智能对话 ====================

@app.route('/api/ai/chat', methods=['POST'])
def api_ai_chat():
    """
    AI Agent 交互入口：与 DeepSeek 模型进行多轮交互并触发禅道工具执行
    """
    data = request.get_json() or {}
    messages = data.get('messages') or []
    api_key = data.get('api_key') or session.get('deepseek_api_key') or os.environ.get('DEEPSEEK_API_KEY')
    model = data.get('model') or DEFAULT_DEEPSEEK_MODEL
    base_url = data.get('base_url') or DEFAULT_DEEPSEEK_BASE_URL

    if not messages:
        return jsonify({"success": False, "message": "消息内容不能为空"}), 400

    # 允许未登录状态下进行普通对话，若执行禅道工具时再提示未登录
    client, _ = get_client()

    try:
        agent_res = chat_with_deepseek_agent(
            messages=messages,
            client=client,
            api_key=api_key,
            base_url=base_url,
            model=model
        )
        return jsonify(agent_res)
    except Exception as e:
        return jsonify({"success": False, "message": f"AI 对话处理异常: {str(e)}"}), 500


@app.route('/api/ai/test-key', methods=['POST'])
def api_ai_test_key():
    """
    验证 DeepSeek API Key 有效性
    """
    data = request.get_json() or {}
    api_key = data.get('api_key') or os.environ.get('DEEPSEEK_API_KEY', '').strip()
    base_url = data.get('base_url') or DEFAULT_DEEPSEEK_BASE_URL

    if not api_key:
        return jsonify({"success": False, "message": "API Key 不能为空"}), 400

    import requests
    url = base_url.rstrip('/') + "/models"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
        if resp.status_code == 200:
            # 记住在当前 session
            session['deepseek_api_key'] = api_key
            return jsonify({"success": True, "message": "DeepSeek API Key 验证成功！连接正常。"})
        else:
            return jsonify({"success": False, "message": f"Key 验证失败 (状态码 {resp.status_code}): {resp.text}"}), 400
    except Exception as e:
        return jsonify({"success": False, "message": f"连接 DeepSeek 服务超时或异常: {str(e)}"}), 500


@app.route('/api/ai/download-doc/<filename>', methods=['GET'])
def api_ai_download_doc(filename):
    """
    下载由 AI 生成并保存在本地的文档文件
    """
    safe_filename = os.path.basename(filename)
    filepath = os.path.join(DOCS_DIR, safe_filename)
    if not os.path.exists(filepath):
        return jsonify({"success": False, "message": "请求的文档不存在或已被清理"}), 404

    encoded_name = urllib.parse.quote(safe_filename.encode('utf-8'))
    response = send_from_directory(
        DOCS_DIR,
        safe_filename,
        as_attachment=True,
        download_name=safe_filename
    )
    response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_name}"
    return response


@app.route('/api/ai/export-content', methods=['POST'])
def api_ai_export_content():
    """
    直接将传入的 Markdown 内容实时转换并下载为 Word (.docx) 或 Markdown (.md)
    """
    data = request.get_json() or {}
    title = (data.get('title') or '小禅AI生成文档').strip()
    content = data.get('content') or ''
    doc_format = (data.get('format') or 'docx').lower()

    if not content:
        return jsonify({"success": False, "message": "导出的文档内容不能为空"}), 400

    client, _ = get_client()
    author = getattr(client, 'realname', '') or getattr(client, 'account', '') or "小禅 AI 智囊"

    safe_title = sanitize_filename(title)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")

    if doc_format == 'docx':
        download_name = f"{safe_title}_{timestamp}.docx"
        stream = markdown_to_docx(title, content, author=author)
        encoded_name = urllib.parse.quote(download_name.encode('utf-8'))
        response = send_file(
            stream,
            as_attachment=True,
            download_name=download_name,
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_name}"
        return response
    else:
        download_name = f"{safe_title}_{timestamp}.md"
        encoded_name = urllib.parse.quote(download_name.encode('utf-8'))
        md_text = f"# {title}\n\n*作者: {author} | 导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n---\n\n{content}"
        bio = io.BytesIO(md_text.encode('utf-8'))
        response = send_file(
            bio,
            as_attachment=True,
            download_name=download_name,
            mimetype="text/markdown; charset=utf-8"
        )
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_name}"
        return response


# ==========================================
# 团队分组与组员配置管理 (Groups & Members)
# ==========================================
GROUPS_FILE = os.path.join(os.path.dirname(__file__), 'user_groups.json')

def load_user_groups():
    if os.path.exists(GROUPS_FILE):
        try:
            with open(GROUPS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            app.logger.warning(f"Failed to load user_groups.json: {e}")
    # 默认初始化预设分组
    default_groups = [
        {
            "id": "grp_default_app",
            "name": "应用组",
            "members": [
                {"account": "wanglinmiao", "realname": "王淋淼"}
            ]
        }
    ]
    save_user_groups(default_groups)
    return default_groups

def save_user_groups(groups):
    try:
        with open(GROUPS_FILE, 'w', encoding='utf-8') as f:
            json.dump(groups, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        app.logger.error(f"Failed to save user_groups.json: {e}")
        return False

@app.route('/api/groups', methods=['GET'])
def api_get_groups():
    groups = load_user_groups()
    return jsonify({"success": True, "groups": groups})

@app.route('/api/groups', methods=['POST'])
def api_save_group():
    data = request.get_json() or {}
    group_id = data.get('id')
    name = (data.get('name') or '').strip()
    members = data.get('members') or []

    if not name:
        return jsonify({"success": False, "message": "分组名称不能为空"}), 400

    groups = load_user_groups()
    if group_id:
        found = False
        for g in groups:
            if g.get('id') == group_id:
                g['name'] = name
                g['members'] = members
                found = True
                break
        if not found:
            groups.append({"id": group_id, "name": name, "members": members})
    else:
        new_id = f"grp_{int(time.time()*1000)}"
        group_id = new_id
        groups.append({"id": new_id, "name": name, "members": members})

    save_user_groups(groups)
    return jsonify({"success": True, "message": "分组保存成功", "group_id": group_id, "groups": groups})

@app.route('/api/groups/<group_id>', methods=['DELETE'])
def api_delete_group(group_id):
    groups = load_user_groups()
    new_groups = [g for g in groups if g.get('id') != group_id]
    save_user_groups(new_groups)
    return jsonify({"success": True, "message": "分组已删除", "groups": new_groups})


if __name__ == '__main__':
    port = 5000
    print(f"[+] 禅道自动化 Web 控制台启动中...")
    print(f"[+] 本地访问地址: http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
