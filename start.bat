@echo off
chcp 65001 >nul
title 禅道自动化任务助手控制台

echo ======================================================================
echo           禅道自动化任务管理控制台 (ZenTao Automation Studio)
echo ======================================================================
echo.
echo [*] 正在启动后台 Web 服务...
echo [*] 访问地址: http://127.0.0.1:5000
echo.

:: 自动打开浏览器
start http://127.0.0.1:5000

:: 启动 Python 服务
python server.py

pause
