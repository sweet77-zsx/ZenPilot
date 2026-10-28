# -*- coding: utf-8 -*-
"""
禅道自动化运维工具 (ZenTao Automation Tool)
专为企业云禅道及标准禅道系统定制。
支持功能：
1. 查询待办任务列表 (支持按指派人、项目、执行筛选)
2. 一键完成任务并自动报工 (自动处理未开始->进行中->完成)
3. 跨项目/跨执行(Sprint)批量迁移任务
"""

import os
import sys
import json
import csv
import argparse
import configparser
import requests

# 确保在 Windows 控制台下不发生 GBK 编码异常
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CONFIG_FILE = "zentao_config.ini"

class ZentaoClient:
    def __init__(self, base_url, account, password):
        self.base_url = base_url.rstrip('/')
        self.account = account
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest"
        })
        self.realname = ""
        self.login()

    def login(self):
        """登录禅道并保存会话"""
        # 1. 获取 SessionID
        try:
            sess_url = f"{self.base_url}/api-getSessionID.json"
            r_sess = self.session.get(sess_url, timeout=10)
            if r_sess.status_code == 200:
                data = r_sess.json()
                raw_data = data.get('data')
                if raw_data:
                    session_obj = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
                    if 'sessionID' in session_obj:
                        self.session.cookies.set('zentaosid', session_obj['sessionID'])
        except Exception as e:
            pass

        # 2. 调用 user-login.json 登录
        login_url = f"{self.base_url}/user-login.json"
        try:
            res = self.session.post(login_url, data={"account": self.account, "password": self.password}, timeout=10)
            if res.status_code == 200:
                res_data = res.json()
                if res_data.get("status") == "success":
                    user_info = res_data.get("user", {})
                    self.realname = user_info.get("realname", self.account)
                    token = user_info.get("token")
                    if token:
                        self.session.headers.update({"Token": token})
                    print(f"[+] 登录成功！用户: {self.realname} ({self.account})")
                    return
                else:
                    reason = res_data.get("message") or res_data.get("reason") or res.text
                    raise RuntimeError(f"登录失败: {reason}")
            else:
                raise RuntimeError(f"HTTP 请求异常: 状态码 {res.status_code}")
        except Exception as e:
            raise RuntimeError(f"[-] 无法连接或登录禅道，请核实地址与账号密码: {e}")

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
        """获取我的任务列表 (assignedTo=指派给我, openedBy=由我创建, finishedBy=由我完成, all=全部)"""
        url = f"{self.base_url}/my-task-{view_type}-id_desc-0-1000-1.json"
        res = self.session.get(url, timeout=15)
        data = self._parse_data(res)
        tasks = data.get('tasks', [])
        if isinstance(tasks, dict):
            tasks = list(tasks.values())
        
        pager = data.get('pager')
        if fetch_all and pager and isinstance(pager, dict):
            page_total = pager.get('pageTotal', 1)
            rec_per_page = pager.get('recPerPage', 1000)
            if page_total > 1:
                all_tasks = list(tasks)
                for page_id in range(2, page_total + 1):
                    p_url = f"{self.base_url}/my-task-{view_type}-id_desc-0-{rec_per_page}-{page_id}.json"
                    p_res = self.session.get(p_url, timeout=15)
                    p_data = self._parse_data(p_res)
                    p_tasks = p_data.get('tasks', [])
                    if isinstance(p_tasks, dict):
                        p_tasks = list(p_tasks.values())
                    all_tasks.extend(p_tasks)
                return all_tasks
        return tasks

    def get_project_tasks(self, project_id):
        """获取指定项目下的所有任务"""
        url = f"{self.base_url}/project-task-{project_id}.json"
        res = self.session.get(url, timeout=10)
        data = self._parse_data(res)
        tasks = data.get('tasks', [])
        if isinstance(tasks, dict):
            tasks = list(tasks.values())
        return tasks

    def get_execution_tasks(self, execution_id):
        """获取指定执行/迭代下的所有任务"""
        url = f"{self.base_url}/execution-task-{execution_id}.json"
        res = self.session.get(url, timeout=10)
        data = self._parse_data(res)
        tasks = data.get('tasks', [])
        if isinstance(tasks, dict):
            tasks = list(tasks.values())
        return tasks

    def get_task_detail(self, task_id):
        """获取指定任务的详细数据"""
        url = f"{self.base_url}/task-view-{task_id}.json"
        res = self.session.get(url, timeout=10)
        data = self._parse_data(res)
        return data.get('task', {})

    def start_task(self, task_id, consumed=0.0, left=1.0):
        """将处于未开始状态的任务启动为进行中"""
        url = f"{self.base_url}/task-start-{task_id}.json"
        payload = {
            "consumed": consumed,
            "left": left,
            "realStarted": ""
        }
        res = self.session.post(url, data=payload, timeout=10)
        return "success" in res.text or res.status_code == 200

    def complete_task(self, task_id, current_consumed=1.0, comment="完成开发与自测"):
        """一键完成任务并报工"""
        task = self.get_task_detail(task_id)
        if not task:
            print(f"[-] 未找到任务 #{task_id}")
            return False

        task_name = task.get('name', f'任务{task_id}')
        status = task.get('status', '')

        if status in ['done', 'closed']:
            print(f"[!] 任务 #{task_id}「{task_name}」当前已处于「{status}」状态，无需重复完成。")
            return True

        # 如果任务未开始，先将其自动启动
        if status == 'wait':
            print(f"[*] 任务 #{task_id} 当前为未开始状态，正在自动将其切换为「进行中」...")
            self.start_task(task_id, consumed=0, left=float(task.get('estimate', 1.0) or 1.0))

        # 计算总工时
        already_consumed = float(task.get('consumed', 0.0) or 0.0)
        total_consumed = already_consumed + float(current_consumed)

        # 调 finish 接口
        finish_url = f"{self.base_url}/task-finish-{task_id}.json"
        payload = {
            "consumed": total_consumed,
            "currentConsumed": float(current_consumed),
            "assignedTo": task.get('openedBy', self.account), # 完成后默认指派回创建人进行验收关闭
            "comment": comment
        }
        res = self.session.post(finish_url, data=payload, timeout=10)
        if "success" in res.text or res.status_code == 200:
            print(f"[+] 任务 #{task_id}「{task_name}」已顺利点完成！")
            print(f"    - 本次报工: {current_consumed}h | 累计耗时: {total_consumed}h | 备注: {comment}")
            return True
        else:
            print(f"[-] 任务 #{task_id} 完成失败: {res.text}")
            return False

    def migrate_task(self, task_id, to_project_id=None, to_execution_id=None):
        """修改指定任务的项目或执行归属"""
        task = self.get_task_detail(task_id)
        if not task:
            print(f"[-] 未找到任务 #{task_id}")
            return False

        edit_url = f"{self.base_url}/task-edit-{task_id}.json"
        payload = {
            "name": task.get('name', ''),
            "type": task.get('type', 'devel'),
            "assignedTo": task.get('assignedTo', ''),
            "status": task.get('status', 'wait')
        }
        if to_project_id:
            payload["project"] = int(to_project_id)
        if to_execution_id:
            payload["execution"] = int(to_execution_id)

        res = self.session.post(edit_url, data=payload, timeout=10)
        if "success" in res.text or res.status_code == 200:
            return True
        else:
            print(f"[-] 任务 #{task_id} 迁移失败: {res.text}")
            return False

    def assign_task(self, task_id, assigned_to="closed", project_id=None, comment=""):
        """指派任务 (支持将 assignedTo 修改为 closed 或指定用户)"""
        if not project_id:
            task = self.get_task_detail(task_id)
            if not task:
                print(f"[-] 未找到任务 #{task_id}")
                return False
            project_id = task.get('project', 0)

        url = f"{self.base_url}/task-assignTo-{project_id}-{task_id}.json"
        payload = {
            "assignedTo": assigned_to,
            "status": "closed",
            "comment": comment
        }
        res = self.session.post(url, data=payload, timeout=10)
        return "success" in res.text or res.status_code == 200

    def batch_migrate(self, from_execution_id, to_project_id, to_execution_id, status_filter=None):
        """批量迁移某执行下的任务"""
        print(f"[*] 开始从执行 #{from_execution_id} 查询待迁移任务...")
        tasks = self.get_execution_tasks(from_execution_id)
        if not tasks:
            print(f"[-] 执行 #{from_execution_id} 下未发现任何任务。")
            return 0

        success_count = 0
        for t in tasks:
            t_id = t['id']
            t_name = t.get('name', '')
            t_status = t.get('status', '')

            if status_filter and t_status not in status_filter:
                continue

            if self.migrate_task(t_id, to_project_id, to_execution_id):
                print(f" [+] 任务 #{t_id}「{t_name}」成功迁移至 项目#{to_project_id} 执行#{to_execution_id}")
                success_count += 1

        print(f"[+] 批量迁移完成，共成功迁移 {success_count} 个任务。")
        return success_count


def load_config():
    """读取配置文件"""
    config = configparser.ConfigParser()
    if not os.path.exists(CONFIG_FILE):
        print(f"[-] 未找到配置文件 {CONFIG_FILE}，请先创建并配置。")
        sys.exit(1)
    config.read(CONFIG_FILE, encoding='utf-8')
    return config['zentao']


def print_task_table(tasks, title):
    print("\n" + "="*80)
    print(f"【{title}】 (共 {len(tasks)} 条)")
    print(f"{'ID':<8} {'状态':<10} {'耗时/预计':<14} {'任务名称'}")
    print("-"*80)
    status_map = {
        "wait": "未开始",
        "doing": "进行中",
        "done": "已完成",
        "pause": "已暂停",
        "cancel": "已取消",
        "closed": "已关闭"
    }
    for t in tasks:
        st_raw = t.get('status', '')
        st_text = status_map.get(st_raw, st_raw)
        consumed = t.get('consumed', 0)
        estimate = t.get('estimate', 0)
        time_info = f"{consumed}h / {estimate}h"
        t_id = t.get('id')
        name = t.get('name', '')
        print(f"#{t_id:<7} {st_text:<10} {time_info:<14} {name}")
    print("="*80 + "\n")


def main():
    parser = argparse.ArgumentParser(description="禅道任务自动化工具")
    subparsers = parser.add_subparsers(dest="action", help="命令操作列表")

    # list 命令
    list_p = subparsers.add_parser("list", help="查看任务清单")
    list_p.add_argument("--all", action="store_true", help="显示我负责的所有任务(包含已完成)")
    list_p.add_argument("--project", type=int, help="查看指定项目ID下的所有任务")
    list_p.add_argument("--execution", type=int, help="查看指定执行/Sprint ID下的所有任务")

    # finish 命令
    finish_p = subparsers.add_parser("finish", help="完成指定任务并报工")
    finish_p.add_argument("--id", required=True, type=int, help="任务ID")
    finish_p.add_argument("--consumed", type=float, default=1.0, help="本次报工耗时(小时)，默认 1.0")
    finish_p.add_argument("--comment", type=str, default="完成开发与自测", help="完成备注说明")

    # finish-all 命令
    fa_p = subparsers.add_parser("finish-all", help="一键完成当前指派给我的所有未完成任务")
    fa_p.add_argument("--consumed", type=float, default=1.0, help="每个任务报工耗时(小时)，默认 1.0")

    # migrate 命令
    mig_p = subparsers.add_parser("migrate", help="批量迁移任务")
    mig_p.add_argument("--from-execution", required=True, type=int, help="原执行/Sprint ID")
    mig_p.add_argument("--to-project", required=True, type=int, help="目标项目 ID")
    mig_p.add_argument("--to-execution", required=True, type=int, help="目标执行/Sprint ID")
    mig_p.add_argument("--status", type=str, default="wait,doing", help="按状态过滤(默认只迁移: wait,doing)")

    # query 命令
    query_p = subparsers.add_parser("query", help="自定义高级条件筛选任务并支持导出")
    query_p.add_argument("--type", type=str, default="finishedBy", choices=["assignedTo", "openedBy", "finishedBy", "closedBy", "all"], help="任务范围类型(默认: finishedBy 由我完成)")
    query_p.add_argument("--year", type=str, default="2026", help="预计开始时间年份过滤 (默认: 2026)")
    query_p.add_argument("--unassigned", action="store_true", default=True, help="仅筛选未指派任务 (assignedTo 为空，默认开启)")
    query_p.add_argument("--limit", type=int, default=20, help="终端展示条数限制 (默认: 20)")
    query_p.add_argument("--export", type=str, help="将查询结果导出为 CSV 文件路径 (例如: tasks.csv)")

    # close-unassigned 命令
    close_p = subparsers.add_parser("close-unassigned", help="批量将未指派任务的指派状态修改为 Closed")
    close_p.add_argument("--csv", type=str, default="2026年度_由我完成_未指派任务清单.csv", help="任务清单 CSV 路径 (默认: 2026年度_由我完成_未指派任务清单.csv)")
    close_p.add_argument("--year", type=str, default="2026", help="年份过滤(若 CSV 不存在则在线检索)")
    close_p.add_argument("--limit", type=int, help="限制处理的任务条数 (例如: --limit 1)")
    close_p.add_argument("--dry-run", action="store_true", help="预览待处理任务，不执行实际修改")

    args = parser.parse_args()

    # 读取配置并登录
    cfg = load_config()
    client = ZentaoClient(cfg['url'], cfg['account'], cfg['password'])

    if args.action == "list":
        if args.project:
            tasks = client.get_project_tasks(args.project)
            print_task_table(tasks, f"项目 #{args.project} 下的任务列表")
        elif args.execution:
            tasks = client.get_execution_tasks(args.execution)
            print_task_table(tasks, f"执行 #{args.execution} 下的任务列表")
        elif args.all:
            tasks = client.get_my_tasks(view_type="all")
            print_task_table(tasks, f"{client.realname} 的全部任务(含历史)")
        else:
            # 默认：先查 assignedTo 未完成的
            tasks = client.get_my_tasks(view_type="assignedTo")
            active_tasks = [t for t in tasks if t.get('status') in ['wait', 'doing', 'pause']]
            if active_tasks:
                print_task_table(active_tasks, f"指派给 {client.realname} 的待办任务")
            else:
                print(f"[*] 当前没有指派给 {client.realname} 的未完成待办任务。")
                opened = client.get_my_tasks(view_type="openedBy")
                if opened:
                    print_task_table(opened[:10], f"由 {client.realname} 创建的最近任务 (展示前 10 条)")

    elif args.action == "query":
        print(f"[*] 正在从禅道「我的地盘 -> {args.type}」检索全量任务...")
        tasks = client.get_my_tasks(view_type=args.type, fetch_all=True)
        print(f"[*] 原始获取任务总数: {len(tasks)} 条")

        # 过滤条件
        matched = []
        for t in tasks:
            # 年份过滤
            est = str(t.get('estStarted') or '')
            if args.year and not est.startswith(str(args.year)):
                continue
            # 未指派过滤
            if args.unassigned and (t.get('assignedTo') != '' and t.get('assignedTo') is not None):
                continue
            matched.append(t)

        title = f"查询结果: {args.type} | 年份={args.year or '不限'} | {'未指派' if args.unassigned else '全部指派状态'}"
        print_task_table(matched[:args.limit], f"{title} (共 {len(matched)} 条，展示前 {min(len(matched), args.limit)} 条)")

        if args.export:
            with open(args.export, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["任务ID", "任务名称", "状态", "指派给", "项目ID", "预计开始", "截止日期", "实际开始", "完成时间", "预计耗时", "消耗工时"])
                for t in matched:
                    writer.writerow([
                        t.get('id'),
                        t.get('name'),
                        t.get('status'),
                        t.get('assignedTo') or "未指派",
                        t.get('project'),
                        t.get('estStarted'),
                        t.get('deadline'),
                        t.get('realStarted'),
                        t.get('finishedDate'),
                        t.get('estimate'),
                        t.get('consumed')
                    ])
            print(f"[+] 已成功将全部 {len(matched)} 条符合条件的任务导出到: {args.export}")

    elif args.action == "finish":
        client.complete_task(args.id, current_consumed=args.consumed, comment=args.comment)

    elif args.action == "finish-all":
        tasks = client.get_my_tasks(view_type="assignedTo")
        active = [t for t in tasks if t.get('status') in ['wait', 'doing']]
        if not active:
            print("[*] 没有找到待处理的待办任务。")
            return
        print(f"[*] 共发现 {len(active)} 个待完成任务，正在逐个处理...")
        for t in active:
            client.complete_task(t['id'], current_consumed=args.consumed)

    elif args.action == "migrate":
        st_list = [s.strip() for s in args.status.split(',') if s.strip()]
        client.batch_migrate(
            from_execution_id=args.from_execution,
            to_project_id=args.to_project,
            to_execution_id=args.to_execution,
            status_filter=st_list
        )

    elif args.action == "close-unassigned":
        task_list = []
        if args.csv and os.path.exists(args.csv):
            print(f"[*] 正在从 CSV 文件读取未指派任务: {args.csv}")
            with open(args.csv, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    task_list.append({
                        "id": row.get("任务ID"),
                        "name": row.get("任务名称"),
                        "project": row.get("项目ID")
                    })
        else:
            print(f"[*] 正在从禅道「由我完成」检索 {args.year} 年度未指派任务...")
            raw_tasks = client.get_my_tasks(view_type="finishedBy", fetch_all=True)
            for t in raw_tasks:
                est = str(t.get('estStarted') or '')
                if args.year and not est.startswith(str(args.year)):
                    continue
                if t.get('assignedTo') == '' or t.get('assignedTo') is None:
                    task_list.append({
                        "id": t.get('id'),
                        "name": t.get('name'),
                        "project": t.get('project')
                    })

        total = len(task_list)
        if total == 0:
            print("[*] 没有找到符合条件的未指派任务。")
            return

        if args.limit:
            task_list = task_list[:args.limit]

        print(f"[*] 待处理任务总数: {len(task_list)} 条 (全量匹配: {total} 条)")

        if args.dry_run:
            print("[!] 当前处于 --dry-run 试运行模式，仅展示待处理任务，不会实际提交修改：")
            for i, t in enumerate(task_list[:10], 1):
                print(f"  [{i}] 任务 #{t['id']} (项目#{t['project']}): {t['name']}")
            if len(task_list) > 10:
                print(f"  ... 剩余 {len(task_list) - 10} 条未展示")
            return

        print(f"[*] 开始批量将任务指派状态修改为 Closed...")
        success_count = 0
        for i, t in enumerate(task_list, 1):
            t_id = t['id']
            t_name = t.get('name', '')
            p_id = t.get('project')
            ok = client.assign_task(t_id, assigned_to='closed', project_id=p_id)
            if ok:
                print(f"  [{i}/{len(task_list)}] [+] 任务 #{t_id}「{t_name}」指派状态已修改为 Closed")
                success_count += 1
            else:
                print(f"  [{i}/{len(task_list)}] [-] 任务 #{t_id} 修改失败")

        print(f"\n[+] 处理完毕！共成功处理 {success_count}/{len(task_list)} 条任务。")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
