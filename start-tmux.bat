@echo off
rem MSYS2의 tmux를 실행하며, 기존 Windows의 PATH(claude 등)를 모두 상속받게 합니다.
set MSYS2_PATH_TYPE=inherit
C:\msys64\usr\bin\tmux.exe
