# AgentOS v1.4.0 — Evidence Engine (Hebrew guide)

## מה נוסף

הגרסה מוסיפה ארבעה כלים דטרמיניסטיים שעובדים *ללא מודל AI פנימי*:

1. **Verified Resume:** `agentos resume --verify --json` — מצב Git והצלבת ראיות שהתקבלו מהרצות בדיקה קודמות. שום פקודת בדיקה אינה מופעלת אוטומטית.
2. **DoneGuard:** `agentos guard status --json` — האם בדיקות הקבלה שהוגדרו במפורש עברו עבור קובצי הקלט שהוגדרו, ומאז אותם קבצים לא השתנו. אינו קובע שהדרישות העסקיות הושלמו.
3. **Conflict Radar:** `agentos radar compare --base BASE --left BRANCH_A --right BRANCH_B --json` — קבצים שחופפים בין ענפים, ורמזי תלות מתוך גרף שמור. אינו מבטיח לזהות התנגשויות לוגיות.
4. **StallGuard:** `agentos stall status --json` — מדווח על לפחות 3 הרצות כושלות רצופות של אותה בדיקה עם חתימת פלט כישלון זהה. אינו צופה בכל פעולות הסוכן.

**Evidence Ledger** משותף לארבעתם: `agentos evidence init|run|status|list`, וכלי MCP לקריאת מידע.

## התחלה מהירה

מתוך מאגר Git שכבר אותחל ב־AgentOS:

```bash
agentos evidence init --dry-run
agentos evidence init
# בדוק/ערוך .agentos-evidence.json לפני הרצה: פקודות בדיקה עלולות להריץ קוד מקומי!
agentos evidence run --manifest .agentos-evidence.json
agentos guard status --json
agentos resume --verify --json
agentos stall status --json
```

`evidence init` אינו דורס קובץ שכבר קיים. הוא מזהה את סקריפטי `test`, `typecheck`, `build` מתוך `package.json` (אם קיימים), ומציע רשימת קובצי קלט שאותרו באמצעות Git. **הרשימה אינה מבטיחה כיסוי מלא של כל התלויות**. אם מספר הקבצים גדול מהמגבלה, היא תישאר ריקה, והבדיקה תהיה `scope_unknown` עד שיגדירו Scope במפורש.

דוגמת `.agentos-evidence.json`:

```json
{
  "version": 1,
  "checks": [
    {
      "id": "unit",
      "description": "Unit tests for payment implementation",
      "command": "node",
      "args": ["--test", "tests/payment.test.js"],
      "inputs": ["src/payment.js", "tests/payment.test.js"],
      "required": true,
      "timeoutMs": 60000
    },
    {
      "id": "business-approval",
      "manual": true,
      "description": "Confirm the final charging rule with the product owner",
      "required": true
    }
  ]
}
```

`manual:true` **לעולם לא מאומת אוטומטית** ולכן `complete` נשאר `false` כל עוד אישור ידני מוגדר כחובה. זוהי הגנה מכוונת מפני מצג שווא.

הרצת בדיקה אחת:

```bash
agentos evidence run --check unit --json
```

השוואת ענפים על בסיס Commit משותף:

```bash
agentos radar compare --base main --left feature/api --right feature/ui --json
```

יש ליצור את הענפים מקומית קודם. המנוע לא עושה Merge ולא משנה קוד.

## מה בדיוק נשמר?

לכל בדיקה שהופעלה AgentOS שומר בקובץ מקומי תחת `.ai/evidence/runs/`: מזהה הבדיקה, תאריך, פקודה וארגומנטים, קוד יציאה, SHA-256 של פלט התהליך, SHA-256 של קובצי הקלט המוצהרים, Git HEAD וענף וזמן ביצוע. אין שמירת stdout/stderr מלאים כדי לצמצם דליפת סודות, אבל **הפקודות והארגומנטים עצמן מתועדות**, ולכן אסור לכלול בהן סיסמאות.

אלה ראיות להרצה מסוימת, **לא snapshot מלא של קוד**. שינוי של קובץ שהוגדר כקלט מסמן את הראיה כדורשת הרצה חוזרת. שינוי בתלות שלא הוגדרה או בסביבת ריצה חיצונית עלול לא להתגלות.

## מצבי DoneGuard

- `recorded_pass` — הרצה קודמת יצאה בהצלחה, והקלט המוצהר לא השתנה. **אינו** מעיד שכל הדרישות נכונות.
- `inputs_changed` — קובץ שהוגדר כקלט השתנה מאז הבדיקה או אינו נגיש.
- `failed` — הבדיקה האחרונה הסתיימה ללא exit code תקין.
- `scope_unknown` — הבדיקה הצליחה אך לא הוגדרו קובצי קלט שאפשר להשוות.
- `manual_review` — דרישת אישור ידנית.
- `missing` — אין רישום בדיקה מתאים לחוזה הנוכחי.

## אבטחה ותלות בסוכני AI

- כל הפקודות המקומיות **מופעלות רק על ידי** `agentos evidence run`, שהמשתמש/הסוכן מפעיל במפורש. הרצה של scripts לא מהימנים עלולה לפעול באופן זדוני. אין להריץ על Repo לא מהימן.
- תהליך ההרצה משתמש ב־`shell:false`, במגבלות זמן ופלט. ב־Windows הפעלת `npm` משתמשת ב־`npm-cli.js` מתוך התקנת Node המקומית, ללא Shell. אם ההתקנה שונה והנתיב אינו קיים, תתקבל שגיאה מבוקרת ויש להגדיר `node`/entrypoint במפורש.
- אין הרצת מודל AI, אין חיבור רשת מובנה, ואין ניתוח חופשי של שיחות סוכנים.
- MCP חושף קריאות־בלבד נוספות: `agentos_verified_resume`, `agentos_guard_status`, `agentos_conflict_radar`, `agentos_stall_status`. ב־v1.4.0 יש **13 כלי MCP**, וכלי כתיבת הזיכרון הישנים נשארו.
- סקירת אנוש/AI עדיין חיונית לטענות עסקיות, השפעות בזמן ריצה ודרישות שלא הוגדרו במפורש.

## מגבלות ידועות

- אין זיהוי מלא של כל תלות דינמית או קוד בזמן ריצה.
- Conflict Radar משווה שני Revisions של Git; שינויים לא מחויבים ב־Worktree אינם חלק מהשוואת הענפים.
- Graph שנוצר בעבר עלול להיות מיושן. פלט מכיל אזהרה מתאימה.
- StallGuard צופה רק בהרצות בדיקות ש־AgentOS עצמו שמר, לא בכל פעולות Claude/Codex/Cursor.
- אין המרה אוטומטית של בקשות שפה טבעית לחוזה קבלה; סוכן יכול לערוך אותו לפי הוראות ה־Skill, והמשתמש חייב לאשר את הפקודות לפני הרצתן.
