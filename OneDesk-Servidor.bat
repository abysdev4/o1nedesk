@echo off
title OneDesk Servidor
echo.
echo  Iniciando o OneDesk (hub + tunel publico)...
echo  Mantenha esta janela ABERTA enquanto quiser o acesso remoto ativo.
echo  Feche a janela para desligar.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\onedesk-server.ps1"
echo.
echo  O servidor foi encerrado.
pause
