# -*- coding: utf-8 -*-
"""
DeepSeek AI Agent 服务模块
提供内置桌宠 Agent 的 Function Calling 工具集与多轮执行引擎。
能够查询禅道任务、项目、批量完成、修改名称以及生成周报。
"""

import os
import json
import requests
from datetime import datetime
from weekly_report import generate_weekly_report_data
from ai_document import save_generated_doc

# 默认 DeepSeek 基础地址与模型
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"

# Agent 工具集规范定义 (OpenAI / DeepSeek 标准 Tools 格式)
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_active_tasks",
            "description": "获取当前登录人在禅道中指派给我的所有未完成任务（待办 wait、进行中 doing、挂起 pause），返回包含任务ID、名称、所属项目、预计工时等列表。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_all_projects",
            "description": "获取禅道中当前所有可用项目的列表（包含项目ID与项目名称）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "可选的项目名称搜索关键词，用于过滤项目。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_tasks",
            "description": "在禅道中灵活搜索符合多重条件的任务，支持按项目ID、执行ID、关键词、状态(wait/doing/done/closed)、归属人类型(assignedTo/openedBy/finishedBy)进行检索。",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "integer",
                        "description": "可选的项目ID，指定后仅查该项目下的任务。"
                    },
                    "view_type": {
                        "type": "string",
                        "enum": ["assignedTo", "openedBy", "finishedBy", "closedBy", "all"],
                        "description": "任务视角类型：指派给我(assignedTo)、由我创建(openedBy)、由我完成(finishedBy)、由我关闭(closedBy)、全部(all)。默认 assignedTo。"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["all", "wait", "doing", "done", "closed", "pause", "cancel"],
                        "description": "可选的任务状态过滤。"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "可选的任务名称包含关键词。"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回的最大任务条数，默认 20 条。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "batch_finish_my_tasks",
            "description": "一键将指派给我的未完成任务批量标记为已完成。系统会自动将任务先切为进行中，再填充预计工时并点击已完成。支持自定义每步停顿间隔（模拟真实人工操作）与可选完成备注。",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "可选，要批量完成的具体任务ID数组。若为空则处理当前名下所有待办任务。"
                    },
                    "interval_seconds": {
                        "type": "number",
                        "description": "可选，每一步操作以及任务之间的停顿间隔时间（秒），默认 1.0 秒。模拟人工操作，避免机器脚本特征。"
                    },
                    "comment": {
                        "type": "string",
                        "description": "可选，填写完成任务时的流转备注说明。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "batch_update_task_name",
            "description": "批量修改指定任务的任务名称，支持选择是否将任务描述也同步改为新名称。",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "需要修改名称的任务ID数组。"
                    },
                    "new_name": {
                        "type": "string",
                        "description": "修改后的目标任务名称。"
                    },
                    "sync_desc": {
                        "type": "boolean",
                        "description": "是否同步将任务描述(desc)也设置为该任务名称，默认为 false。"
                    }
                },
                "required": ["task_ids", "new_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_weekly_report",
            "description": "自动抓取当前登录人本周在禅道完成的全部任务，并按项目归类生成周报数据概要。",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "可选的周起始日期 (格式 YYYY-MM-DD)。为空则默认为本周一。"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "可选的周截止日期 (格式 YYYY-MM-DD)。为空则默认为本周日。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_downloadable_document",
            "description": "将用户需要的内容、周报、任务总结、需求或技术方案生成排版精美的结构化文档文件（支持 Word .docx 与 Markdown .md），并在浏览器中生成直接下载链接。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "文档的标题，例如：'张开发_本周研发工作周报'、'禅道待办任务梳理与复盘总结'。"
                    },
                    "content": {
                        "type": "string",
                        "description": "文档正文内容，支持完整的 Markdown 格式（可包含大标题#、二级标题##、列表、表格、加粗、引用与分析说明等）。"
                    },
                    "doc_type": {
                        "type": "string",
                        "enum": ["docx", "md"],
                        "description": "生成的文档格式类型，可选 'docx'（推荐，生成标准Word文档）或 'md'（Markdown纯文本），默认为 'docx'。"
                    }
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_user_status",
            "description": "获取当前禅道登录人的账号信息、真实姓名、当前系统时间以及当前禅道连接状态。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    }
]


def execute_agent_tool(tool_name, arguments, client):
    """
    执行 Agent 调用的具体工具函数
    :param tool_name: 函数名称
    :param arguments: 解析后的参数字典
    :param client: 当前登录会话专属的 ZentaoClient 实例
    :return: dict 执行结果
    """
    if not client:
        if tool_name == "get_current_user_status":
            return {
                "logged_in": False,
                "account": "",
                "realname": "",
                "current_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "zentao_url": ""
            }
        elif tool_name != "generate_downloadable_document":
            return {"error": "当前未登录禅道账号，无法执行此禅道系统操作。请先在页面登录禅道。"}

    try:
        if tool_name == "get_current_user_status":
            account = getattr(client, 'account', '') or ''
            realname = getattr(client, 'realname', '') or account
            return {
                "logged_in": bool(account),
                "account": account,
                "realname": realname,
                "current_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "zentao_url": getattr(client, 'base_url', '')
            }

        elif tool_name == "get_all_projects":
            keyword = str(arguments.get("keyword") or "").strip().lower()
            projects = client.get_all_projects()
            if keyword:
                projects = [p for p in projects if keyword in str(p.get("name", "")).lower()]
            return {
                "total": len(projects),
                "projects": [
                    {"id": p.get("id"), "name": p.get("name"), "status": p.get("status")}
                    for p in projects[:30] # 最多展示前30个避免上下文过长
                ]
            }

        elif tool_name == "get_my_active_tasks":
            tasks = client.get_my_tasks(view_type="assignedTo", fetch_all=True)
            active = [t for t in tasks if t.get('status') in ['wait', 'doing', 'pause']]
            total_estimate = sum(float(t.get('estimate') or t.get('estHours') or 0) for t in active)
            # 获取项目名称映射
            proj_map = {}
            try:
                for p in client.get_all_projects():
                    proj_map[str(p.get('id'))] = p.get('name')
            except Exception:
                pass

            formatted = []
            for t in active[:30]:
                pid = str(t.get('project', '0'))
                formatted.append({
                    "id": t.get("id"),
                    "name": t.get("name"),
                    "project_id": pid,
                    "project_name": proj_map.get(pid) or t.get("projectName") or f"项目#{pid}",
                    "status": t.get("status"),
                    "estimate_hours": t.get("estimate") or t.get("estHours") or 0,
                    "deadline": t.get("deadline")
                })
            return {
                "total_active_count": len(active),
                "total_estimate_hours": round(total_estimate, 1),
                "display_count": len(formatted),
                "tasks": formatted
            }

        elif tool_name == "query_tasks":
            proj_id = arguments.get("project_id")
            view_type = arguments.get("view_type", "assignedTo")
            status = arguments.get("status")
            kw = str(arguments.get("keyword") or "").strip().lower()
            limit = int(arguments.get("limit") or 20)

            if proj_id:
                raw_tasks = client.get_project_tasks(int(proj_id))
            else:
                raw_tasks = client.get_my_tasks(view_type=view_type, fetch_all=True)

            filtered = []
            for t in raw_tasks:
                if status and status != 'all' and t.get('status') != status:
                    continue
                if kw and kw not in str(t.get('name', '')).lower():
                    continue
                filtered.append({
                    "id": t.get("id"),
                    "name": t.get("name"),
                    "status": t.get("status"),
                    "assignedTo": t.get("assignedToRealname") or t.get("assignedTo"),
                    "openedBy": t.get("openedByRealname") or t.get("openedBy"),
                    "estimate": t.get("estimate") or 0
                })
                if len(filtered) >= limit:
                    break

            return {
                "total_matched": len(filtered),
                "tasks": filtered
            }

        elif tool_name == "batch_finish_my_tasks":
            target_ids = arguments.get("task_ids")
            interval_sec = arguments.get("interval_seconds", 1.0)
            try:
                interval_sec = float(interval_sec)
            except (ValueError, TypeError):
                interval_sec = 1.0
            comment_text = str(arguments.get("comment") or "").strip()
            res = client.batch_auto_finish_my_tasks(target_task_ids=target_ids, interval_seconds=interval_sec, comment=comment_text)
            return {
                "success_count": len(res.get("success", [])),
                "skipped_count": len(res.get("skipped", [])),
                "failed_count": len(res.get("failed", [])),
                "success_tasks": res.get("success", []),
                "skipped_tasks": res.get("skipped", []),
                "failed_tasks": res.get("failed", [])
            }

        elif tool_name == "batch_update_task_name":
            task_ids = arguments.get("task_ids") or []
            new_name = str(arguments.get("new_name") or "").strip()
            sync_desc = bool(arguments.get("sync_desc", False))

            if not task_ids or not new_name:
                return {"error": "必须提供 task_ids 和 new_name 参数"}

            res = client.batch_edit_task_field(
                task_ids=task_ids,
                field_name="name",
                new_value=new_name,
                comment="由 AI Agent 智能助手执行修改",
                sync_desc=sync_desc
            )
            return {
                "success": res.get("success", False),
                "actual_updated_count": res.get("actual_updated_count", 0),
                "skipped_same_count": res.get("skipped_same_count", 0),
                "failed_count": res.get("failed_count", 0),
                "details": res.get("details", [])
            }

        elif tool_name == "generate_weekly_report":
            start_date = arguments.get("start_date")
            end_date = arguments.get("end_date")
            report_data = generate_weekly_report_data(
                client=client,
                start_date=start_date,
                end_date=end_date
            )
            return {
                "week_range": report_data.get("week_range"),
                "reporter": report_data.get("reporter"),
                "total_finished_projects": len(report_data.get("summary_items", [])),
                "summary": [
                    {"project": item.get("project_name"), "task_count": len(item.get("tasks", []))}
                    for item in report_data.get("summary_items", [])
                ],
                "plans": [
                    {"project": item.get("project_name"), "task_count": len(item.get("tasks", []))}
                    for item in report_data.get("plan_items", [])
                ]
            }

        elif tool_name == "generate_downloadable_document":
            title = str(arguments.get("title") or "小禅AI生成文档").strip()
            content = str(arguments.get("content") or "").strip()
            doc_type = str(arguments.get("doc_type") or "docx").strip().lower()
            author = getattr(client, 'realname', '') or getattr(client, 'account', '') or "小禅 AI 智囊"

            if not content:
                return {"error": "文档正文内容不能为空"}

            doc_info = save_generated_doc(title=title, content=content, doc_type=doc_type, author=author)
            return {
                "success": True,
                "message": f"文档已成功生成！文件格式：{doc_info['doc_type'].upper()}，大小：{doc_info['file_size']}",
                "download_url": doc_info["download_url"],
                "filename": doc_info["filename"],
                "title": doc_info["title"],
                "file_size": doc_info["file_size"],
                "doc_type": doc_info["doc_type"]
            }

        else:
            return {"error": f"未知的工具名称: {tool_name}"}

    except Exception as e:
        return {"error": f"执行工具异常: {str(e)}"}


def chat_with_deepseek_agent(messages, client, api_key=None, base_url=None, model=None, max_iterations=5):
    """
    与 DeepSeek 模型进行多轮 Agent 交互 (Function Calling 循环)
    :param messages: 对话历史消息列表 [{"role": "user", "content": "..."}, ...]
    :param client: 当前禅道会话 client
    :param api_key: DeepSeek API Key (优先从参数获取，其次从环境变量 DEEPSEEK_API_KEY 获取)
    :param base_url: DeepSeek 服务地址，默认 https://api.deepseek.com
    :param model: 模型名称，默认 deepseek-chat
    :param max_iterations: 最大工具循环轮数
    :return: dict 包含最终回复文本、工具调用履历、更新后的 messages
    """
    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        return {
            "success": False,
            "error_type": "NO_API_KEY",
            "reply": "您好！我是您的禅道桌面智能助手「小禅」🤖。\n\n要开启 AI 智能交互与系统数据操作，请先在对话框右上角的 **【⚙️ 设置】** 中配置您的 **DeepSeek API Key**。",
            "tool_history": []
        }

    url = (base_url or os.environ.get("DEEPSEEK_BASE_URL") or DEFAULT_DEEPSEEK_BASE_URL).rstrip('/') + "/chat/completions"
    model_name = model or DEFAULT_DEEPSEEK_MODEL

    # 获取当前用户信息以增强上下文
    user_account = getattr(client, 'account', '') if client else ''
    user_realname = getattr(client, 'realname', '') if client else user_account

    system_prompt = f"""你是一个内置在禅道任务自动化助手系统中的桌面伴侣 AI Agent，名字叫「小禅」🤖。
你既拥有萌趣、热心且贴心的桌面伴侣性格，又是精通禅道任务流转的高级工程管理助手。
当前系统状态：
- 禅道登录用户: {user_realname or user_account or '未登录'} (账号: {user_account or 'none'})
- 当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

你的职责与原则：
1. 你拥有调用禅道工具的能力（查询未完成任务、检索项目、批量完成待办、批量修改任务名、生成工作周报等）。
2. 当用户提出涉及系统数据查询、任务操作、周报汇总等需求时，必须【主动调用工具函数】获取真实数据，绝不要捏造或假装有数据。
3. 如果操作涉及修改任务或批量完成任务：在执行完成后，请用清晰、条理分明的 Markdown 格式向用户汇报成功、跳过与失败的数量及具体明细。
4. 遇到用户日常闲聊时，保持风趣、可爱、温暖的语气，并在合适时机主动提示用户“需要我帮您查查今天的待办任务吗？”
5. 每次回复时排版要美观、结构分明，善用 Emoji、列表和粗体，必要时使用表格展示数据。
6. 你具备【生成可直接下载的文档文件】（Word .docx 或 Markdown .md）的能力！当用户要求“生成文档”、“导出周报文档”、“下载任务总结/技术方案”或希望获得文件时：
   - 请主动调用 `generate_downloadable_document` 工具，传入规范完整的标题 `title`、经过条理化美观排版的正文 `content`（支持完整的 Markdown，包含各级标题#、列表、表格、加粗与总结说明）以及目标格式 `doc_type`（推荐 'docx'）；
   - 工具执行成功后，请在最终回复中告知用户已生成完毕，并附带下载链接，格式为：`[📄 点击直接下载文档：{{title}}]({{download_url}})`。
"""

    # 规范化消息列表，确保首条是 system prompt
    working_messages = []
    if not messages or messages[0].get("role") != "system":
        working_messages.append({"role": "system", "content": system_prompt})
    working_messages.extend(messages)

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    tool_history = []
    iteration = 0

    while iteration < max_iterations:
        iteration += 1

        payload = {
            "model": model_name,
            "messages": working_messages,
            "tools": AGENT_TOOLS,
            "tool_choice": "auto",
            "temperature": 0.5,
            "max_tokens": 2048
        }

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
            if resp.status_code != 200:
                err_text = resp.text
                return {
                    "success": False,
                    "error_type": "API_ERROR",
                    "reply": f"DeepSeek API 请求失败 (状态码 {resp.status_code}):\n```\n{err_text}\n```\n请检查 API Key 是否有效或网络是否通畅。",
                    "tool_history": tool_history
                }
            resp_data = resp.json()
        except Exception as e:
            return {
                "success": False,
                "error_type": "NETWORK_ERROR",
                "reply": f"连接 DeepSeek 服务异常: {str(e)}，请检查网络连接。",
                "tool_history": tool_history
            }

        choices = resp_data.get("choices", [])
        if not choices:
            return {
                "success": False,
                "error_type": "EMPTY_CHOICE",
                "reply": "DeepSeek 未返回有效结果，请稍后重试。",
                "tool_history": tool_history
            }

        message = choices[0].get("message", {})
        tool_calls = message.get("tool_calls")

        # 将模型的思考/回复加入对话上下文
        working_messages.append(message)

        # 如果模型没有触发工具调用，说明已生成最终自然语言回复
        if not tool_calls:
            final_content = message.get("content") or "（小禅已处理完毕）"
            return {
                "success": True,
                "reply": final_content,
                "tool_history": tool_history,
                "messages": working_messages
            }

        # 处理模型发起的全部工具调用
        for tc in tool_calls:
            func_info = tc.get("function", {})
            f_name = func_info.get("name")
            call_id = tc.get("id")
            raw_args = func_info.get("arguments", "{}")

            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
            except Exception:
                args = {}

            # 执行工具
            tool_result = execute_agent_tool(f_name, args, client)

            tool_history.append({
                "tool_name": f_name,
                "arguments": args,
                "result": tool_result
            })

            # 将工具执行结果作为 tool 角色消息返回模型
            working_messages.append({
                "role": "tool",
                "tool_call_id": call_id,
                "name": f_name,
                "content": json.dumps(tool_result, ensure_ascii=False)
            })

    # 超出最大迭代次数保底
    return {
        "success": True,
        "reply": "（小禅已完成多步工具调用处理，以上为相关操作概要。）",
        "tool_history": tool_history,
        "messages": working_messages
    }
