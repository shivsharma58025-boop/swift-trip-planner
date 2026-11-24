@echo off
echo ========================================================
echo Swift Strips India - Swift Trip Planner Git Push Script
echo ========================================================
echo Staging all updated files...
git add -A

echo Committing enhanced UI/UX, typography, swift_logo.png and map annotations...
git commit -m "feat(ui): upgrade to Inter typography, swift_logo.png branding, and high-tier Google Maps corridor badges"

echo Pushing to remote...
git push origin main
if %errorlevel% neq 0 (
    echo Pushing to master fallback...
    git push origin master
)

echo.
echo ========================================================
echo Codebase successfully committed and pushed!
echo ========================================================
pause
