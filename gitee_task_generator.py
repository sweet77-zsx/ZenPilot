# -*- coding: utf-8 -*-
"""
Gitee 提交记录 AI 任务工单生成器模块
功能：
1. 根据用户选定的时间范围和仓库，筛选 Gitee Commit 提交事件；
2. 调度 DeepSeek AI Agent 对提交记录进行智能合并、提炼与业务归纳；
3. 将任务严格填充入《任务模板.xlsx》，确保格式、单元格样式、公式和底部说明与模板完全一致；
4. 提供在线数据预览与流式下载功能。
"""

import os
import re
import copy
import json
from datetime import datetime, date
import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE_DIR, "任务模板.xlsx")
DOCS_DIR = os.path.join(BASE_DIR, "generated_docs")

if not os.path.exists(DOCS_DIR):
    os.makedirs(DOCS_DIR, exist_ok=True)

DEFAULT_PROJECT_NAME = "智慧医疗便民服务平台项目"
DEFAULT_ASSIGNEE = "张开发(#dev_user)"


def parse_commit_date_str(date_val):
    """提取提交时间字符串中的 YYYY-MM-DD 部分"""
    if not date_val:
        return ""
    if isinstance(date_val, (datetime, date)):
        return date_val.strftime("%Y-%m-%d")
    s = str(date_val).strip()
    match = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if match:
        return match.group(1)
    return s[:10]


def filter_commits_by_time_range(commits, start_date=None, end_date=None, repo=None):
    """
    根据时间范围和仓库过滤提交记录
    :param commits: 提交记录列表
    :param start_date: 起始日期 (YYYY-MM-DD)
    :param end_date: 截止日期 (YYYY-MM-DD)
    :param repo: 仓库路径或短名，'all' 表示全部仓库
    :return: 过滤后的 commits 列表
    """
    filtered = []
    for c in (commits or []):
        c_date = parse_commit_date_str(c.get("created_at") or c.get("timestamp") or "")
        if start_date and c_date and c_date < start_date:
            continue
        if end_date and c_date and c_date > end_date:
            continue

        if repo and repo != "all":
            r_path = c.get("repo_path") or ""
            r_name = c.get("repo_name") or ""
            if repo != r_path and repo != r_name:
                continue

        filtered.append(c)

    return filtered


def heuristic_cluster_commits_to_tasks(commits, start_date=None, end_date=None, project_name=None, assigned_to=None):
    """
    启发式智能聚类生成器 (当未配置 AI Key 或网络异常时的稳健高可用后备方案)
    将粒度较小的提交按仓库、分支与业务关键词进行归纳提炼。
    """
    project = project_name or DEFAULT_PROJECT_NAME
    assignee = assigned_to or DEFAULT_ASSIGNEE
    now_date = datetime.now().strftime("%Y-%m-%d")

    if not commits:
        return [
            {
                "project": project,
                "module": "日常维护",
                "story": "",
                "assigned_to": assignee,
                "name": "日常代码维护与功能巡检",
                "desc": "在选定周期内进行常规开发支持与代码审查。",
                "type": "开发",
                "pri": 3,
                "estimate": 2,
                "est_started": start_date or now_date,
                "deadline": end_date or now_date,
            }
        ]

    # 按仓库与分支分组
    groups = {}
    for c in commits:
        repo = c.get("repo_name") or c.get("repo_path") or "核心工程"
        branch = c.get("branch") or "main"
        key = (repo, branch)
        if key not in groups:
            groups[key] = []
        groups[key].append(c)

    tasks = []
    for (repo, branch), c_list in groups.items():
        # 提取涉及的日期范围
        c_dates = [parse_commit_date_str(c.get("created_at")) for c in c_list if parse_commit_date_str(c.get("created_at"))]
        task_start = min(c_dates) if c_dates else (start_date or now_date)
        task_end = max(c_dates) if c_dates else (end_date or now_date)

        # 提取提交消息标题并去重
        raw_titles = []
        short_shas = []
        fix_count = 0
        feat_count = 0

        for c in c_list:
            title = (c.get("commit_title") or c.get("title") or "").strip()
            # 过滤多余的前缀
            clean_title = re.sub(r"^(feat|fix|style|refactor|perf|chore|docs|test|merge)\s*[:：]\s*", "", title, flags=re.IGNORECASE).strip()
            if clean_title and clean_title not in raw_titles:
                raw_titles.append(clean_title)
            sha = c.get("short_sha") or (c.get("full_sha", "")[:7])
            if sha and sha not in short_shas:
                short_shas.append(sha)
            c_type = (c.get("commit_type") or "").upper()
            if "FIX" in c_type:
                fix_count += 1
            elif "FEAT" in c_type:
                feat_count += 1

        # 提炼模块名
        module_name = f"{repo}模块"
        if "hospital" in repo.lower():
            module_name = "互联网医院便民服务"
        elif "bds" in repo.lower():
            module_name = "中台数据服务"
        elif "hgwy" in repo.lower():
            module_name = "网关中间件服务"
        elif "mainframe" in repo.lower():
            module_name = "主框架底座"

        # 提炼任务名称
        main_title = raw_titles[0] if raw_titles else f"{repo} 功能迭代开发"
        if len(raw_titles) > 1:
            task_name = f"{main_title} 等相关功能优化与完善"
        else:
            task_name = main_title

        # 限制任务名称长度
        if len(task_name) > 60:
            task_name = task_name[:57] + "..."

        # 组合详细描述
        desc_lines = [f"【工作内容概述】基于 {repo} ({branch}) 分支进行代码研发与迭代："]
        for idx, t in enumerate(raw_titles[:8], 1):
            desc_lines.append(f"{idx}. {t}")
        if len(raw_titles) > 8:
            desc_lines.append(f"... 累计共包含 {len(raw_titles)} 项开发调整。")

        if short_shas:
            desc_lines.append(f"【关联代码提交】{', '.join(short_shas[:10])}")

        task_desc = "\n".join(desc_lines)

        # 估算工时: 每 1~2 个 Commit 计 1~2 小时，单任务最小 2，最大 8
        calc_hours = min(8, max(2, round(len(c_list) * 1.5)))

        # 任务类型判断
        task_type = "缺陷" if fix_count > feat_count else "开发"
        priority = 2 if fix_count > 0 else 3

        tasks.append({
            "project": project,
            "module": module_name,
            "story": "",
            "assigned_to": assignee,
            "name": task_name,
            "desc": task_desc,
            "type": task_type,
            "pri": priority,
            "estimate": calc_hours,
            "est_started": task_start,
            "deadline": task_end,
        })

    return tasks


def generate_tasks_with_agent(commits, start_date=None, end_date=None, project_name=None, assigned_to=None, api_key=None, base_url=None, model=None):
    """
    通过 DeepSeek AI Agent 汇总分析提交记录并生成规范禅道任务清单
    若未提供 API Key 或调用失败，则无缝切换至智能启发式提炼。
    """
    project = project_name or DEFAULT_PROJECT_NAME
    assignee = assigned_to or DEFAULT_ASSIGNEE
    key = (api_key or os.environ.get("DEEPSEEK_API_KEY", "")).strip()

    if not commits:
        return {
            "success": True,
            "source": "empty",
            "tasks": heuristic_cluster_commits_to_tasks([], start_date, end_date, project, assignee)
        }

    # 若未提供 Key，直接采用高可用启发式聚类
    if not key:
        return {
            "success": True,
            "source": "heuristic",
            "message": "已通过启发式规则智能聚类生成任务清单 (配置 DeepSeek API Key 可获得大模型深度语义提炼)",
            "tasks": heuristic_cluster_commits_to_tasks(commits, start_date, end_date, project, assignee)
        }

    # 准备传给 LLM 的紧凑提交列表数据
    commit_summaries = []
    for c in commits[:120]:  # 控制 Token 长度在安全范围内
        c_date = parse_commit_date_str(c.get("created_at") or "")
        repo = c.get("repo_name") or c.get("repo_path") or ""
        branch = c.get("branch") or "main"
        title = (c.get("commit_title") or c.get("title") or "").strip()
        body = (c.get("commit_desc") or c.get("body") or "").strip()
        c_type = c.get("commit_type") or "FEAT"
        sha = c.get("short_sha") or (c.get("full_sha", "")[:7])
        commit_summaries.append({
            "date": c_date,
            "repo": repo,
            "branch": branch,
            "type": c_type,
            "sha": sha,
            "title": title,
            "desc": body[:120] if body else ""
        })

    system_prompt = f"""你是一名资深研发项目管理专家与敏捷敏捷技术主管。
你的职责是：分析开发人员在特定时间段内的 Gitee Git Commit 代码提交日志，将零碎、细粒度（甚至琐碎）的代码提交，归纳提炼为符合企业敏捷研发管理规范的【禅道任务清单 (ZenTao Tasks)】。

【输出规范】：
1. 必须提炼为 2 ~ 10 项结构完整、具有明确业务与技术价值的任务项（严禁为每个琐碎 Commit 单独建一条任务，必须智能合并同一业务或同一模块的代码变动）。
2. 每项任务必须包含以下 11 个标准字段：
   - "project": 字符串，所属项目（统一使用 "{project}"）
   - "module": 字符串，所属业务或技术模块（如 "便民门诊模块", "医保接口对接", "中台认证服务", "性能调优" 等）
   - "story": 字符串，相关需求（可留空字符串 ""）
   - "assigned_to": 字符串，指派给负责人（统一使用 "{assignee}"）
   - "name": 字符串，任务名称，简练清晰（如 "解决门诊开中药处方医保编码校验与检索问题"）
   - "desc": 字符串，任务详细描述，必须条理分明（分条列出实现的具体业务逻辑、关键改进及关联的 Commit 哈希）
   - "type": 字符串，任务类型，只能为 "开发", "测试", "运维", "设计", "其他"
   - "pri": 整数，优先级，1-4，推荐 2 或 3
   - "estimate": 整数或浮点数，最初预计工时（单位：小时，通常 2 到 8 小时之间，符合常规工作量）
   - "est_started": 字符串，预计开始日期 (YYYY-MM-DD，落在指定时间范围内)
   - "deadline": 字符串，截止日期 (YYYY-MM-DD，落在指定时间范围内)
3. 必须输出严格合法的纯 JSON 数组，严禁包含任何前导或后置的 Markdown 说明标记（如 ```json 等）。
"""

    user_prompt = f"""统计周期：{start_date or '未限定'} 至 {end_date or '未限定'}
开发人员：{assignee}
所属项目：{project}
共计提交数：{len(commits)} 条。

以下是代码提交明细记录：
{json.dumps(commit_summaries, ensure_ascii=False, indent=2)}

请对上述提交进行深度分析、归纳聚合，输出最终符合规范的 JSON 任务数组。"""

    url = (base_url or "https://api.deepseek.com").rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model or "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 3000
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=60)
        if resp.status_code != 200:
            raise RuntimeError(f"DeepSeek 响应状态码异常 {resp.status_code}: {resp.text}")

        res_data = resp.json()
        raw_text = res_data["choices"][0]["message"]["content"].strip()

        # 清除可能的 ```json 包裹标记
        raw_text = re.sub(r"^```json\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        tasks = json.loads(raw_text)
        if isinstance(tasks, list) and len(tasks) > 0:
            # 格式规范清洗
            sanitized = []
            for t in tasks:
                sanitized.append({
                    "project": str(t.get("project") or project),
                    "module": str(t.get("module") or ""),
                    "story": str(t.get("story") or ""),
                    "assigned_to": str(t.get("assigned_to") or assignee),
                    "name": str(t.get("name") or "功能研发"),
                    "desc": str(t.get("desc") or ""),
                    "type": str(t.get("type") or "开发"),
                    "pri": int(t.get("pri") or 3),
                    "estimate": float(t.get("estimate") or 4),
                    "est_started": str(t.get("est_started") or start_date or datetime.now().strftime("%Y-%m-%d")),
                    "deadline": str(t.get("deadline") or end_date or datetime.now().strftime("%Y-%m-%d"))
                })
            return {
                "success": True,
                "source": "deepseek-agent",
                "message": f"DeepSeek AI Agent 已成功提炼生成 {len(sanitized)} 项任务工单",
                "tasks": sanitized
            }

    except Exception as e:
        # LLM 解析或请求异常时回退至启发式聚类
        fallback_tasks = heuristic_cluster_commits_to_tasks(commits, start_date, end_date, project, assignee)
        return {
            "success": True,
            "source": "heuristic_fallback",
            "message": f"AI 接口调用受阻 ({str(e)})，已自动启用备用智能聚类生成任务清单",
            "tasks": fallback_tasks
        }


def fill_task_template_excel(tasks, template_path=None, output_path=None):
    """
    按照《任务模板.xlsx》填充数据，严格保持原有样式、字体、边框、列宽与底部提示说明。
    :param tasks: 规范化的任务对象列表
    :param template_path: 模板路径，默认读取当前目录下的 任务模板.xlsx
    :param output_path: 输出文件路径
    :return: 最终生成保存的绝对路径
    """
    t_path = template_path or TEMPLATE_PATH
    if not os.path.exists(t_path):
        raise FileNotFoundError(f"未找到任务模板文件: {t_path}")

    wb = openpyxl.load_workbook(t_path)
    if "任务" not in wb.sheetnames:
        raise ValueError("模板中缺少工作表: 任务")

    ws = wb["任务"]

    # 1. 抓取第 2 行的单元格样式规范（字号、边框、填充底色、对齐方式、数字格式）
    row2_styles = {}
    for col in range(1, 12):
        c = ws.cell(2, col)
        row2_styles[col] = {
            "font": copy.copy(c.font),
            "fill": copy.copy(c.fill),
            "border": copy.copy(c.border),
            "alignment": copy.copy(c.alignment),
            "number_format": c.number_format
        }

    # 2. 提取模板底部的 3 行合并说明文字及其样式
    notes = []
    for r in [5, 6, 7]:
        c = ws.cell(r, 1)
        notes.append({
            "val": c.value,
            "font": copy.copy(c.font),
            "fill": copy.copy(c.fill),
            "border": copy.copy(c.border),
            "alignment": copy.copy(c.alignment),
            "height": ws.row_dimensions[r].height
        })

    # 3. 解除原有的说明行合并单元格
    for rng in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(rng))

    # 4. 删除原有的示例数据行与说明行 (共删除 6 行: 原 2, 3, 4, 5, 6, 7)
    ws.delete_rows(2, 6)

    # 5. 逐行填充新任务
    current_row = 2
    for t in (tasks or []):
        row_values = [
            t.get("project", ""),
            t.get("module") or "",
            t.get("story") or "",
            t.get("assigned_to", ""),
            t.get("name", ""),
            t.get("desc", ""),
            t.get("type", "开发"),
            t.get("pri", 3),
            t.get("estimate", 2),
            t.get("est_started", ""),
            t.get("deadline", "")
        ]

        for col_idx, val in enumerate(row_values, 1):
            cell = ws.cell(current_row, col_idx, value=val)
            st = row2_styles.get(col_idx)
            if st:
                cell.font = copy.copy(st["font"])
                cell.fill = copy.copy(st["fill"])
                cell.border = copy.copy(st["border"])
                cell.alignment = copy.copy(st["alignment"])
                cell.number_format = st["number_format"]

        # 动态根据描述行数调整行高，确保美观易读
        line_count = str(t.get("desc", "")).count("\n") + 1
        ws.row_dimensions[current_row].height = max(28.0, 18.0 + line_count * 12.0)
        current_row += 1

    # 6. 在任务数据行下方，重新写入 3 条格式一致的说明文字并合并 A~K 列
    for note in notes:
        cell = ws.cell(current_row, 1, value=note["val"])
        cell.font = copy.copy(note["font"])
        cell.fill = copy.copy(note["fill"])
        cell.border = copy.copy(note["border"])
        cell.alignment = copy.copy(note["alignment"])

        for c in range(2, 12):
            cell_c = ws.cell(current_row, c)
            cell_c.border = copy.copy(note["border"])
            cell_c.fill = copy.copy(note["fill"])

        ws.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=11)
        if note["height"]:
            ws.row_dimensions[current_row].height = note["height"]
        current_row += 1

    # 7. 保存文件
    if not output_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"Gitee代码提交汇总_禅道任务清单_{timestamp}.xlsx"
        output_path = os.path.join(DOCS_DIR, filename)

    wb.save(output_path)
    return output_path
