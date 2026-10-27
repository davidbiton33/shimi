# AgentOS v0.8.22-rc.2 — שער הפצה סופי (23.10.2026)

**החלטה: NO-GO ל־v1.0 Stable, GO להפצת Release Candidate לבדיקה.**

## מה אומת כאן מחדש

| תחום | תוצאה | פירוט |
|---|---|---|
| Build נקי | PASS | TypeScript 5.8.3 גלובלי + טיפוסי Node 22 קיימים בסביבה; לא `npm ci` נקי דרך registry |
| טוהר אריזה | PASS | `dist/` נמחק לפני build; `mcp.js` לא נכלל; package-lock/package.json/CLI מסונכרנים |
| בדיקות ליבה | PASS | 223 עברו, 0 נכשלו, 3 דילוגי WASM מכוונים |
| WASM | PASS | 14/14; כל 11 הגרמרות נטענו בפועל |
| שפות | PASS | 14/14 |
| Framework | PASS | 29/29 |
| חמשת פרויקטי הקבלה | PASS | 5/5 ב־v0.8.19 וגם ב־v0.8.22-rc.2; ללא שינוי בתקציבי הטוקנים באותם fixtures |
| TypeScript SCIP ממוקד | PASS | TypeChecker אמיתי באמצעות emitter לבדיקות בלבד; מימוש נכון נבחר; 683→621 טוקנים |
| npm Linux | PASS | התקנת TGZ אופליין + init/pack/context/scip status בנתיב עברי עם רווחים |
| Hashes של נכסי WASM | PASS | SHA256 וגודל של כל 14 נכסי manifest תואמים |
| מסלול אימות Windows | READY, NOT RUN | `qa/windows-smoke.ps1` זמין; המחשב המחובר היה Offline |
| מסלול אימות macOS | READY, NOT RUN | `qa/unix-smoke.sh` עבר ב־Linux בלבד; לא בוצע ב־macOS |
| אינדקסרים רשמיים | NOT RUN | 0/5 ניסיונות: הכלים לא קיימים ב־PATH ואין registry זמין |
| סקירת רישיונות גרמרות | BLOCKED | רישיון web-tree-sitter נמצא; לא אומתה שרשרת המקור והרישיון הייחודי של כל קובץ grammar wasm |
| npm audit ו־reproducible npm ci | NOT RUN | תשתית הרשת מבודדת; אין גישה ל־registry לאימות תלויות build |

## הערות אבטחה ודיוק

- אין `dependencies` בזמן ריצה ב־package.json, אך קיימים WASM ו־TypeScript vendored שיש להתייחס לרישיונותיהם ולהתאמתם כאל תלויות עצמאיות.
- קובצי `tree-sitter-wasms@0.1.13` נמשכו בעבר לצורך vendoring. רישיון חבילת המעטפת **אינו הוכחה** לזכויות ההפצה של כל גרמרה. נדרש תיעוד URL, revision, LICENSE מקורי וייחוס לכל אחת מ־11 גרמרות, וחזרה על build hash/provenance.
- בדיקות הקבלה אינן מריצות את שירותי הפרויקטים, ואינן מוכיחות שוויון סמנטי מלא לקומפיילרים.
- אינדקסרי Java/Kotlin/.NET עשויים להפעיל build של פרויקט, ולכן עליהם לרוץ רק בתוך sandbox מבודד עם תלותיות מבוקרות, ולא אוטומטית על קוד חיצוני בלתי מהימן.
- לא בוצע Code Signing ולא נבדקה הפצה רשמית ב־npm registry.

## פקודות שחזור מקומיות

מתיקיית המקור, לאחר התקנת Node 22 ו־devDependencies:

```bash
npm ci --ignore-scripts
npm run build
node --test --test-concurrency=4 dist/tests/*.test.js
node scripts/run-wasm-test.mjs
node qa/multilang-acceptance.mjs
node qa/framework-acceptance.mjs
bash qa/unix-smoke.sh /path/to/agentos-cli-0.8.22-rc.2.tgz
```

Windows PowerShell (על מכונה אמיתית):

```powershell
powershell -ExecutionPolicy Bypass -File .\qa\windows-smoke.ps1 -PackagePath C:\path\to\agentos-cli-0.8.22-rc.2.tgz
```

אימות Indexers רשמיים: השתמשו ב־`qa/official-indexer-matrix.mjs` קודם במצב probe. מצב `--execute` נועד **רק** לסביבת CI מבודדת, לאחר בדיקת בטיחות ותלויות בפרויקט.

## תנאי Go ל־v1.0

1. הפעלה בפועל של indexers רשמיים על חמשת הפרויקטים + בדיקת target semantics שניתנת לאימות עצמאי.
2. בדיקות מקוריות על Windows ו־macOS, כולל install חדש מנתיב עם רווחים ויוניקוד.
3. השלמת provenance, רישיונות והודעות copyright לכל ה־11 grammar WASM, בדיקת חבילת npm ו־npm ci מתוך dependencies נעולים.

עד לסגירת שלושת הסעיפים: **לא לפרסם בשם Stable**.
