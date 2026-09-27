# Learnora migration map

The uploaded project was inspected as the source of truth. The rebuild keeps its curriculum and presentation assets while replacing the runtime stack.

| Reference implementation | JavaScript/Firebase rebuild |
|---|---|
| Flask `app.py` | `server/server.js` + services |
| Firestore DAL | `server/services/firebaseService.js` |
| `ml/skill_graph.py` | `server/services/curriculumService.js` |
| `ml/recommend.py` | `server/services/recommendationService.js` |
| `ml/openrouter_learning.py` | `server/services/aiService.js` using Groq |
| `ml/chatbot.py` | `server/services/chatbotService.js` |
| `youtube.py` | `server/services/youtubeService.js` |
| local syllabus files | Supabase Storage |
| Jinja templates | Nunjucks templates (HTML) |
| browser JS | `public/js/` |
| SQLite legacy artifacts | removed from runtime |
| Python/joblib runtime | removed; original fitted logistic coefficients are embedded in JS for the existing AI-match calculation |
| Gemini/OpenRouter/BazaarLink | Groq service abstraction |

## Diagnostic change required by the new specification

The reference implementation generated 21 questions as three sets of seven. The requested rebuild changes this to exactly **7 questions**: **2 Basic + 3 Intermediate + 2 Advanced**. The answer evaluation and difficulty gating remain deterministic and prerequisite-aware.

## Important source-data preservation

`data/curriculum.json` and `data/knowledge_base.json` are copied directly from the uploaded reference project. The original research images/metrics are retained as reference artifacts, but the removed Python training pipeline is not executed by the Node.js runtime.
