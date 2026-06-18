@echo off
title Sales B2B
echo Uruchamianie Sales B2B...
start "" "http://localhost:8080"
python -m http.server 8080 --directory "%~dp0"
