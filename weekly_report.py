# -*- coding: utf-8 -*-
"""
周报生成与 Excel 导出服务模块
参考模板：应用组周报.xlsx
"""

import io
import re
import math
import datetime
import openpyxl
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from openpyxl.utils import get_column_letter


def get_current_week_range(target_date=None):
    """获取指定日期所在周的周一和周日日期字符串 (YYYY-MM-DD)"""
    if target_date is None:
        target_date = datetime.date.today()
    elif isinstance(target_date, str):
        target_date = datetime.datetime.strptime(target_date[:10], '%Y-%m-%d').date()

    monday = target_date - datetime.timedelta(days=target_date.weekday())
    sunday = monday + datetime.timedelta(days=6)
    return monday.strftime('%Y-%m-%d'), sunday.strftime('%Y-%m-%d')


def generate_weekly_report_data(client, start_date=None, end_date=None, reporter=None, department="应用组"):
    """
    根据禅道中本周登录人完成的任务生成对应的结构化周报数据
    :param client: 已登录的 ZentaoClient 实例
    :param start_date: 起始日期 (YYYY-MM-DD)，若为空则取当前周周一
    :param end_date: 截止日期 (YYYY-MM-DD)，若为空则取当前周周日
    :param reporter: 汇报人，默认为 client.realname 或 client.account
    :param department: 部门，默认为 应用组
    :return: 包含周报所有版块的字典数据
    """
    default_start, default_end = get_current_week_range()
    if not start_date:
        start_date = default_start
    if not end_date:
        end_date = default_end

    start_dt = f"{start_date} 00:00:00"
    end_dt = f"{end_date} 23:59:59"

    # 汇报人与时间
    current_reporter = reporter or getattr(client, 'realname', '') or getattr(client, 'account', '') or "汇报人"
    today_str = datetime.date.today().strftime('%Y-%m-%d')

    # 1. 获取项目映射表 (项目ID -> 项目名称)
    project_map = {}
    try:
        projects = client.get_all_projects()
        for p in projects:
            project_map[str(p.get('id'))] = str(p.get('name'))
    except Exception as e:
        print(f"[WeeklyReport] 获取项目列表失败: {e}")

    # 2. 抓取本周登录人完成的任务
    account = str(getattr(client, 'account', '') or '').strip().lower()
    realname = str(getattr(client, 'realname', '') or '').strip()

    finished_tasks_pool = []
    try:
        # 优先查 finishedBy
        t_finished = client.get_my_tasks(view_type="finishedBy", fetch_all=True)
        finished_tasks_pool.extend(t_finished)
    except Exception as e:
        print(f"[WeeklyReport] 抓取 finishedBy 任务失败: {e}")

    try:
        # 补充 closedBy / all 里的已完成任务
        t_closed = client.get_my_tasks(view_type="closedBy", fetch_all=True)
        for ct in t_closed:
            fb = str(ct.get('finishedBy', '')).strip().lower()
            fbr = str(ct.get('finishedByRealname', '')).strip()
            if (account and fb == account) or (realname and (fb == realname or fbr == realname)):
                finished_tasks_pool.append(ct)
    except Exception as e:
        print(f"[WeeklyReport] 抓取 closedBy 任务失败: {e}")

    # 去重并筛选本周内完成的任务
    seen_ids = set()
    week_finished_tasks = []
    for t in finished_tasks_pool:
        tid = str(t.get('id'))
        if tid in seen_ids:
            continue
        seen_ids.add(tid)

        f_date = str(t.get('finishedDate') or '').strip()
        # 匹配完成时间在本周范围内
        if f_date and (start_dt <= f_date <= end_dt):
            week_finished_tasks.append(t)
        elif not f_date:
            # 部分禅道版本如果没有 finishedDate，若状态为已完成且在当前周操作的也兼容纳入
            last_date = str(t.get('lastEditedDate') or t.get('closedDate') or '').strip()
            if last_date and (start_dt <= last_date <= end_dt) and t.get('status') in ['done', 'closed']:
                week_finished_tasks.append(t)

    # 按所属项目对本周完成任务进行分组
    summary_by_project = {}
    for t in week_finished_tasks:
        pid = str(t.get('project', '0'))
        pname = project_map.get(pid) or t.get('projectName') or f"项目#{pid}"
        tname = str(t.get('name', '')).strip()
        if tname:
            summary_by_project.setdefault(pname, []).append(tname)

    # 格式化本周工作总结条目
    summary_items = []
    for pname, tnames in summary_by_project.items():
        summary_items.append({
            "project_name": pname,
            "tasks": tnames,
            "progress_risk": "进度：100%\n风险：\n",
            "tech_notes": ""
        })

    # 3. 抓取下周计划候选 (当前指派给当前登录人、状态为未完成 wait/doing/pause 的任务)
    plan_by_project = {}
    try:
        my_active = client.get_my_tasks(view_type="assignedTo", fetch_all=True)
        for t in my_active:
            if t.get('status') in ['wait', 'doing', 'pause']:
                pid = str(t.get('project', '0'))
                pname = project_map.get(pid) or t.get('projectName') or f"项目#{pid}"
                tname = str(t.get('name', '')).strip()
                if tname:
                    plan_by_project.setdefault(pname, []).append(tname)
    except Exception as e:
        print(f"[WeeklyReport] 抓取下周待办任务失败: {e}")

    # 格式化下周计划条目
    plan_items = []
    for pname, tnames in plan_by_project.items():
        plan_items.append({
            "project_name": pname,
            "tasks": tnames,
            "progress_risk": "进度：进行中",
            "tech_notes": ""
        })

    # 如果没有任何任务，提供占位项避免导出空白
    if not summary_items:
        summary_items.append({
            "project_name": "日常研发与支持",
            "tasks": ["暂未检索到本周在禅道标记完成的任务，请在此直接补充填写"],
            "progress_risk": "进度：100%\n风险：\n",
            "tech_notes": ""
        })

    if not plan_items:
        plan_items.append({
            "project_name": "重点项目推进",
            "tasks": ["按排期推进下周重点项目开发与联调"],
            "progress_risk": "进度：进行中",
            "tech_notes": ""
        })

    return {
        "title": "应用组工作周报",
        "reporter": current_reporter,
        "department": department,
        "report_date": today_str,
        "start_date": start_date,
        "end_date": end_date,
        "week_range": f"{start_date} 至 {end_date}",
        "summary_items": summary_items,
        "plan_items": plan_items,
        "risks_and_issues": "暂无严重阻塞风险与问题",
        "suggestions": "加快三方处理进度，持续推进交付"
    }


def export_weekly_report_excel(report_data):
    """
    根据周报数据构建并导出格式与样式100%符合《应用组周报.xlsx》标准的 Excel 文件
    :param report_data: 周报字典对象
    :return: BytesIO 二进制文件流
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    # 1. 严格参照模板设置列宽 (Col A: 15.18, B: 19.73, C: 50.73, D: 27.73, E: 29.46)
    col_widths = {
        'A': 15.18,
        'B': 19.73,
        'C': 50.73,
        'D': 27.73,
        'E': 29.46
    }
    for col, width in col_widths.items():
        ws.column_dimensions[col].width = width

    # 2. 边框、字体与背景填充规范（完全严格对齐《应用组周报.xlsx》模板）
    thin_border = Border(
        left=Side(style='thin', color='000000'),
        right=Side(style='thin', color='000000'),
        top=Side(style='thin', color='000000'),
        bottom=Side(style='thin', color='000000')
    )

    # 模板主题背景色 (OpenXML theme 4, tint 0.4 -> #91ACE0 浅蓝靛)
    header_fill = PatternFill(start_color="91ACE0", end_color="91ACE0", fill_type="solid")

    font_family = '黑体'
    font_title = Font(name=font_family, size=14, bold=True, color='000000')
    font_bold_12 = Font(name=font_family, size=12, bold=True, color='000000')
    font_bold_11 = Font(name=font_family, size=11, bold=True, color='000000')
    font_regular_11 = Font(name=font_family, size=11, bold=False, color='000000')

    align_center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    align_left_center = Alignment(horizontal='left', vertical='center', wrap_text=True)
    align_left_top = Alignment(horizontal='left', vertical='top', wrap_text=True)

    title_text = report_data.get('title') or '应用组工作周报'
    reporter = report_data.get('reporter') or ''
    department = report_data.get('department') or '应用组'
    report_date = report_data.get('report_date') or datetime.date.today().strftime('%Y-%m-%d')

    # Row 1: 大标题 (A1:E1 合并，高度 35，背景 #91ACE0，黑体 14pt 加粗)
    ws.row_dimensions[1].height = 35
    ws.merge_cells('A1:E1')
    for col_letter in ['A', 'B', 'C', 'D', 'E']:
        c = ws[f'{col_letter}1']
        c.font = font_title
        c.fill = header_fill
        c.alignment = align_center
        c.border = thin_border
    ws['A1'] = title_text

    # Row 2: 汇报人与时间 (高度 30，黑体 12pt 加粗)
    ws.row_dimensions[2].height = 30
    ws['A2'] = '汇报人'
    ws['A2'].font = font_bold_12
    ws['A2'].alignment = align_center
    ws['A2'].border = thin_border

    ws['B2'] = reporter
    ws['B2'].font = font_bold_12
    ws['B2'].alignment = align_center
    ws['B2'].border = thin_border

    ws['C2'] = department
    ws['C2'].font = font_bold_12
    ws['C2'].alignment = align_center
    ws['C2'].border = thin_border

    ws.merge_cells('D2:E2')
    ws['D2'] = f"汇报时间：{report_date}"
    ws['D2'].font = font_bold_12
    ws['D2'].alignment = align_left_center
    ws['D2'].border = thin_border
    ws['E2'].border = thin_border

    # Row 3: 表头 (A3:E3，高度 30，背景 #91ACE0，黑体 11pt 加粗，居中)
    ws.row_dimensions[3].height = 30
    headers = ['类别', '项目名称', '重点任务', '进度与风险', '技术要点']
    for c_idx, h in enumerate(headers, 1):
        cell = ws.cell(3, c_idx, h)
        cell.font = font_bold_11
        cell.fill = header_fill
        cell.alignment = align_center
        cell.border = thin_border

    current_row = 4

    def format_task_text(tasks):
        """
        将任务数组格式化为带序号的换行文本，
        彻底剥除任务开头可能带有的多余序号（例如 '10.', '10. 10.', '11. 11.' 等），
        统一生成整洁规范的单层序号。
        """
        if isinstance(tasks, str):
            tasks = [t for t in tasks.split('\n') if t.strip()]
        if not tasks:
            return ""
        lines = []
        for i, t in enumerate(tasks, 1):
            t_str = str(t).strip()
            # 彻底去除已有的序号前缀 (支持多重如 10. 10.、11、等)
            clean_text = re.sub(r'^(\d+[\.、\s]\s*)+', '', t_str).strip()
            if not clean_text:
                clean_text = t_str
            lines.append(f"{i}. {clean_text}")
        return "\n".join(lines)

    def estimate_row_height(tasks_text, prog_risk_text="", tech_notes_text=""):
        """
        精准估算任务行的行高：
        11pt 黑体每行高度约为 14.5 磅；
        严格按用户要求将上下留白控制在各约 10 磅（上下总留白 20 磅），
        杜绝留白过多过空的问题。
        """
        def calc_lines(text, limit_chars):
            if not text:
                return 0
            lines = 0
            for raw_line in text.split('\n'):
                line = raw_line.strip()
                if not line:
                    continue
                # 计算字符宽度：全角算1，半角算0.55
                w = sum(1.0 if ord(c) > 127 else 0.55 for c in line)
                lines += max(1, math.ceil(w / limit_chars))
            return max(lines, 1)

        # C列宽 50.73(约36汉字), D列宽 27.73(约19汉字), E列宽 29.46(约20汉字)
        c_lines = calc_lines(tasks_text, 36.0)
        d_lines = calc_lines(prog_risk_text, 19.0)
        e_lines = calc_lines(tech_notes_text, 20.0)

        max_lines = max(c_lines, d_lines, e_lines, 1)
        # 单行文字高约 14.5 磅，上下间距各 10 磅 (+ 20)
        h = max_lines * 14.5 + 20.0
        return max(32.0, round(h, 1))

    # 4. 写入「本周工作总结」区域
    summary_items = report_data.get('summary_items') or []
    if not summary_items:
        summary_items = [{"project_name": "日常研发", "tasks": ["本周完成日常维护与研发"], "progress_risk": "进度：100%\n风险：\n", "tech_notes": ""}]

    summary_start_row = current_row
    for item in summary_items:
        pname = item.get('project_name', '')
        tasks_text = format_task_text(item.get('tasks', []))
        prog_risk = item.get('progress_risk') or "进度：100%\n风险：\n"
        tech_notes = item.get('tech_notes') or ""

        # 精准自适应行高：上下间距各留白约 10 磅
        ws.row_dimensions[current_row].height = estimate_row_height(tasks_text, prog_risk, tech_notes)

        # B列: 项目名称
        c2 = ws.cell(current_row, 2, pname)
        c2.font = font_regular_11
        c2.alignment = align_center
        c2.border = thin_border

        # C列: 重点任务 (靠左居中)
        c3 = ws.cell(current_row, 3, tasks_text)
        c3.font = font_regular_11
        c3.alignment = align_left_center
        c3.border = thin_border

        # D列: 进度与风险 (靠左居中)
        c4 = ws.cell(current_row, 4, prog_risk)
        c4.font = font_regular_11
        c4.alignment = align_left_center
        c4.border = thin_border

        # E列: 技术要点 (靠左居中)
        c5 = ws.cell(current_row, 5, tech_notes)
        c5.font = font_regular_11
        c5.alignment = align_left_center
        c5.border = thin_border

        current_row += 1

    summary_end_row = current_row - 1
    # 合并 A 列「本周工作总结」
    if summary_end_row >= summary_start_row:
        if summary_end_row > summary_start_row:
            ws.merge_cells(start_row=summary_start_row, start_column=1, end_row=summary_end_row, end_column=1)
        for r_sub in range(summary_start_row, summary_end_row + 1):
            cell_a = ws.cell(r_sub, 1)
            cell_a.font = font_bold_11
            cell_a.alignment = align_center
            cell_a.border = thin_border
        ws.cell(summary_start_row, 1, '本周工作总结')

    # 5. 写入「下周计划」区域
    plan_items = report_data.get('plan_items') or []
    if not plan_items:
        plan_items = [{"project_name": "重点项目推进", "tasks": ["按排期推进下周工作"], "progress_risk": "进度：进行中", "tech_notes": ""}]

    plan_start_row = current_row
    for item in plan_items:
        pname = item.get('project_name', '')
        tasks_text = format_task_text(item.get('tasks', []))
        prog_risk = item.get('progress_risk') or ""
        tech_notes = item.get('tech_notes') or ""

        # 精准自适应行高：上下间距各留白约 10 磅
        ws.row_dimensions[current_row].height = estimate_row_height(tasks_text, prog_risk, tech_notes)

        c2 = ws.cell(current_row, 2, pname)
        c2.font = font_regular_11
        c2.alignment = align_center
        c2.border = thin_border

        c3 = ws.cell(current_row, 3, tasks_text)
        c3.font = font_regular_11
        c3.alignment = align_left_center
        c3.border = thin_border

        c4 = ws.cell(current_row, 4, prog_risk)
        c4.font = font_regular_11
        c4.alignment = align_left_center
        c4.border = thin_border

        c5 = ws.cell(current_row, 5, tech_notes)
        c5.font = font_regular_11
        c5.alignment = align_left_center
        c5.border = thin_border

        current_row += 1

    plan_end_row = current_row - 1
    # 合并 A 列「下周计划」
    if plan_end_row >= plan_start_row:
        if plan_end_row > plan_start_row:
            ws.merge_cells(start_row=plan_start_row, start_column=1, end_row=plan_end_row, end_column=1)
        for r_sub in range(plan_start_row, plan_end_row + 1):
            cell_a = ws.cell(r_sub, 1)
            cell_a.font = font_bold_11
            cell_a.alignment = align_center
            cell_a.border = thin_border
        ws.cell(plan_start_row, 1, '下周计划')

    # 6. 写入「风险与问题」行 (B:E 合并)
    risk_row = current_row
    risk_text = str(report_data.get('risks_and_issues') or '暂无明显风险与阻塞问题').strip()
    risk_lines = max(len(risk_text.split('\n')), 1)
    ws.row_dimensions[risk_row].height = max(50, risk_lines * 20 + 15)

    c1 = ws.cell(risk_row, 1, '风险与问题')
    c1.font = font_bold_11
    c1.alignment = align_center
    c1.border = thin_border

    ws.merge_cells(start_row=risk_row, start_column=2, end_row=risk_row, end_column=5)
    for col_c in range(2, 6):
        c_sub = ws.cell(risk_row, col_c)
        c_sub.font = font_regular_11
        c_sub.alignment = align_left_top
        c_sub.border = thin_border
    ws.cell(risk_row, 2, risk_text)
    current_row += 1

    # 7. 写入「优化与建议」行 (B:E 合并)
    sug_row = current_row
    sug_text = str(report_data.get('suggestions') or '加快三方处理进度，持续推进交付').strip()
    sug_lines = max(len(sug_text.split('\n')), 1)
    ws.row_dimensions[sug_row].height = max(40, sug_lines * 20 + 10)

    c1 = ws.cell(sug_row, 1, '优化与建议')
    c1.font = font_bold_11
    c1.alignment = align_center
    c1.border = thin_border

    ws.merge_cells(start_row=sug_row, start_column=2, end_row=sug_row, end_column=5)
    for col_c in range(2, 6):
        c_sub = ws.cell(sug_row, col_c)
        c_sub.font = font_regular_11
        c_sub.alignment = align_left_top
        c_sub.border = thin_border
    ws.cell(sug_row, 2, sug_text)
    current_row += 1

    # 8. 确保全部单元格均具有完整边框
    max_row = current_row - 1
    for r in range(1, max_row + 1):
        for c in range(1, 6):
            cell = ws.cell(r, c)
            cell.border = thin_border

    # 导出到内存流
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output
