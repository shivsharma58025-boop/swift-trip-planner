@echo off
echo ========================================================
echo Swift Strips India - Swift Trip Planner Git Push Script
echo ========================================================
echo Staging all files...
git add -A

echo Committing changes...
git commit -m "feat: complete Swift Trip Planner initial release with 3D map annotations, branding, engine, and tests"

echo Pushing to remote...
git push origin main
if %errorlevel% neq 0 (
    echo Pushing to master branch fallback...
    git push origin master
)

echo.
echo ========================================================
echo Codebase successfully committed and pushed!
echo ========================================================
pause
